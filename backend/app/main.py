from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
import logging
from datetime import datetime

from .database import engine, Base, USE_MYSQL
from .models import User, WikiList, WikiFile, TypeList, PublishLog, DocumentLock, DocumentHistory, Requirement, KnowledgeGraph
from .routers import users, documents, nav, publish, uploads, requirements, ai_chat

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 建表（只创建新增的表，不影响现有表）
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Wiki Editor API",
    version="2.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API 路由 - 必须在静态文件之前注册
app.include_router(users.router)
app.include_router(documents.router)
app.include_router(nav.router)
app.include_router(publish.router)
app.include_router(uploads.router)
app.include_router(requirements.router)
app.include_router(ai_chat.router)

# 静态文件：MkDocs 输出
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "output")
if os.path.exists(OUTPUT_DIR):
    app.mount("/site", StaticFiles(directory=OUTPUT_DIR, html=True), name="site")

# 前端静态文件（生产环境）
FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
FRONTEND_INDEX = os.path.join(FRONTEND_DIST, "index.html")

if os.path.exists(FRONTEND_DIST):
    # 挂载 assets 目录（JS、CSS 等静态资源）
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


@app.get("/api/health")
def health():
    return {"status": "ok", "db": "mysql" if USE_MYSQL else "sqlite"}


# SPA catch-all 路由：所有非 API、非静态文件的请求返回 index.html
@app.get("/{full_path:path}")
async def serve_spa(request: Request, full_path: str):
    """Serve the SPA index.html for all non-API routes"""
    # 如果是 API 请求，跳过（应该已经被上面的路由处理）
    if full_path.startswith("api/"):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="API endpoint not found")
    
    # 如果请求的是具体文件（有扩展名），尝试直接返回
    if "." in full_path.split("/")[-1]:
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
    
    # 其他所有路由返回 index.html（SPA 路由）
    if os.path.exists(FRONTEND_INDEX):
        return FileResponse(FRONTEND_INDEX)
    
    return {"detail": "Frontend not built"}


@app.on_event("startup")
async def startup():
    """启动时检查并初始化数据"""
    from sqlalchemy.orm import Session
    from sqlalchemy import text, inspect
    from .database import SessionLocal
    db = SessionLocal()
    try:
        # Auto-migrate: add publish_status column to wiki_list if not exists
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('wiki_list')]
        if 'publish_status' not in columns:
            logger.info("Adding publish_status column to wiki_list...")
            db.execute(text("ALTER TABLE wiki_list ADD COLUMN publish_status INT NOT NULL DEFAULT 1"))
            db.commit()
            logger.info("publish_status column added successfully")
        if 'keep_hyphens' not in columns:
            logger.info("Adding keep_hyphens column to wiki_list...")
            db.execute(text("ALTER TABLE wiki_list ADD COLUMN keep_hyphens INT NOT NULL DEFAULT 0"))
            db.commit()
            logger.info("keep_hyphens column added successfully")
        if 'hidden' not in columns:
            logger.info("Adding hidden column to wiki_list...")
            db.execute(text("ALTER TABLE wiki_list ADD COLUMN hidden INT NOT NULL DEFAULT 0"))
            db.commit()
            logger.info("hidden column added successfully")
        
        # 检查是否有 admin 用户，没有则创建
        admin_user = db.query(User).filter(User.username == "admin").first()
        if not admin_user:
            logger.info("Creating default admin user...")
            admin_user = User(
                username="admin",
                password="111111",  # 明文，与旧系统兼容
                role="admin",
                create_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            )
            db.add(admin_user)
            db.commit()
            logger.info("Default admin user created: admin / 111111")
        else:
            logger.info(f"Admin user exists: {admin_user.username}")
    except Exception as e:
        logger.error(f"Startup error: {e}")
    finally:
        db.close()
