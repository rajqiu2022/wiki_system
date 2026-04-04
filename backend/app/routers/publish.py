import os
import logging
import shutil
import subprocess
import yaml
from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime

from ..database import get_db
from ..models import WikiList, WikiFile, TypeList, PublishLog, User
from ..schemas import PublishLogOut, PublishRequest
from ..auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/publish", tags=["publish"])

# Path configuration
# In Docker: __file__ = /app/app/routers/publish.py, project root = /app
# In local dev: __file__ = .../backend/app/routers/publish.py, project root = .../
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if os.path.basename(BASE_DIR) == "backend":
    PROJECT_ROOT = os.path.normpath(os.path.join(BASE_DIR, ".."))
else:
    PROJECT_ROOT = BASE_DIR
DOCS_DIR = os.path.join(PROJECT_ROOT, "docs")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")
MKDOCS_YML = os.path.join(PROJECT_ROOT, "mkdocs.yml")


def _load_existing_mkdocs_config() -> Optional[dict]:
    """Load and return existing mkdocs.yml config, or None if unavailable."""
    if not os.path.isfile(MKDOCS_YML):
        return None
    try:
        with open(MKDOCS_YML, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        if config and isinstance(config, dict) and config.get("nav"):
            return config
    except Exception as e:
        logger.warning("Failed to load existing mkdocs.yml: %s", e)
    return None


def _collect_nav_filenames(nav_items: list) -> list:
    """Recursively collect all .md filenames referenced in nav structure."""
    filenames = []
    for item in nav_items:
        if isinstance(item, dict):
            for key, value in item.items():
                if isinstance(value, str):
                    filenames.append(value)
                elif isinstance(value, list):
                    filenames.extend(_collect_nav_filenames(value))
        elif isinstance(item, str):
            filenames.append(item)
    return filenames


def _build_name_to_doc_map(db: Session) -> Dict[str, "WikiList"]:
    """Build mapping from various name forms to WikiList objects."""
    docs = db.query(WikiList).filter(WikiList.status.in_([0, 3, 4])).all()
    name_map = {}
    for doc in docs:
        if doc.name:
            clean = doc.name.strip()
            name_map[clean] = doc
            name_map[clean.replace('_', ' ')] = doc
            name_map[clean.lower()] = doc
            name_map[clean.replace('_', ' ').lower()] = doc
    return name_map


def _resolve_doc_for_nav_entry(
    article_name: str,
    filename: str,
    name_map: Dict[str, "WikiList"],
) -> Optional["WikiList"]:
    """Resolve a WikiList doc from a nav entry's article name and filename."""
    # Strategy 1: exact article name
    if article_name in name_map:
        return name_map[article_name]
    # Strategy 2: underscores -> spaces
    name_spaces = article_name.replace('_', ' ')
    if name_spaces in name_map:
        return name_map[name_spaces]
    # Strategy 3: case-insensitive
    if article_name.lower() in name_map:
        return name_map[article_name.lower()]
    if name_spaces.lower() in name_map:
        return name_map[name_spaces.lower()]
    # Strategy 4: filename stem as name
    stem = filename.replace('.md', '').strip()
    if stem in name_map:
        return name_map[stem]
    return None


def _update_doc_files_from_nav(
    nav_items: list,
    name_map: Dict[str, "WikiList"],
    db: Session,
    updated_count: list,
):
    """Walk nav structure and update .md files in docs/ with latest content from DB."""
    for item in nav_items:
        if isinstance(item, dict):
            for key, value in item.items():
                if isinstance(value, str):
                    # Leaf: article_name -> filename.md
                    doc = _resolve_doc_for_nav_entry(key, value, name_map)
                    if doc:
                        wiki_file = (
                            db.query(WikiFile)
                            .filter(WikiFile.list_id == doc.id)
                            .order_by(WikiFile.id.desc())
                            .first()
                        )
                        content = wiki_file.content if wiki_file else ""
                        filepath = os.path.join(DOCS_DIR, value)
                        with open(filepath, "w", encoding="utf-8") as f:
                            f.write(content)
                        updated_count[0] += 1
                elif isinstance(value, list):
                    _update_doc_files_from_nav(value, name_map, db, updated_count)
        elif isinstance(item, str):
            pass  # bare string entries (e.g. index.md) are not doc entries


# Legacy fallback: build nav from TypeList (kept for backward compatibility)
def _build_nav_yaml_legacy(nodes, all_nodes, docs_map):
    """Build nav YAML from TypeList nodes (legacy fallback)."""
    result = []
    for node in nodes:
        child_path = f"{node.parent_path}/{node.name}" if node.parent_path else node.name
        children_nodes = [n for n in all_nodes if n.parent_path == child_path]

        if children_nodes:
            sub = _build_nav_yaml_legacy(children_nodes, all_nodes, docs_map)
            result.append({node.name: sub})
        else:
            if node.mark:
                try:
                    doc_id = int(node.mark)
                    if doc_id in docs_map:
                        filename = f"{doc_id}.md"
                        result.append({node.name: filename})
                except (ValueError, TypeError):
                    result.append({node.name: node.mark})
    return result


@router.post("")
def publish(
    request: PublishRequest = None,
    user_id: Optional[int] = Query(None),
    force: bool = Query(False, description="Force publish all docs (ignore status)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Publish Wiki (generate MkDocs static site).
    
    Primary mode: preserve existing mkdocs.yml nav structure, only update doc content.
    Fallback mode: build nav from TypeList if mkdocs.yml is unavailable.
    """
    try:
        # Get all publishable docs (status 0=normal, 3/4=editing)
        # Both normal and force modes publish all valid docs, since we rebuild
        # the entire site including nav structure changes.
        all_docs = db.query(WikiList).filter(WikiList.status.in_([0, 3, 4])).all()

        if not all_docs and not _load_existing_mkdocs_config():
            raise HTTPException(400, "没有可发布的文档")

        docs_map = {doc.id: doc for doc in all_docs}

        # Ensure directories exist
        os.makedirs(DOCS_DIR, exist_ok=True)
        os.makedirs(OUTPUT_DIR, exist_ok=True)

        # Generate index.md
        index_path = os.path.join(DOCS_DIR, "index.md")
        with open(index_path, "w", encoding="utf-8") as f:
            f.write("# Welcome\n\n欢迎访问 Makerfabs Wiki 知识库。\n\n请从左侧导航选择文档。\n")

        # --- Primary mode: use existing mkdocs.yml nav ---
        existing_config = _load_existing_mkdocs_config()

        if existing_config and existing_config.get("nav"):
            logger.info("Using existing mkdocs.yml nav structure for publish")
            nav = existing_config["nav"]

            # Build name mapping for resolving nav entries to docs
            name_map = _build_name_to_doc_map(db)

            # Update doc .md files based on nav structure
            updated_count = [0]
            _update_doc_files_from_nav(nav, name_map, db, updated_count)
            logger.info("Updated %d doc files from nav", updated_count[0])

            # Write back mkdocs.yml preserving existing config, only ensure nav is present
            with open(MKDOCS_YML, "w", encoding="utf-8") as f:
                yaml.dump(
                    existing_config, f,
                    allow_unicode=True, default_flow_style=False, sort_keys=False,
                )

        else:
            # --- Fallback mode: generate nav from scratch ---
            logger.info("No existing mkdocs.yml nav, building from scratch")

            # Generate .md files for all docs
            for doc in all_docs:
                wiki_file = (
                    db.query(WikiFile)
                    .filter(WikiFile.list_id == doc.id)
                    .order_by(WikiFile.id.desc())
                    .first()
                )
                content = wiki_file.content if wiki_file else ""
                filepath = os.path.join(DOCS_DIR, f"{doc.id}.md")
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(f"# {doc.name}\n\n{content}")

            # Build nav from TypeList (legacy)
            all_nav_nodes = db.query(TypeList).filter(TypeList.status == 0).all()
            root_nodes = [n for n in all_nav_nodes if not n.parent_path]
            nav = _build_nav_yaml_legacy(root_nodes, all_nav_nodes, docs_map)

            if not nav:
                nav = [{doc.name: f"{doc.id}.md"} for doc in all_docs]

            nav.insert(0, {"Home": "index.md"})

            # Generate mkdocs.yml
            mkdocs_config = {
                "site_name": "Makerfabs Wiki",
                "site_url": "https://wiki.makerfabs.com/",
                "docs_dir": "docs",
                "site_dir": "output",
                "theme": {
                    "name": "material",
                    "language": "zh",
                    "palette": [
                        {
                            "scheme": "default",
                            "primary": "indigo",
                            "accent": "indigo",
                            "toggle": {
                                "icon": "material/brightness-7",
                                "name": "切换到暗色模式",
                            },
                        },
                        {
                            "scheme": "slate",
                            "primary": "indigo",
                            "accent": "indigo",
                            "toggle": {
                                "icon": "material/brightness-4",
                                "name": "切换到亮色模式",
                            },
                        },
                    ],
                    "features": [
                        "navigation.instant",
                        "navigation.tracking",
                        "navigation.tabs",
                        "navigation.sections",
                        "search.highlight",
                        "content.code.copy",
                    ],
                },
                "nav": nav,
                "markdown_extensions": [
                    "admonition",
                    "pymdownx.highlight",
                    "pymdownx.superfences",
                    "pymdownx.tabbed",
                    "pymdownx.details",
                    "tables",
                    "toc",
                ],
                "plugins": ["search"],
            }

            with open(MKDOCS_YML, "w", encoding="utf-8") as f:
                yaml.dump(
                    mkdocs_config, f,
                    allow_unicode=True, default_flow_style=False, sort_keys=False,
                )

        # Execute mkdocs build
        import sys
        result = subprocess.run(
            [sys.executable, "-m", "mkdocs", "build", "--clean"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            log = PublishLog(
                published_by=current_user.username,
                doc_count=len(all_docs),
                status="failed",
                message=result.stderr or result.stdout,
            )
            db.add(log)
            db.commit()
            raise HTTPException(500, f"构建失败: {result.stderr or result.stdout}")

        # Sync nav and docs to the mkdocs site container directory
        # The mkdocs site container reads from /app/mkdocs-site (bind-mounted to
        # /var/www/html/makerfabs/wiki/mkdoc/wiki on the host).
        # We merge our nav into the site's existing mkdocs.yml to preserve its
        # site_name, theme, use_directory_urls and other settings.
        sync_msg = ""
        MKDOCS_SITE_DIR = os.path.join(PROJECT_ROOT, "mkdocs-site")
        if os.path.isdir(MKDOCS_SITE_DIR):
            try:
                site_mkdocs_yml = os.path.join(MKDOCS_SITE_DIR, "mkdocs.yml")

                # Load the site's existing config (preserve site_name, theme, etc.)
                site_config = {}
                if os.path.isfile(site_mkdocs_yml):
                    with open(site_mkdocs_yml, "r", encoding="utf-8") as f:
                        site_config = yaml.safe_load(f) or {}

                # Load our editor's config to get the nav
                with open(MKDOCS_YML, "r", encoding="utf-8") as f:
                    editor_config = yaml.safe_load(f) or {}

                # Merge: inject our nav into the site config
                if editor_config.get("nav"):
                    site_config["nav"] = editor_config["nav"]

                with open(site_mkdocs_yml, "w", encoding="utf-8") as f:
                    yaml.dump(
                        site_config, f,
                        allow_unicode=True, default_flow_style=False, sort_keys=False,
                    )
                logger.info("Merged nav into mkdocs-site/mkdocs.yml")

                # Sync docs directory: clear old docs and copy new ones
                site_docs_dir = os.path.join(MKDOCS_SITE_DIR, "docs")
                if os.path.isdir(site_docs_dir):
                    shutil.rmtree(site_docs_dir)
                shutil.copytree(DOCS_DIR, site_docs_dir)
                logger.info("Synced docs/ to mkdocs-site/docs/")

                # Restart mkdocs container to pick up changes
                # (mkdocs serve doesn't detect bind-mount file changes via inotify)
                # Use Docker socket HTTP API directly (no Docker CLI needed)
                try:
                    import urllib.request
                    req = urllib.request.Request(
                        "http://localhost/containers/mkdocs/restart",
                        method="POST",
                    )
                    # Connect via Unix socket using a custom handler
                    import http.client
                    import socket

                    class UnixHTTPConnection(http.client.HTTPConnection):
                        def __init__(self, socket_path):
                            super().__init__("localhost")
                            self.socket_path = socket_path

                        def connect(self):
                            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                            self.sock.connect(self.socket_path)

                    conn = UnixHTTPConnection("/var/run/docker.sock")
                    conn.request("POST", "/containers/mkdocs/restart?t=5")
                    resp = conn.getresponse()
                    if resp.status == 204:
                        logger.info("Restarted mkdocs container successfully")
                        sync_msg = "，已同步到 mkdocs 站点并重启"
                    else:
                        body = resp.read().decode()
                        logger.warning("Failed to restart mkdocs: HTTP %d %s", resp.status, body)
                        sync_msg = "，已同步到 mkdocs 站点（重启失败，请手动重启 mkdocs 容器）"
                    conn.close()
                except Exception as re:
                    logger.warning("Failed to restart mkdocs container: %s", re)
                    sync_msg = "，已同步到 mkdocs 站点（重启失败，请手动重启 mkdocs 容器）"
            except Exception as e:
                logger.warning("Failed to sync to mkdocs-site: %s", e)
                sync_msg = f"，同步到 mkdocs 站点失败: {e}"
        else:
            logger.info("mkdocs-site dir not found at %s, skipping sync", MKDOCS_SITE_DIR)

        # Record success log
        log = PublishLog(
            published_by=current_user.username,
            doc_count=len(all_docs),
            status="success",
            message=f"成功发布 {len(all_docs)} 篇文档{sync_msg}",
        )
        db.add(log)
        db.commit()

        return {
            "ok": True,
            "message": f"成功发布 {len(all_docs)} 篇文档{sync_msg}",
            "output_dir": OUTPUT_DIR,
        }

    except HTTPException:
        raise
    except Exception as e:
        log = PublishLog(
            published_by=current_user.username if 'current_user' in dir() else "unknown",
            doc_count=0,
            status="failed",
            message=str(e),
        )
        db.add(log)
        db.commit()
        raise HTTPException(500, f"发布失败: {str(e)}")


@router.get("/logs")
def get_publish_logs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取发布日志"""
    logs = db.query(PublishLog).order_by(PublishLog.published_at.desc()).limit(20).all()
    return [
        {
            "id": log.id,
            "published_by": log.published_by,
            "published_at": log.published_at.isoformat() if log.published_at else None,
            "doc_count": log.doc_count,
            "status": log.status,
            "message": log.message,
        }
        for log in logs
    ]