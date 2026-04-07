import json as json_lib
import os
import logging
import urllib.parse
from typing import List, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import yaml

from ..database import get_db
from ..models import TypeList, WikiList
from ..schemas import NavNodeCreate, NavNodeUpdate, NavNodeOut, NavTreeUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/nav", tags=["navigation"])

# 旧系统 docs 路径前缀
LEGACY_DOCS_BASE = "/var/www/html/wiki.makerfabs.com/mkdoc/wiki/docs/"

# Name of the TypeList node that stores the wiki menu JSON
WIKI_MENU_NODE_NAME = "WIKI_MENU_JSON2"

# Path to mkdocs.yml (project root)
# In Docker: __file__ = /app/app/routers/nav.py, project root = /app
# In local dev: __file__ = .../backend/app/routers/nav.py, project root = .../
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Check if we're inside a "backend" directory (local dev) or directly in app root (Docker)
if os.path.basename(_BASE_DIR) == "backend":
    _PROJECT_ROOT = os.path.normpath(os.path.join(_BASE_DIR, ".."))
else:
    _PROJECT_ROOT = _BASE_DIR
MKDOCS_YML_PATH = os.path.join(_PROJECT_ROOT, "mkdocs.yml")


def _normalize_path(path: str) -> str:
    """[FALLBACK ONLY] Convert legacy absolute path to relative path.
    Used only by _build_tree_from_dirs fallback when mkdocs.yml is unavailable."""
    if not path:
        return ""
    if path.startswith(LEGACY_DOCS_BASE):
        relative = path[len(LEGACY_DOCS_BASE):]
        return relative.rstrip("/")
    return path.rstrip("/")


def _build_name_to_doc_map(db: Session) -> Dict[str, int]:
    """Build mappings from doc name -> doc id for linking menu items to docs.
    Returns name_map where keys are various forms of doc names."""
    docs = db.query(WikiList).filter(WikiList.status.in_([0, 3, 4])).all()
    name_map = {}
    for doc in docs:
        if doc.name:
            clean_name = doc.name.strip()
            # Exact name mapping
            name_map[clean_name] = doc.id
            # Also map with underscores replaced by spaces for fuzzy matching
            name_map[clean_name.replace('_', ' ')] = doc.id
            # Also map lowercase for case-insensitive matching
            name_map[clean_name.lower()] = doc.id
            name_map[clean_name.replace('_', ' ').lower()] = doc.id
    return name_map


# ============ mkdocs.yml based navigation (PRIMARY) ============

def _parse_mkdocs_nav(db: Session) -> Optional[List[Dict]]:
    """Parse mkdocs.yml nav field and convert to editor tree format.
    
    Returns the tree list on success, or None if mkdocs.yml is unavailable.
    """
    if not os.path.isfile(MKDOCS_YML_PATH):
        logger.warning("mkdocs.yml not found at %s, will fallback", MKDOCS_YML_PATH)
        return None

    try:
        with open(MKDOCS_YML_PATH, "r", encoding="utf-8") as f:
            mkdocs_config = yaml.safe_load(f)
    except Exception as e:
        logger.warning("Failed to parse mkdocs.yml: %s", e)
        return None

    if not mkdocs_config or not isinstance(mkdocs_config, dict):
        return None

    nav = mkdocs_config.get("nav")
    if not nav or not isinstance(nav, list):
        logger.warning("mkdocs.yml has no valid nav field")
        return None

    # Build name -> doc_id mapping from wiki_list
    name_to_doc = _build_name_to_doc_map(db)

    return _convert_mkdocs_nav_to_tree(nav, name_to_doc, parent_path="")


