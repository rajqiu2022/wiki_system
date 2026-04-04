from sqlalchemy import Column, String, Text, Integer, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship, backref
from datetime import datetime, timezone
from sqlalchemy.ext.declarative import declarative_base
import os

Base = declarative_base()


# ============ 兼容现有 MySQL 表结构 ============

class User(Base):
    """用户表 - 对应现有 user 表"""
    __tablename__ = "user"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(20), nullable=False, unique=True)
    password = Column(String(40), nullable=False)  # 现有系统使用明文或简单加密
    create_time = Column(String(32), nullable=True)
    role = Column(String(32), nullable=True, default="user")


class WikiList(Base):
    """文档列表表 - 对应现有 wiki_list 表"""
    __tablename__ = "wiki_list"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(64), nullable=True)
    path = Column(String(256), nullable=True)
    description = Column(String(256), nullable=False, default="")
    author = Column(String(32), nullable=True)
    create_time = Column(String(32), nullable=True)
    status = Column(Integer, nullable=False, default=0)
    current_editor = Column(String(32), nullable=False, default="")

    # 关联文件内容
    files = relationship("WikiFile", backref="wiki_list", foreign_keys="WikiFile.list_id")


class WikiFile(Base):
    """文件内容表 - 对应现有 wiki_file 表"""
    __tablename__ = "wiki_file"

    id = Column(Integer, primary_key=True, autoincrement=True)
    list_id = Column(Integer, ForeignKey("wiki_list.id"), nullable=False)
    content = Column(Text, nullable=True)
    modifier = Column(String(32), nullable=True)
    modified_time = Column(String(32), nullable=True)
    mark = Column(Text, nullable=True)


class TypeList(Base):
    """分类/导航表 - 对应现有 type_list 表"""
    __tablename__ = "type_list"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(256), nullable=True)
    parent_path = Column(String(1024), nullable=True)
    mark = Column(Text, nullable=True)
    status = Column(Integer, nullable=False, default=0)


# ============ 新增扩展表（用于新功能）============
# 这些表在 MySQL 中不存在时会自动创建

class PublishLog(Base):
    """发布日志表 - 新增"""
    __tablename__ = "publish_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    published_by = Column(String(50), nullable=True)
    published_at = Column(DateTime, default=datetime.now)
    doc_count = Column(Integer, default=0)
    status = Column(String(20), default="success")
    message = Column(Text, default="")


class DocumentLock(Base):
    """文档锁表 - 新增，用于编辑锁定功能"""
    __tablename__ = "document_locks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(Integer, ForeignKey("wiki_list.id"), nullable=False)
    locked_by = Column(String(50), nullable=True)
    locked_at = Column(DateTime, default=datetime.now)
    session_id = Column(String(100), nullable=True)  # 用于自动释放


class DocumentHistory(Base):
    """文档历史版本表 - 新增"""
    __tablename__ = "document_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(Integer, ForeignKey("wiki_list.id"), nullable=False)
    content = Column(Text, nullable=True)
    modifier = Column(String(50), nullable=True)
    modified_at = Column(DateTime, default=datetime.now)
    version = Column(Integer, default=1)
    change_note = Column(String(500), nullable=True)
