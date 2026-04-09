from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from ..database import SessionLocal
from ..auth import get_current_user
from ..models import User, Requirement
from ..schemas import RequirementCreate, RequirementUpdate, RequirementOut

router = APIRouter(prefix="/api/requirements", tags=["requirements"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("", response_model=List[RequirementOut])
def list_requirements(
    type: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all requirements with optional filters"""
    query = db.query(Requirement)
    if type:
        query = query.filter(Requirement.type == type)
    if status:
        query = query.filter(Requirement.status == status)
    if priority:
        query = query.filter(Requirement.priority == priority)
    query = query.order_by(Requirement.created_at.desc())
    return query.offset(skip).limit(limit).all()


@router.get("/{req_id}", response_model=RequirementOut)
def get_requirement(
    req_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single requirement by ID"""
    req = db.query(Requirement).filter(Requirement.id == req_id).first()
    if not req:
        raise HTTPException(404, "Requirement not found")
    return req


@router.post("", response_model=RequirementOut)
def create_requirement(
    data: RequirementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new requirement (admin only)"""
    if current_user.role != "admin":
        raise HTTPException(403, "Only admin can create requirements")
    
    req = Requirement(
        title=data.title,
        description=data.description,
        type=data.type,
        priority=data.priority,
        expected_date=data.expected_date,
        tags=data.tags,
        created_by=current_user.username,
        created_at=datetime.now(),
        status="pending",
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


@router.put("/{req_id}", response_model=RequirementOut)
def update_requirement(
    req_id: int,
    data: RequirementUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a requirement (admin only)"""
    if current_user.role != "admin":
        raise HTTPException(403, "Only admin can update requirements")
    
    req = db.query(Requirement).filter(Requirement.id == req_id).first()
    if not req:
        raise HTTPException(404, "Requirement not found")
    
    update_data = data.dict(exclude_unset=True)
    
    # If status changed to completed, set completed_at
    if update_data.get("status") == "completed" and req.status != "completed":
        update_data["completed_at"] = datetime.now()
    
    for key, value in update_data.items():
        setattr(req, key, value)
    
    db.commit()
    db.refresh(req)
    return req


@router.delete("/{req_id}")
def delete_requirement(
    req_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a requirement (admin only)"""
    if current_user.role != "admin":
        raise HTTPException(403, "Only admin can delete requirements")
    
    req = db.query(Requirement).filter(Requirement.id == req_id).first()
    if not req:
        raise HTTPException(404, "Requirement not found")
    
    db.delete(req)
    db.commit()
    return {"success": True}