def _resolve_doc_id(article_name: str, filename: str, name_to_doc: Dict[str, int]) -> str:
    """Resolve a doc_id (as string) from article name and filename.
    
    Matching strategies (in order):
    1. Exact article name match
    2. Article name with underscores replaced by spaces
    3. Case-insensitive article name match
    4. Filename stem (UUID or integer ID) match by name
    5. Integer ID filename direct match
    
    Returns doc_id string or empty string if not found.
    """
    # Strategy 1: exact article name
    if article_name in name_to_doc:
        return str(name_to_doc[article_name])

    # Strategy 2: underscores -> spaces
    name_spaces = article_name.replace('_', ' ')
    if name_spaces in name_to_doc:
        return str(name_to_doc[name_spaces])

    # Strategy 3: case-insensitive
    name_lower = article_name.lower()
    if name_lower in name_to_doc:
        return str(name_to_doc[name_lower])

    name_spaces_lower = name_spaces.lower()
    if name_spaces_lower in name_to_doc:
        return str(name_to_doc[name_spaces_lower])

    # Strategy 4: try filename stem as name
    stem = filename.replace('.md', '').strip()
    if stem in name_to_doc:
        return str(name_to_doc[stem])

    # Strategy 5: integer ID filename (e.g. "123.md")
    try:
        doc_id_int = int(stem)
        return str(doc_id_int)
    except (ValueError, TypeError):
        pass

    return ""


def _convert_mkdocs_nav_to_tree(
    nav_items: list,
    name_to_doc: Dict[str, int],
    parent_path: str = "",
) -> List[Dict]:
    """Recursively convert mkdocs nav YAML structure to editor tree format.
    
    mkdocs nav format examples:
      - Home: index.md
      - Category Name:
          - Article Title: uuid.md
          - Sub Category:
              - Article: uuid.md
    
    Output: [{id, name, parent_path, mark, status, children, file_ref}, ...]
    """
    result = []
    for item in nav_items:
        if isinstance(item, dict):
            for key, value in item.items():
                # Skip Home/index entry
                if key == "Home" and isinstance(value, str) and "index" in value:
                    continue

                node_id = f"{parent_path}/{key}" if parent_path else key

                if isinstance(value, str):
                    # Leaf node: article -> filename.md
                    filename = value
                    mark = _resolve_doc_id(key, filename, name_to_doc)
                    # Store the UUID/filename reference for publish compatibility
                    file_ref = filename.replace('.md', '').strip()
                    result.append({
                        "id": node_id,
                        "name": key,
                        "parent_path": parent_path,
                        "mark": mark,
                        "status": 0,
                        "children": [],
                        "file_ref": file_ref,
                    })
                elif isinstance(value, list):
                    # Directory node: category -> [children]
                    children = _convert_mkdocs_nav_to_tree(
                        value, name_to_doc, node_id
                    )
                    result.append({
                        "id": node_id,
                        "name": key,
                        "parent_path": parent_path,
                        "mark": "",
                        "status": 0,
                        "children": children,
                    })
        elif isinstance(item, str):
            # Bare string entry (rare): "filename.md"
            stem = item.replace('.md', '').strip()
            if stem == "index":
                continue
            node_id = f"{parent_path}/{stem}" if parent_path else stem
            mark = _resolve_doc_id(stem, item, name_to_doc)
            result.append({
                "id": node_id,
                "name": stem,
                "parent_path": parent_path,
                "mark": mark,
                "status": 0,
                "children": [],
                "file_ref": stem,
            })
    return result


# ============ WIKI_MENU_JSON2 based navigation (FALLBACK #2) ============
# These functions are only used when mkdocs.yml is unavailable.
# Primary navigation now comes from _parse_mkdocs_nav() above.

