import os
import shutil
import subprocess
import yaml
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Document, NavNode, PublishLog
from ..schemas import PublishLogOut

router = APIRouter(prefix="/api/publish", tags=["publish"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DOCS_DIR = os.path.join(BASE_DIR, "..", "docs")
OUTPUT_DIR = os.path.join(BASE_DIR, "..", "output")
MKDOCS_YML = os.path.join(BASE_DIR, "..", "mkdocs.yml")


def _build_nav_yaml(nodes, all_nodes, docs_map):
    result = []
    for node in sorted(nodes, key=lambda x: x.sort_order):
        children_nodes = [n for n in all_nodes if n.parent_id == node.id]
        if children_nodes:
            sub = _build_nav_yaml(children_nodes, all_nodes, docs_map)
            result.append({node.title: sub})
        elif node.doc_id and node.doc_id in docs_map:
            doc = docs_map[node.doc_id]
            filename = f"{doc.id}.md"
            result.append({node.title: filename})
    return result


@router.post("")
def publish(user_id: str = None, db: Session = Depends(get_db)):
    try:
        # 只发布 pending 状态的文档
        pending_docs = db.query(Document).filter(Document.status == "pending").all()
        if not pending_docs:
            raise HTTPException(400, "没有待发布的文档")

        docs_map = {doc.id: doc for doc in pending_docs}

        # 将所有待发布文档的状态设为 published
        for doc in pending_docs:
            doc.status = "published"
        db.commit()

        published_docs = pending_docs

        if os.path.exists(DOCS_DIR):
            shutil.rmtree(DOCS_DIR)
        os.makedirs(DOCS_DIR, exist_ok=True)

        # 生成首页 index.md
        index_path = os.path.join(DOCS_DIR, "index.md")
        with open(index_path, "w", encoding="utf-8") as f:
            f.write("# Wiki\n\n欢迎访问 Wiki 知识库，请从左侧导航选择文档。\n")

        for doc in published_docs:
            filepath = os.path.join(DOCS_DIR, f"{doc.id}.md")
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(f"# {doc.title}\n\n{doc.content}")

        all_nav_nodes = db.query(NavNode).all()
        root_nodes = [n for n in all_nav_nodes if n.parent_id is None]
        nav = _build_nav_yaml(root_nodes, all_nav_nodes, docs_map)

        if not nav:
            nav = [{doc.title: f"{doc.id}.md"} for doc in published_docs]

        # 在 nav 开头插入首页
        nav.insert(0, {"Home": "index.md"})

        mkdocs_config = {
            "site_name": "Wiki",
            "site_url": "http://localhost:8001/site/",
            "theme": {
                "name": "material",
                "language": "zh",
                "palette": [
                    {"scheme": "default", "primary": "indigo", "accent": "indigo", "toggle": {"icon": "material/brightness-7", "name": "切换到暗色模式"}},
                    {"scheme": "slate", "primary": "indigo", "accent": "indigo", "toggle": {"icon": "material/brightness-4", "name": "切换到亮色模式"}},
                ],
                "features": [
                    "navigation.instant",
                    "navigation.tracking",
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
            "docs_dir": "docs",
            "site_dir": "output",
        }

        with open(MKDOCS_YML, "w", encoding="utf-8") as f:
            yaml.dump(mkdocs_config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

        project_root = os.path.join(BASE_DIR, "..")
        import sys
        result = subprocess.run(
            [sys.executable, "-m", "mkdocs", "build"],
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=60,
        )

        if result.returncode != 0:
            log = PublishLog(
                published_by=user_id,
                doc_count=len(published_docs),
                status="failed",
                message=result.stderr,
            )
            db.add(log)
            db.commit()
            raise HTTPException(500, f"构建失败: {result.stderr}")

        log = PublishLog(
            published_by=user_id,
            doc_count=len(published_docs),
            status="success",
            message=f"成功发布 {len(published_docs)} 篇文档",
        )
        db.add(log)
        db.commit()

        return {"ok": True, "message": f"成功发布 {len(published_docs)} 篇文档", "output_dir": OUTPUT_DIR}

    except HTTPException:
        raise
    except Exception as e:
        log = PublishLog(
            published_by=user_id,
            doc_count=0,
            status="failed",
            message=str(e),
        )
        db.add(log)
        db.commit()
        raise HTTPException(500, f"发布失败: {str(e)}")


@router.get("/logs", response_model=List[PublishLogOut])
def get_publish_logs(db: Session = Depends(get_db)):
    return db.query(PublishLog).order_by(PublishLog.published_at.desc()).limit(20).all()
