from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime

from ..database import get_db
from ..models import User
from ..schemas import UserCreate, UserOut, UserUpdate, LoginRequest, TokenOut
from ..auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_admin,
)

router = APIRouter(prefix="/api/users", tags=["users"])


@router.post("/login", response_model=TokenOut)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    """用户登录"""
    user = db.query(User).filter(User.username == data.username).first()
    if not user:
        raise HTTPException(400, "用户名或密码错误")
    if not verify_password(data.password, user.password):
        raise HTTPException(400, "用户名或密码错误")
    token = create_access_token(user.id)
    return TokenOut(
        access_token=token, 
        user=UserOut(id=user.id, username=user.username, role=user.role, create_time=user.create_time)
    )


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    """获取当前登录用户信息"""
    return UserOut(
        id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        create_time=current_user.create_time
    )


@router.post("", response_model=UserOut)
def create_user(data: UserCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """创建新用户（需要管理员权限）"""
    existing = db.query(User).filter(User.username == data.username).first()
    if existing:
        raise HTTPException(400, "用户名已存在")
    user = User(
        username=data.username,
        password=hash_password(data.password),  # 新用户使用 bcrypt
        role=data.role,
        create_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserOut(id=user.id, username=user.username, role=user.role, create_time=user.create_time)


@router.get("")
def list_users(
    page: int = 1, page_size: int = 10, keyword: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """分页获取用户列表"""
    query = db.query(User)
    if keyword:
        query = query.filter(User.username.contains(keyword))
    total = query.count()
    items = query.order_by(User.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total, 
        "page": page, 
        "page_size": page_size, 
        "items": [UserOut(id=u.id, username=u.username, role=u.role, create_time=u.create_time) for u in items]
    }


@router.get("/all", response_model=List[UserOut])
def list_all_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取所有用户"""
    users = db.query(User).all()
    return [UserOut(id=u.id, username=u.username, role=u.role, create_time=u.create_time) for u in users]


@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """删除用户（需要管理员权限）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    if user.username == "admin":
        raise HTTPException(400, "不能删除默认管理员")
    db.delete(user)
    db.commit()
    return {"ok": True}


@router.put("/{user_id}")
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """更新用户信息（需要管理员权限）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    if data.password:
        user.password = hash_password(data.password)
    if data.role:
        user.role = data.role
    db.commit()
    return {"ok": True}


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取单个用户信息"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    return UserOut(id=user.id, username=user.username, role=user.role, create_time=user.create_time)