def _convert_menu_json_to_tree(
    menu_items: List[Dict],
    name_to_doc: Dict[str, int],
    parent_path: str = "",
) -> List[Dict]:
    """Convert WIKI_MENU_JSON2 format to our nav tree format.
    
    Input format: [{"id": "3", "label": "ESP Wireless", "href": "", "children": [...]}]
    Output format: [{"id": "...", "name": "...", "parent_path": "", "mark": "", "children": [...]}]
    """
    result = []
    for item in menu_items:
        label = item.get("label", "")
        href = item.get("href", "")
        children_data = item.get("children", [])
        
        if not label:
            continue
        
        # Skip "Home" entry
        if label == "Home" and not href and not children_data:
            continue
        
        node_id = f"{parent_path}/{label}" if parent_path else label
        
        # Determine if this is a doc node (has href) or a directory node
        is_doc = bool(href) and not children_data
        mark = ""
        doc_id = None
        
        if href:
            # Try to find the doc by name in wiki_list
            # Strategy 1: exact label match
            if label in name_to_doc:
                mark = str(name_to_doc[label])
            else:
                # Strategy 2: derive name from href (remove .html, decode URL encoding)
                href_name = href.replace('.html', '')
                href_name = urllib.parse.unquote(href_name).strip()
                if href_name in name_to_doc:
                    mark = str(name_to_doc[href_name])
                else:
                    # Strategy 3: replace underscores with spaces in href_name
                    href_name_spaces = href_name.replace('_', ' ')
                    if href_name_spaces in name_to_doc:
                        mark = str(name_to_doc[href_name_spaces])
        
        node = {
            "id": node_id,
            "name": label,
            "parent_path": parent_path,
            "mark": mark,
            "status": 0,
            "children": [],
        }
        
        # Recursively process children
        if children_data:
            node["children"] = _convert_menu_json_to_tree(
                children_data, name_to_doc, node_id
            )
        
        result.append(node)
    
    return result


# ============ Path-based tree (FALLBACK #3) ============

def _build_tree_from_dirs(dirs: List[str]) -> List[Dict]:
    """[FALLBACK ONLY] Build tree from wiki_list path directories.
    Used only when both mkdocs.yml and WIKI_MENU_JSON2 are unavailable."""
    all_paths = set()
    for d in dirs:
        parts = d.split('/') if d else []
        for i in range(len(parts)):
            all_paths.add('/'.join(parts[:i+1]))
    
    nodes = {}
    for p in all_paths:
        parts = p.split('/')
        name = parts[-1]
        parent = '/'.join(parts[:-1]) if len(parts) > 1 else ""
        nodes[p] = {
            "id": p,
            "name": name,
            "parent_path": parent,
            "mark": "",
            "status": 3,
            "children": [],
        }
    
    roots = []
    for p, node in nodes.items():
        parent = node["parent_path"]
        if parent == "" or parent not in nodes:
            roots.append(node)
        else:
            nodes[parent]["children"].append(node)
    
    def sort_tree(items):
        items.sort(key=lambda x: x["name"].lower())
        for item in items:
            if item["children"]:
                sort_tree(item["children"])
    sort_tree(roots)
    
    return roots


@router.get("/tree")
def get_nav_tree(db: Session = Depends(get_db)):
    """Get navigation tree. Priority:
    1. Parse mkdocs.yml nav (matches actual wiki site structure)
    2. Fallback to WIKI_MENU_JSON2 from type_list
    3. Fallback to wiki_list path-based tree
    """

    # --- Priority 1: mkdocs.yml ---
    mkdocs_tree = _parse_mkdocs_nav(db)
    if mkdocs_tree:
        return mkdocs_tree

    # --- Priority 2: WIKI_MENU_JSON2 (legacy fallback) ---
    logger.info("mkdocs.yml nav unavailable, falling back to WIKI_MENU_JSON2")
    menu_node = (
        db.query(TypeList)
        .filter(TypeList.name == WIKI_MENU_NODE_NAME, TypeList.status == 0)
        .first()
    )

    if menu_node and menu_node.mark:
        try:
            menu_data = json_lib.loads(menu_node.mark)
            menu_list = menu_data.get("list", [])
            if menu_list:
                name_to_doc = _build_name_to_doc_map(db)
                return _convert_menu_json_to_tree(menu_list, name_to_doc)
        except (json_lib.JSONDecodeError, TypeError, AttributeError):
            pass  # Fall through to fallback

    # --- Priority 3: wiki_list path-based tree ---
    logger.info("WIKI_MENU_JSON2 unavailable, falling back to path-based tree")
    docs = db.query(WikiList).filter(WikiList.status.in_([0, 3, 4])).all()
    dirs = set()
    for doc in docs:
        normalized = _normalize_path(doc.path)
        if normalized:
            dirs.add(normalized)

    return _build_tree_from_dirs(list(dirs))


