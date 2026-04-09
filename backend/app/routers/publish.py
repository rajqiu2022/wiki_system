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
# Store mkdocs.yml in a persistent volume directory to survive container rebuilds
MKDOCS_CONFIG_DIR = os.path.join(PROJECT_ROOT, "mkdocs-config")
MKDOCS_YML = os.path.join(MKDOCS_CONFIG_DIR, "mkdocs.yml")


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
    docs = db.query(WikiList).filter(WikiList.status == 0).all()
    name_map = {}
    for doc in docs:
        if doc.name:
            clean = doc.name.strip()
            name_map[clean] = doc
            name_map[clean.replace('_', ' ')] = doc
            name_map[clean.replace('-', '_')] = doc
            name_map[clean.replace('-', ' ')] = doc
            name_map[clean.lower()] = doc
            name_map[clean.replace('_', ' ').lower()] = doc
            name_map[clean.replace('-', '_').lower()] = doc
            name_map[clean.replace('-', ' ').lower()] = doc
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
    # Strategy 5: filename stem is a numeric doc_id, look up by ID in name_map values
    try:
        doc_id_int = int(stem)
        for doc in name_map.values():
            if doc.id == doc_id_int:
                return doc
    except (ValueError, TypeError):
        pass
    return None


def _ensure_fix_home_js(docs_dir: str):
    """Create js/fix-home.js in docs dir to fix Home link in mkdocs serve.
    
    Since mkdocs serve dynamically generates HTML, we cannot post-process it.
    Instead, we inject a small JS that replaces index.html links with ./
    """
    js_dir = os.path.join(docs_dir, "js")
    os.makedirs(js_dir, exist_ok=True)
    js_path = os.path.join(js_dir, "fix-home.js")
    js_content = """// Fix Home link: replace index.html with ./
document.addEventListener('DOMContentLoaded', function() {
    var links = document.querySelectorAll('a[href="index.html"], a[href="./index.html"]');
    for (var i = 0; i < links.length; i++) {
        links[i].setAttribute('href', './');
    }
});
"""
    with open(js_path, "w", encoding="utf-8") as f:
        f.write(js_content)
    logger.info("Created fix-home.js in %s", js_dir)


def _clean_docs_dir(docs_dir: str):
    """Remove all .md files from docs dir before publishing to avoid stale files."""
    if not os.path.isdir(docs_dir):
        return
    for fname in os.listdir(docs_dir):
        if fname.endswith('.md'):
            try:
                os.remove(os.path.join(docs_dir, fname))
            except Exception as e:
                logger.warning("Failed to remove old doc %s: %s", fname, e)


def _sanitize_filename(name: str, keep_hyphens: bool = False) -> str:
    """Convert article name to a safe filename.
    
    Rules:
    - Use the document name (name field) as the filename
    - Replace hyphens (-) with underscores (_) unless keep_hyphens is True
    - Keep spaces as-is (they become %20 in URLs)
    - Remove unsafe filesystem characters
    - Limit length
    - Ensure .md extension
    """
    import re
    # Replace unsafe characters (but keep spaces, underscores, and hyphens for now)
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name.strip())
    # Replace hyphens with underscores (unless keep_hyphens is set)
    if not keep_hyphens:
        safe = safe.replace('-', '_')
    # Replace multiple spaces with single space
    safe = re.sub(r'\s+', ' ', safe)
    # Remove leading/trailing spaces
    safe = safe.strip()
    # Limit length to 100 chars (without extension)
    if len(safe) > 100:
        safe = safe[:100].strip()
    # Ensure not empty
    if not safe:
        safe = "untitled"
    return f"{safe}.md"


