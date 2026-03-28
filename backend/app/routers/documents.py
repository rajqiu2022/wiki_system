from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta

from ..database import get_db
from ..models import Document, User
from ..schemas import DocCreate, DocUpdate, DocOut, DocListItem

router = APIRouter(prefix="/api/docs", tags=["documents"])

LOCK_TIMEOUT_MINUTES = 30


def _doc_to_out(doc: Document) -> dict:
    return {
        "id": doc.id,
        "title": doc.title,
        "content": doc.content,
        "status": doc.status,
        "created_by": doc.created_by,
        "created_at": doc.created_at,
        "updated_at": doc.updated_at,
        "locked_by": doc.locked_by,
        "locked_at": doc.locked_at,
        "creator_name": doc.creator.display_name if doc.creator else None,
        "locker_name": doc.locker.display_name if doc.locker else None,
    }


def _check_lock_expired(doc: Document, db: Session):
    """自动释放超时锁"""
    if doc.locked_by and doc.locked_at:
        if datetime.now(timezone.utc) - doc.locked_at.replace(tzinfo=timezone.utc) > timedelta(minutes=LOCK_TIMEOUT_MINUTES):
            doc.locked_by = None
            doc.locked_at = None
            db.commit()


@router.get("", response_model=List[DocListItem])
def list_documents(
    status: str = Query(None),
    keyword: str = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Document)
    if status:
        q = q.filter(Document.status == status)
    if keyword:
        q = q.filter(Document.title.contains(keyword))
    docs = q.order_by(Document.updated_at.desc()).all()
    result = []
    for doc in docs:
        _check_lock_expired(doc, db)
        result.append({
            "id": doc.id,
            "title": doc.title,
            "status": doc.status,
            "created_by": doc.created_by,
            "creator_name": doc.creator.display_name if doc.creator else None,
            "updated_at": doc.updated_at,
            "locked_by": doc.locked_by,
            "locker_name": doc.locker.display_name if doc.locker else None,
        })
    return result


@router.post("", response_model=DocOut)
def create_document(data: DocCreate, db: Session = Depends(get_db)):
    # 验证 created_by 用户是否存在
    if data.created_by:
        user = db.query(User).filter(User.id == data.created_by).first()
        if not user:
            raise HTTPException(400, f"用户不存在: {data.created_by}")
    doc = Document(title=data.title, content=data.content, created_by=data.created_by)
    db.add(doc)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"创建文档失败: {str(e)}")
    db.refresh(doc)
    return _doc_to_out(doc)


@router.get("/{doc_id}", response_model=DocOut)
def get_document(doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "文档不存在")
    _check_lock_expired(doc, db)
    return _doc_to_out(doc)


@router.put("/{doc_id}", response_model=DocOut)
def update_document(doc_id: str, data: DocUpdate, user_id: str = Query(...), db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "文档不存在")
    _check_lock_expired(doc, db)
    if doc.locked_by and doc.locked_by != user_id:
        raise HTTPException(423, "文档正在被其他人编辑")
    if data.title is not None:
        doc.title = data.title
    if data.content is not None:
        doc.content = data.content
    if data.status is not None:
        doc.status = data.status
    doc.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(doc)
    return _doc_to_out(doc)


@router.post("/{doc_id}/lock")
def lock_document(doc_id: str, user_id: str = Query(...), db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "文档不存在")
    _check_lock_expired(doc, db)
    if doc.locked_by and doc.locked_by != user_id:
        locker_name = doc.locker.display_name if doc.locker else "未知用户"
        raise HTTPException(423, f"文档正在被 {locker_name} 编辑")
    doc.locked_by = user_id
    doc.locked_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "message": "已锁定"}


@router.post("/{doc_id}/unlock")
def unlock_document(doc_id: str, user_id: str = Query(...), force: bool = Query(False), db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "文档不存在")
    if doc.locked_by and doc.locked_by != user_id and not force:
        raise HTTPException(403, "只能解锁自己锁定的文档")
    doc.locked_by = None
    doc.locked_at = None
    db.commit()
    return {"ok": True, "message": "已解锁"}


@router.delete("/{doc_id}")
def delete_document(doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "文档不存在")
    db.delete(doc)
    db.commit()
    return {"ok": True}