@router.get("")
def list_nav_nodes(db: Session = Depends(get_db)):
    """获取所有导航节点（列表形式）"""
    nodes = db.query(TypeList).order_by(TypeList.id).all()
    return [
        {
            "id": n.id,
            "name": n.name,
            "parent_path": n.parent_path,
            "mark": n.mark,
            "status": n.status,
        }
        for n in nodes
    ]


@router.post("")
def create_nav_node(data: NavNodeCreate, db: Session = Depends(get_db)):
    """创建导航节点，同时同步更新 mkdocs.yml"""
    node = TypeList(
        name=data.name,
        parent_path=data.parent_path or "",
        mark=data.mark or "",
        status=0,
    )
    db.add(node)
    db.commit()
    db.refresh(node)

    # Sync to mkdocs.yml
    _sync_node_add_to_mkdocs(data.name, data.parent_path or "", data.mark or "")

    return {
        "id": node.id,
        "name": node.name,
        "parent_path": node.parent_path,
        "mark": node.mark,
        "status": node.status,
    }


@router.put("/tree/batch")
def batch_update_tree(data: NavTreeUpdate, db: Session = Depends(get_db)):
    """批量更新树结构"""
    for item in data.nodes:
        node = db.query(TypeList).filter(TypeList.id == item.get("id")).first()
        if node:
            if "parent_path" in item:
                node.parent_path = item["parent_path"]
            if "name" in item:
                node.name = item["name"]
            if "status" in item:
                node.status = item["status"]
    db.commit()
    
    nodes = db.query(TypeList).order_by(TypeList.id).all()
    return [
        {
            "id": n.id,
            "name": n.name,
            "parent_path": n.parent_path,
            "mark": n.mark,
            "status": n.status,
        }
        for n in nodes
    ]


# ============ Sync individual node changes to mkdocs.yml ============

