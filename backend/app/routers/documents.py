from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime

from ..database import get_db
from ..models import WikiList, WikiFile, User, DocumentLock
from ..schemas import DocCreate, DocUpdate, DocOut, DocListItem, FileContentOut, FileContentUpdate
from ..auth import get_current_user

router = APIRouter(prefix="/api/docs", tags=["documents"])

LOCK_TIMEOUT_MINUTES = 30
MAX_FILE_VERSIONS = 10  # Maximum number of versions to keep per document


def _get_doc_content(db: Session, list_id: int) -> Optional[str]:
    """获取文档最新版本内容（按 id DESC 取最新记录）"""
    wiki_file = (
        db.query(WikiFile)
        .filter(WikiFile.list_id == list_id)
        .order_by(WikiFile.id.desc())
        .first()
    )
    return wiki_file.content if wiki_file else None


def _get_doc_with_content(wiki_list: WikiList, db: Session) -> dict:
    """组装文档输出（包含内容）"""
    content = _get_doc_content(db, wiki_list.id)
    return {
        "id": wiki_list.id,
        "name": wiki_list.name,
        "path": wiki_list.path,
        "description": wiki_list.description,
        "author": wiki_list.author,
        "create_time": wiki_list.create_time,
        "status": wiki_list.status,
        "current_editor": wiki_list.current_editor,
        "content": content,
    }


@router.get("")
def list_documents(
    status: Optional[int] = None,
    keyword: Optional[str] = None,
    path: Optional[str] = None,
    dir_path: Optional[str] = None,
    doc_ids: Optional[str] = None,  # Comma-separated doc IDs for directory filtering
    db: Session = Depends(get_db),
):
    """获取文档列表
    
    - path: 精确路径匹配
    - dir_path: 获取某目录下的所有文章（path 以此开头）
    - doc_ids: 逗号分隔的文档 ID 列表（用于目录过滤）
    """
    q = db.query(WikiList)
    if status is not None:
        q = q.filter(WikiList.status == status)
    if keyword:
        q = q.filter(WikiList.name.contains(keyword))
    if path:
        q = q.filter(WikiList.path.contains(path))
    if doc_ids:
        # Filter by document ID list (from nav tree directory node)
        try:
            id_list = [int(x.strip()) for x in doc_ids.split(",") if x.strip()]
            if id_list:
                q = q.filter(WikiList.id.in_(id_list))
        except ValueError:
            pass
    elif dir_path:
        # Fallback: match dir_path prefix
        q = q.filter(WikiList.path.startswith(dir_path))
    
    docs = q.order_by(WikiList.id.desc()).all()
    return [
        {
            "id": doc.id,
            "name": doc.name,
            "path": doc.path,
            "author": doc.author,
            "status": doc.status,
            "create_time": doc.create_time,
            "current_editor": doc.current_editor,
        }
        for doc in docs
    ]


@router.post("")
def create_document(data: DocCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """创建新文档"""
    # 创建 WikiList
    wiki_list = WikiList(
        name=data.name,
        path=data.path or "",
        description=data.description or "",
        author=data.author or current_user.username,
        create_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        status=0,
        current_editor="",
    )
    db.add(wiki_list)
    db.commit()
    db.refresh(wiki_list)
    
    # 创建对应的 WikiFile
    wiki_file = WikiFile(
        list_id=wiki_list.id,
        content="",
        modifier=current_user.username,
        modified_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    )
    db.add(wiki_file)
    db.commit()
    
    return _get_doc_with_content(wiki_list, db)


@router.get("/{doc_id}")
def get_document(doc_id: int, db: Session = Depends(get_db)):
    """获取单个文档（包含内容）"""
    wiki_list = db.query(WikiList).filter(WikiList.id == doc_id).first()
    if not wiki_list:
        raise HTTPException(404, "文档不存在")
    return _get_doc_with_content(wiki_list, db)


@router.put("/{doc_id}")
def update_document(
    doc_id: int, 
    data: DocUpdate, 
    user_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """更新文档"""
    wiki_list = db.query(WikiList).filter(WikiList.id == doc_id).first()
    if not wiki_list:
        raise HTTPException(404, "文档不存在")
    
    # 检查是否被锁定
    if wiki_list.current_editor and wiki_list.current_editor != current_user.username:
        raise HTTPException(423, f"文档正在被 {wiki_list.current_editor} 编辑")
    
    # 更新 WikiList
    if data.name is not None:
        wiki_list.name = data.name
    if data.path is not None:
        wiki_list.path = data.path
    if data.description is not None:
        wiki_list.description = data.description
    if data.status is not None:
        wiki_list.status = data.status
    
    db.commit()
    db.refresh(wiki_list)
    return _get_doc_with_content(wiki_list, db)


@router.put("/{doc_id}/content")
def update_document_content(
    doc_id: int,
    data: FileContentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """更新文档内容"""
    wiki_list = db.query(WikiList).filter(WikiList.id == doc_id).first()
    if not wiki_list:
        raise HTTPException(404, "文档不存在")
    
    # 检查是否被锁定
    if wiki_list.current_editor and wiki_list.current_editor != current_user.username:
        raise HTTPException(423, f"文档正在被 {wiki_list.current_editor} 编辑")
    
    # Insert a new WikiFile record to preserve version history
    # (compatible with Go backend's multi-version mechanism)
    wiki_file = WikiFile(
        list_id=doc_id,
        content=data.content,
        modifier=data.modifier or current_user.username,
        modified_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    )
    db.add(wiki_file)
    db.commit()
    
    # Clean up old versions, keep only the latest MAX_FILE_VERSIONS
    all_versions = (
        db.query(WikiFile)
        .filter(WikiFile.list_id == doc_id)
        .order_by(WikiFile.id.desc())
        .all()
    )
    if len(all_versions) > MAX_FILE_VERSIONS:
        old_versions = all_versions[MAX_FILE_VERSIONS:]
        for old in old_versions:
            db.delete(old)
        db.commit()
    
    return {"ok": True, "message": "内容已保存"}


@router.post("/{doc_id}/lock")
def lock_document(
    doc_id: int, 
    user_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """锁定文档（开始编辑）"""
    wiki_list = db.query(WikiList).filter(WikiList.id == doc_id).first()
    if not wiki_list:
        raise HTTPException(404, "文档不存在")
    
    if wiki_list.current_editor and wiki_list.current_editor != current_user.username:
        raise HTTPException(423, f"文档正在被 {wiki_list.current_editor} 编辑")
    
    wiki_list.current_editor = current_user.username
    db.commit()
    return {"ok": True, "message": "已锁定", "editor": current_user.username}


@router.post("/{doc_id}/unlock")
def unlock_document(
    doc_id: int, 
    user_id: Optional[int] = Query(None),
    force: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """解锁文档"""
    wiki_list = db.query(WikiList).filter(WikiList.id == doc_id).first()
    if not wiki_list:
        raise HTTPException(404, "文档不存在")
    
    if wiki_list.current_editor and wiki_list.current_editor != current_user.username and not force:
        raise HTTPException(403, "只能解锁自己锁定的文档")
    
    wiki_list.current_editor = ""
    db.commit()
    return {"ok": True, "message": "已解锁"}


@router.delete("/{doc_id}")
def delete_document(doc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """删除文档"""
    wiki_list = db.query(WikiList).filter(WikiList.id == doc_id).first()
    if not wiki_list:
        raise HTTPException(404, "文档不存在")
    
    # 同时删除关联的 WikiFile
    db.query(WikiFile).filter(WikiFile.list_id == doc_id).delete()
    db.delete(wiki_list)
    db.commit()
    return {"ok": True}
