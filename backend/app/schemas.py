from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ---- User ----
class UserOut(BaseModel):
    id: int
    username: str
    role: Optional[str] = None
    create_time: Optional[str] = None

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
    password: str
    role: str = "user"


class UserUpdate(BaseModel):
    password: Optional[str] = None
    role: Optional[str] = None


# ---- WikiList (Document) ----
class DocCreate(BaseModel):
    name: str
    path: Optional[str] = None
    description: Optional[str] = ""
    author: Optional[str] = None
    nav_parent_path: Optional[str] = None  # Nav tree parent path for auto-adding to menu


class DocUpdate(BaseModel):
    name: Optional[str] = None
    path: Optional[str] = None
    description: Optional[str] = None
    status: Optional[int] = None
    keep_hyphens: Optional[int] = None
    hidden: Optional[int] = None


class DocOut(BaseModel):
    id: int
    name: Optional[str] = None
    path: Optional[str] = None
    description: Optional[str] = None
    author: Optional[str] = None
    create_time: Optional[str] = None
    status: int = 0
    current_editor: Optional[str] = None

    class Config:
        from_attributes = True


class DocListItem(BaseModel):
    id: int
    name: Optional[str] = None
    path: Optional[str] = None
    author: Optional[str] = None
    status: int = 0
    create_time: Optional[str] = None
    current_editor: Optional[str] = None

    class Config:
        from_attributes = True


# ---- WikiFile ----
class FileContentOut(BaseModel):
    id: int
    list_id: int
    content: Optional[str] = None
    modifier: Optional[str] = None
    modified_time: Optional[str] = None

    class Config:
        from_attributes = True


class FileContentUpdate(BaseModel):
    content: str
    modifier: Optional[str] = None


# ---- TypeList (Nav) ----
class NavNodeCreate(BaseModel):
    name: str
    parent_path: Optional[str] = ""
    mark: Optional[str] = None


class NavNodeUpdate(BaseModel):
    name: Optional[str] = None
    parent_path: Optional[str] = None
    mark: Optional[str] = None
    status: Optional[int] = None


class NavNodeOut(BaseModel):
    id: int
    name: Optional[str] = None
    parent_path: Optional[str] = None
    mark: Optional[str] = None
    status: int = 0

    class Config:
        from_attributes = True


class NavTreeUpdate(BaseModel):
    """批量更新菜单树结构"""
    nodes: List[dict]  # [{id, parent_path, sort_order}, ...]


# ---- Publish ----
class PublishLogOut(BaseModel):
    id: int
    published_by: Optional[str] = None
    published_at: Optional[datetime] = None
    doc_count: int = 0
    status: str = "success"
    message: str = ""

    class Config:
        from_attributes = True


class PublishRequest(BaseModel):
    user_id: Optional[int] = None


# ---- Requirement ----
class RequirementCreate(BaseModel):
    title: str
    description: Optional[str] = None
    type: str = "feature"  # feature/bug
    priority: str = "medium"  # low/medium/high/urgent
    expected_date: Optional[datetime] = None
    tags: Optional[str] = None


class RequirementUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    type: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    expected_date: Optional[datetime] = None
    assignee: Optional[str] = None
    tags: Optional[str] = None


class RequirementOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    type: str = "feature"
    priority: str = "medium"
    status: str = "pending"
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    expected_date: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    assignee: Optional[str] = None
    tags: Optional[str] = None

    class Config:
        from_attributes = True


# ---- AI Chat ----
class AIChatMessage(BaseModel):
    role: str  # user/assistant
    content: str


class AIChatRequest(BaseModel):
    messages: List[AIChatMessage]
    image_urls: Optional[List[str]] = []  # Image URLs from user messages


class AIChatResponse(BaseModel):
    content: str
    requirement_created: Optional[dict] = None  # if a requirement was created