def _update_doc_files_from_nav(
    nav_items: list,
    name_map: Dict[str, "WikiList"],
    db: Session,
    updated_count: list,
    is_root: bool = False,
) -> tuple:
    """Walk nav structure and update .md files in docs/ with latest content from DB.
    
    Returns a tuple of (full_nav, filtered_nav):
    - full_nav: complete nav list including hidden articles (for mkdocs.yml / backend tree)
    - filtered_nav: nav list excluding hidden articles (for mkdocs build / frontend menu)
    
    When is_root=True, skip root-level leaf articles (they should not be published).
    Hidden articles (hidden=1) are still written to docs/ as .md files so they generate
    HTML, but they are excluded from the filtered nav so they don't appear in menus.
    """
    full_result = []
    filtered_result = []
    for item in nav_items:
        if isinstance(item, dict):
            for key, value in item.items():
                if isinstance(value, str):
                    # Leaf: article_name -> filename.md
                    # Special handling for Home/index.md: keep as-is
                    if key == "Home" and "index" in value:
                        full_result.append(item)
                        filtered_result.append(item)
                        continue
                    doc = _resolve_doc_for_nav_entry(key, value, name_map)
                    if doc:
                        wiki_file = (
                            db.query(WikiFile)
                            .filter(WikiFile.list_id == doc.id)
                            .order_by(WikiFile.id.desc())
                            .first()
                        )
                        content = wiki_file.content if wiki_file else ""
                        # Use article title (name) as filename
                        keep_h = bool(getattr(doc, 'keep_hyphens', 0))
                        filename = _sanitize_filename(doc.name, keep_hyphens=keep_h)
                        filepath = os.path.join(DOCS_DIR, filename)
                        with open(filepath, "w", encoding="utf-8") as f:
                            f.write(content)
                        updated_count[0] += 1
                        # Always add to full nav
                        full_result.append({key: filename})
                        # Hidden articles: exclude from filtered nav (frontend menu)
                        if getattr(doc, 'hidden', 0) == 1:
                            logger.info("Hidden article '%s' (id=%d): file generated but excluded from menu nav", doc.name, doc.id)
                        else:
                            filtered_result.append({key: filename})
                    else:
                        # Keep original entry if doc not found (e.g., index.md)
                        full_result.append(item)
                        filtered_result.append(item)
                elif isinstance(value, list):
                    # Directory: recurse (children are not root-level)
                    full_children, filtered_children = _update_doc_files_from_nav(value, name_map, db, updated_count, is_root=False)
                    # Always add to full nav (even if empty after filtering)
                    if full_children:
                        full_result.append({key: full_children})
                    # Only include directory in filtered nav if it has visible children
                    if filtered_children:
                        filtered_result.append({key: filtered_children})
        elif isinstance(item, str):
            # Bare string entries (e.g., index.md)
            full_result.append(item)
            filtered_result.append(item)
    return full_result, filtered_result


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
                        # Use article title as filename
                        keep_h = bool(getattr(docs_map[doc_id], 'keep_hyphens', 0))
                        filename = _sanitize_filename(docs_map[doc_id].name, keep_hyphens=keep_h)
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
        # Get all publishable docs (status 0=normal only)
        # Docs with status 3/4 (editing) should NOT be published until they are
        # marked as normal (status=0) again.
        all_docs = db.query(WikiList).filter(WikiList.status == 0).all()

        if not all_docs and not _load_existing_mkdocs_config():
            raise HTTPException(400, "没有可发布的文档")

        docs_map = {doc.id: doc for doc in all_docs}

        # Ensure directories exist
        os.makedirs(DOCS_DIR, exist_ok=True)
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        os.makedirs(MKDOCS_CONFIG_DIR, exist_ok=True)

        # Track full nav (with hidden articles) and filtered nav (without hidden articles)
        _full_nav_for_restore = None
        _filtered_nav_for_site = None

        # Clean old .md files to avoid stale files with old naming conventions
        _clean_docs_dir(DOCS_DIR)

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

            # Update doc .md files based on nav structure and normalize filenames
            updated_count = [0]
            full_nav, filtered_nav = _update_doc_files_from_nav(nav, name_map, db, updated_count, is_root=True)
            logger.info("Updated %d doc files from nav", updated_count[0])

            # Ensure use_directory_urls is false for .html URL format
            existing_config["use_directory_urls"] = False
            # Add extra_javascript for fixing Home link
            existing_config["extra_javascript"] = ["js/fix-home.js"]
            # Ensure docs_dir and site_dir use absolute paths (config file is in mkdocs-config/)
            existing_config["docs_dir"] = DOCS_DIR
            existing_config["site_dir"] = OUTPUT_DIR

            # Step 1: Write mkdocs.yml with FILTERED nav for mkdocs build (no hidden articles in menu)
            existing_config["nav"] = filtered_nav
            with open(MKDOCS_YML, "w", encoding="utf-8") as f:
                yaml.dump(
                    existing_config, f,
                    allow_unicode=True, default_flow_style=False, sort_keys=False,
                )
            # Save full_nav for later restoration
            _full_nav_for_restore = full_nav
            _filtered_nav_for_site = filtered_nav

        else:
            # --- Fallback mode: generate nav from scratch ---
            logger.info("No existing mkdocs.yml nav, building from scratch")

            # Generate .md files for all docs (including hidden ones)
            for doc in all_docs:
                wiki_file = (
                    db.query(WikiFile)
                    .filter(WikiFile.list_id == doc.id)
                    .order_by(WikiFile.id.desc())
                    .first()
                )
                content = wiki_file.content if wiki_file else ""
                # Use article title as filename
                keep_h = bool(getattr(doc, 'keep_hyphens', 0))
                filename = _sanitize_filename(doc.name, keep_hyphens=keep_h)
                filepath = os.path.join(DOCS_DIR, filename)
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(f"# {doc.name}\n\n{content}")

            # Build nav from TypeList (legacy) - exclude hidden docs
            visible_docs = {doc.id: doc for doc in all_docs if getattr(doc, 'hidden', 0) != 1}
            all_nav_nodes = db.query(TypeList).filter(TypeList.status == 0).all()
            root_nodes = [n for n in all_nav_nodes if not n.parent_path]
            nav = _build_nav_yaml_legacy(root_nodes, all_nav_nodes, visible_docs)

            if not nav:
                nav = [{doc.name: f"{doc.id}.md"} for doc in all_docs]

            nav.insert(0, {"Home": "index.md"})

            # Generate mkdocs.yml
            mkdocs_config = {
                "site_name": "Makerfabs Wiki",
                "site_url": "https://wiki.makerfabs.com/",
                "docs_dir": DOCS_DIR,
                "site_dir": OUTPUT_DIR,
                "use_directory_urls": False,
                "extra_javascript": ["js/fix-home.js"],
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
        os.makedirs(MKDOCS_CONFIG_DIR, exist_ok=True)
        result = subprocess.run(
            [sys.executable, "-m", "mkdocs", "build", "--clean", "-f", MKDOCS_YML],
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

        # Create fix-home.js in docs dir (for mkdocs serve dynamic generation)
        _ensure_fix_home_js(DOCS_DIR)

        # Step 2: After build, restore mkdocs.yml with FULL nav (including hidden articles)
        # so that the backend nav tree (/api/nav/tree) can see all articles.
        if _full_nav_for_restore is not None and existing_config:
            existing_config["nav"] = _full_nav_for_restore
            with open(MKDOCS_YML, "w", encoding="utf-8") as f:
                yaml.dump(
                    existing_config, f,
                    allow_unicode=True, default_flow_style=False, sort_keys=False,
                )
            logger.info("Restored mkdocs.yml with full nav (including hidden articles) for backend tree")

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

                # Merge: inject FILTERED nav (without hidden articles) into the site config
                # The site config is used by mkdocs serve for the live site menu
                if _filtered_nav_for_site is not None:
                    # Use filtered nav for the live site (no hidden articles in menu)
                    site_config["nav"] = _filtered_nav_for_site
                elif editor_config.get("nav"):
                    site_config["nav"] = editor_config["nav"]
                
                # Ensure use_directory_urls is false for .html URL format
                site_config["use_directory_urls"] = False
                # Add extra_javascript for fixing Home link
                site_config["extra_javascript"] = ["js/fix-home.js"]

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

        # Mark all published docs as published (publish_status=0)
        for doc in all_docs:
            if hasattr(doc, 'publish_status'):
                doc.publish_status = 0
        db.commit()

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