def _sync_node_add_to_mkdocs(name: str, parent_path: str, mark: str):
    """Add a new node to mkdocs.yml nav structure.
    
    Args:
        name: Node name (menu label)
        parent_path: Parent path like "ESP Wireless" or "ESP Wireless/Sub Category"
        mark: Doc ID string (empty for directory nodes)
    """
    if not os.path.isfile(MKDOCS_YML_PATH):
        logger.info("mkdocs.yml not found, skipping sync for node add")
        return

    try:
        with open(MKDOCS_YML_PATH, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        if not config or not isinstance(config, dict):
            return

        nav = config.get("nav", [])

        # Build the new nav entry
        if mark:
            new_entry = {name: f"{mark}.md"}
        else:
            new_entry = {name: []}

        if not parent_path:
            # Add to root level
            nav.append(new_entry)
        else:
            # Find parent node and add as child
            parent_parts = parent_path.split("/")
            _insert_into_nav(nav, parent_parts, new_entry)

        config["nav"] = nav
        with open(MKDOCS_YML_PATH, "w", encoding="utf-8") as f:
            yaml.dump(config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
        logger.info("Synced node add to mkdocs.yml: %s (parent: %s)", name, parent_path)
    except Exception as e:
        logger.error("Failed to sync node add to mkdocs.yml: %s", e)


def _insert_into_nav(nav_items: list, parent_parts: list, new_entry: dict):
    """Recursively find the parent node in nav and append new_entry to its children."""
    if not parent_parts:
        return False

    target_name = parent_parts[0]
    remaining = parent_parts[1:]

    for item in nav_items:
        if isinstance(item, dict):
            for key, value in item.items():
                if key == target_name:
                    if not remaining:
                        # Found the parent, add child
                        if isinstance(value, list):
                            value.append(new_entry)
                        else:
                            # Parent was a leaf node, convert to directory
                            item[key] = [new_entry]
                        return True
                    elif isinstance(value, list):
                        # Go deeper
                        if _insert_into_nav(value, remaining, new_entry):
                            return True
    return False


def _sync_node_update_to_mkdocs(old_name: str, old_parent_path: str, new_name: str, new_mark: str):
    """Update a node in mkdocs.yml nav structure (rename or change doc link)."""
    if not os.path.isfile(MKDOCS_YML_PATH):
        return

    try:
        with open(MKDOCS_YML_PATH, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        if not config or not isinstance(config, dict):
            return

        nav = config.get("nav", [])

        # Find and update the node
        parent_parts = old_parent_path.split("/") if old_parent_path else []
        target_list = nav
        # Navigate to parent
        for part in parent_parts:
            if not part:
                continue
            found = False
            for item in target_list:
                if isinstance(item, dict):
                    for key, value in item.items():
                        if key == part and isinstance(value, list):
                            target_list = value
                            found = True
                            break
                if found:
                    break
            if not found:
                logger.warning("Parent path not found in nav for update: %s", old_parent_path)
                return

        # Find the node in target_list and update it
        for i, item in enumerate(target_list):
            if isinstance(item, dict) and old_name in item:
                old_value = item[old_name]
                if new_mark:
                    new_value = f"{new_mark}.md"
                elif isinstance(old_value, list):
                    new_value = old_value  # Keep children
                else:
                    new_value = []

                # Replace the entry (rename key)
                target_list[i] = {new_name: new_value}
                break

        config["nav"] = nav
        with open(MKDOCS_YML_PATH, "w", encoding="utf-8") as f:
            yaml.dump(config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
        logger.info("Synced node update to mkdocs.yml: %s -> %s", old_name, new_name)
    except Exception as e:
        logger.error("Failed to sync node update to mkdocs.yml: %s", e)


def _sync_node_delete_from_mkdocs(name: str, parent_path: str):
    """Remove a node from mkdocs.yml nav structure."""
    if not os.path.isfile(MKDOCS_YML_PATH):
        return

    try:
        with open(MKDOCS_YML_PATH, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        if not config or not isinstance(config, dict):
            return

        nav = config.get("nav", [])

        # Navigate to parent
        parent_parts = parent_path.split("/") if parent_path else []
        target_list = nav
        for part in parent_parts:
            if not part:
                continue
            found = False
            for item in target_list:
                if isinstance(item, dict):
                    for key, value in item.items():
                        if key == part and isinstance(value, list):
                            target_list = value
                            found = True
                            break
                if found:
                    break
            if not found:
                logger.warning("Parent path not found in nav for delete: %s", parent_path)
                return

        # Find and remove the node
        for i, item in enumerate(target_list):
            if isinstance(item, dict) and name in item:
                target_list.pop(i)
                break

        config["nav"] = nav
        with open(MKDOCS_YML_PATH, "w", encoding="utf-8") as f:
            yaml.dump(config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
        logger.info("Synced node delete from mkdocs.yml: %s (parent: %s)", name, parent_path)
    except Exception as e:
        logger.error("Failed to sync node delete from mkdocs.yml: %s", e)


# ============ Reorder: write tree back to mkdocs.yml ============

def _tree_to_mkdocs_nav(tree_nodes: list) -> list:
    """Convert editor tree format back to mkdocs nav YAML structure.
    
    Input:  [{name, mark, file_ref, children: [...]}, ...]
    Output: [{name: filename.md}, {name: [{...}, ...]}, ...]
    """
    result = []
    for node in tree_nodes:
        name = node.get("name", "")
        children = node.get("children", [])
        file_ref = node.get("file_ref", "")

        if children:
            # Directory node: recurse
            sub_nav = _tree_to_mkdocs_nav(children)
            result.append({name: sub_nav})
        elif file_ref:
            # Leaf node with file reference (UUID or ID)
            filename = file_ref if file_ref.endswith(".md") else f"{file_ref}.md"
            result.append({name: filename})
        else:
            # Leaf node without file reference (mark might have doc_id)
            mark = node.get("mark", "")
            if mark:
                result.append({name: f"{mark}.md"})
            else:
                # Empty directory or unlinked node, keep as empty category
                result.append({name: []})
    return result


def _sync_nav_to_mkdocs_site(new_nav: list) -> str:
    """Sync nav changes to the mkdocs-site directory and restart mkdocs container.
    
    This allows menu order changes to take effect on the live site without
    a full publish (which regenerates all doc files).
    
    Returns a status message string.
    """
    _BASE_DIR_PUB = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if os.path.basename(_BASE_DIR_PUB) == "backend":
        _PROJECT_ROOT_PUB = os.path.normpath(os.path.join(_BASE_DIR_PUB, ".."))
    else:
        _PROJECT_ROOT_PUB = _BASE_DIR_PUB
    MKDOCS_SITE_DIR = os.path.join(_PROJECT_ROOT_PUB, "mkdocs-site")

    if not os.path.isdir(MKDOCS_SITE_DIR):
        logger.info("mkdocs-site dir not found at %s, skipping sync", MKDOCS_SITE_DIR)
        return ""

    try:
        site_mkdocs_yml = os.path.join(MKDOCS_SITE_DIR, "mkdocs.yml")

        # Load the site's existing config (preserve site_name, theme, etc.)
        site_config = {}
        if os.path.isfile(site_mkdocs_yml):
            with open(site_mkdocs_yml, "r", encoding="utf-8") as f:
                site_config = yaml.safe_load(f) or {}

        # Merge: inject our nav into the site config
        site_config["nav"] = new_nav

        with open(site_mkdocs_yml, "w", encoding="utf-8") as f:
            yaml.dump(
                site_config, f,
                allow_unicode=True, default_flow_style=False, sort_keys=False,
            )
        logger.info("Merged nav into mkdocs-site/mkdocs.yml")

        # Restart mkdocs container to pick up nav changes
        try:
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
                return "，已同步到线上站点"
            else:
                body = resp.read().decode()
                logger.warning("Failed to restart mkdocs: HTTP %d %s", resp.status, body)
                return "，已同步配置（容器重启失败，请手动重启）"
            conn.close()
        except Exception as re:
            logger.warning("Failed to restart mkdocs container: %s", re)
            return "，已同步配置（容器重启失败，请手动重启）"
    except Exception as e:
        logger.warning("Failed to sync nav to mkdocs-site: %s", e)
        return f"，同步到线上站点失败: {e}"


@router.put("/tree/reorder")
def reorder_nav_tree(data: dict, db: Session = Depends(get_db)):
    """Reorder navigation tree: write the new tree structure back to mkdocs.yml.
    
    Expects: { "tree": [{name, mark, file_ref, children: [...]}, ...] }
    This directly updates the mkdocs.yml nav field to persist menu order changes,
    and syncs to the live mkdocs site (no full publish needed).
    """
    tree = data.get("tree", [])
    if not tree:
        raise HTTPException(400, "树结构不能为空")

    if not os.path.isfile(MKDOCS_YML_PATH):
        raise HTTPException(400, "mkdocs.yml 文件不存在，无法保存菜单顺序")

    try:
        # Load existing mkdocs.yml config
        with open(MKDOCS_YML_PATH, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        if not config or not isinstance(config, dict):
            raise HTTPException(500, "mkdocs.yml 格式异常")

        # Convert tree to mkdocs nav format
        new_nav = _tree_to_mkdocs_nav(tree)

        # Preserve Home entry at the top
        has_home = False
        for item in new_nav:
            if isinstance(item, dict) and "Home" in item:
                has_home = True
                break
        if not has_home:
            new_nav.insert(0, {"Home": "index.md"})

        # Update nav in config
        config["nav"] = new_nav

        # Write back to mkdocs.yml
        with open(MKDOCS_YML_PATH, "w", encoding="utf-8") as f:
            yaml.dump(
                config, f,
                allow_unicode=True, default_flow_style=False, sort_keys=False,
            )

        logger.info("Nav tree reordered and saved to mkdocs.yml (%d top-level items)", len(new_nav))

        # Sync nav to live mkdocs site (no full publish needed)
        sync_msg = _sync_nav_to_mkdocs_site(new_nav)

        return {"ok": True, "message": f"菜单顺序已保存（{len(new_nav)} 个顶级节点）{sync_msg}"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to save nav tree to mkdocs.yml: %s", e)
        raise HTTPException(500, f"保存菜单顺序失败: {str(e)}")


@router.put("/{node_id}")
def update_nav_node(node_id: str, data: NavNodeUpdate, db: Session = Depends(get_db)):
    """更新导航节点，同时同步更新 mkdocs.yml
    
    node_id 可以是数字 ID 或路径字符串（如 "Parent/Child"）
    """
    # Resolve node: by numeric ID or by path string
    node = None
    if node_id.isdigit():
        node = db.query(TypeList).filter(TypeList.id == int(node_id)).first()
    else:
        # Path string: parse name and parent_path
        parts = node_id.split("/")
        name = parts[-1]
        parent_path = "/".join(parts[:-1]) if len(parts) > 1 else ""
        node = db.query(TypeList).filter(
            TypeList.name == name,
            TypeList.parent_path == parent_path,
            TypeList.status == 0
        ).first()
    
    if not node:
        raise HTTPException(404, "菜单节点不存在")
    
    old_name = node.name
    old_parent_path = node.parent_path

    if data.name is not None:
        node.name = data.name
    if data.parent_path is not None:
        node.parent_path = data.parent_path
    if data.mark is not None:
        node.mark = data.mark
    if data.status is not None:
        node.status = data.status
    
    db.commit()
    db.refresh(node)

    # Sync to mkdocs.yml: update the node in nav
    _sync_node_update_to_mkdocs(
        old_name, old_parent_path,
        node.name, node.mark or ""
    )

    return {
        "id": node.id,
        "name": node.name,
        "parent_path": node.parent_path,
        "mark": node.mark,
        "status": node.status,
    }


@router.delete("/{node_id}")
def delete_nav_node(node_id: str, db: Session = Depends(get_db)):
    """删除导航节点，同时同步更新 mkdocs.yml
    
    node_id 可以是数字 ID 或路径字符串（如 "Parent/Child"）
    """
    # Resolve node: by numeric ID or by path string
    node = None
    node_name = ""
    node_parent_path = ""
    
    if node_id.isdigit():
        node = db.query(TypeList).filter(TypeList.id == int(node_id)).first()
        if node:
            node_name = node.name
            node_parent_path = node.parent_path or ""
    else:
        # Path string: parse name and parent_path
        parts = node_id.split("/")
        node_name = parts[-1]
        node_parent_path = "/".join(parts[:-1]) if len(parts) > 1 else ""
        node = db.query(TypeList).filter(
            TypeList.name == node_name,
            TypeList.parent_path == node_parent_path,
            TypeList.status == 0
        ).first()
    
    # Sync to mkdocs.yml: remove the node from nav (always do this)
    _sync_node_delete_from_mkdocs(node_name, node_parent_path)

    # If node exists in DB, soft delete it
    if node:
        node.status = 1
        db.commit()
    
    return {"ok": True}

