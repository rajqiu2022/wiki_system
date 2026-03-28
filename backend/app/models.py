from sqlalchemy import Column, String, Text, Integer, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship, backref
from datetime import datetime, timezone
import uuid

from .database import Base


def gen_id():
    return str(uuid.uuid4())


def utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_id)
    username = Column(String(50), unique=True, nullable=False)
    display_name = Column(String(100), nullable=False)
    password_hash = Column(String(200), nullable=True)
    role = Column(String(20), default="editor")  # admin / editor / viewer
    created_at = Column(DateTime, default=utcnow)


class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=gen_id)
    title = Column(String(200), nullable=False)
    content = Column(Text, default="")
    status = Column(String(20), default="draft")  # draft / published / archived
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    # 编辑锁
    locked_by = Column(String, ForeignKey("users.id"), nullable=True)
    locked_at = Column(DateTime, nullable=True)

    creator = relationship("User", foreign_keys=[created_by])
    locker = relationship("User", foreign_keys=[locked_by])


class NavNode(Base):
    __tablename__ = "nav_nodes"

    id = Column(String, primary_key=True, default=gen_id)
    title = Column(String(200), nullable=False)
    parent_id = Column(String, ForeignKey("nav_nodes.id"), nullable=True)
    doc_id = Column(String, ForeignKey("documents.id"), nullable=True)  # null = group node
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)

    children = relationship(
        "NavNode",
        backref=backref("parent_ref", remote_side="NavNode.id"),
        foreign_keys=[parent_id],
        order_by="NavNode.sort_order",
    )
    document = relationship("Document")


class PublishLog(Base):
    __tablename__ = "publish_logs"

    id = Column(String, primary_key=True, default=gen_id)
    published_by = Column(String, ForeignKey("users.id"), nullable=True)
    published_at = Column(DateTime, default=utcnow)
    doc_count = Column(Integer, default=0)
    status = Column(String(20), default="success")  # success / failed
    message = Column(Text, default="")

    publisher = relationship("User")
