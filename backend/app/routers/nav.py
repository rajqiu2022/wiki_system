from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import NavNode
from ..schemas import NavNodeCreate, NavNodeUpdate, NavNodeOut, NavTreeUpdate

router = APIRouter(prefix="/api/nav", tags=["navigation"])


def _build_tree(nodes, parent_id=None):
    result = []
    for n in sorted(nodes, key=lambda x: x.sort_order):
        if n.parent_id == parent_id:
            children = _build_tree(nodes, n.id)
            result.append({
                "id": n.id,
                "title": n.title,
                "parent_id": n.parent_id,
                "doc_id": n.doc_id,
                "sort_order": n.sort_order,
                "children": children,
            })
    return result


@router.get("/tree")
def get_nav_tree(db: Session = Depends(get_db)):
    nodes = db.query(NavNode).all()
    return _build_tree(nodes)


@router.get("", response_model=List[NavNodeOut])
def list_nav_nodes(db: Session = Depends(get_db)):
    return db.query(NavNode).order_by(NavNode.sort_order).all()


@router.post("", response_model=NavNodeOut)
def create_nav_node(data: NavNodeCreate, db: Session = Depends(get_db)):
    node = NavNode(
        title=data.title,
        parent_id=data.parent_id,
        doc_id=data.doc_id,
        sort_order=data.sort_order,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return node


@router.put("/{node_id}", response_model=NavNodeOut)
def update_nav_node(node_id: str, data: NavNodeUpdate, db: Session = Depends(get_db)):
    node = db.query(NavNode).filter(NavNode.id == node_id).first()
    if not node:
        raise HTTPException(404, "菜单节点不存在")
    if data.title is not None:
        node.title = data.title
    if data.parent_id is not None:
        node.parent_id = data.parent_id if data.parent_id else None
    if data.doc_id is not None:
        node.doc_id = data.doc_id if data.doc_id else None
    if data.sort_order is not None:
        node.sort_order = data.sort_order
    db.commit()
    db.refresh(node)
    return node


@router.delete("/{node_id}")
def delete_nav_node(node_id: str, db: Session = Depends(get_db)):
    node = db.query(NavNode).filter(NavNode.id == node_id).first()
    if not node:
        raise HTTPException(404, "菜单节点不存在")
    _delete_children(node_id, db)
    db.delete(node)
    db.commit()
    return {"ok": True}


def _delete_children(parent_id: str, db: Session):
    children = db.query(NavNode).filter(NavNode.parent_id == parent_id).all()
    for child in children:
        _delete_children(child.id, db)
        db.delete(child)


@router.put("/tree/batch", response_model=List[NavNodeOut])
def batch_update_tree(data: NavTreeUpdate, db: Session = Depends(get_db)):
    for item in data.nodes:
        node = db.query(NavNode).filter(NavNode.id == item["id"]).first()
        if node:
            if "parent_id" in item:
                node.parent_id = item["parent_id"] if item["parent_id"] else None
            if "sort_order" in item:
                node.sort_order = item["sort_order"]
            if "title" in item:
                node.title = item["title"]
    db.commit()
    nodes = db.query(NavNode).order_by(NavNode.sort_order).all()
    return nodes
