from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ---- User ----
class UserOut(BaseModel):
    id: str
    username: str
    display_name: str
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


# ---- Auth ----
class LoginRequest(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserCreate(BaseModel):
    username: str
    display_name: str
    password: str
    role: str = "editor"


# ---- Document ----
class DocCreate(BaseModel):
    title: str
    content: str = ""
    created_by: Optional[str] = None


class DocUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    status: Optional[str] = None


class DocOut(BaseModel):
    id: str
    title: str
    content: str
    status: str
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    locked_by: Optional[str] = None
    locked_at: Optional[datetime] = None
    creator_name: Optional[str] = None
    locker_name: Optional[str] = None

    class Config:
        from_attributes = True


class DocListItem(BaseModel):
    id: str
    title: str
    status: str
    created_by: Optional[str] = None
    creator_name: Optional[str] = None
    updated_at: datetime
    locked_by: Optional[str] = None
    locker_name: Optional[str] = None

    class Config:
        from_attributes = True


# ---- NavNode ----
class NavNodeCreate(BaseModel):
    title: str
    parent_id: Optional[str] = None
    doc_id: Optional[str] = None
    sort_order: int = 0


class NavNodeUpdate(BaseModel):
    title: Optional[str] = None
    parent_id: Optional[str] = None
    doc_id: Optional[str] = None
    sort_order: Optional[int] = None


class NavNodeOut(BaseModel):
    id: str
    title: str
    parent_id: Optional[str] = None
    doc_id: Optional[str] = None
    sort_order: int
    children: List["NavNodeOut"] = []

    class Config:
        from_attributes = True


class NavTreeUpdate(BaseModel):
    """批量更新菜单树结构"""
    nodes: List[dict]  # [{id, parent_id, sort_order}, ...]


# ---- Publish ----
class PublishLogOut(BaseModel):
    id: str
    published_by: Optional[str] = None
    published_at: datetime
    doc_count: int
    status: str
    message: str

    class Config:
        from_attributes = True
