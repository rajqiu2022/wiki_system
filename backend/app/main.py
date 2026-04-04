from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import logging

from .database import engine, Base, USE_MYSQL
from .models import User, WikiList, WikiFile, TypeList, PublishLog, DocumentLock, DocumentHistory
from .routers import users, documents, nav, publish, uploads

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

app.include_router(users.router)
app.include_router(documents.router)
app.include_router(nav.router)
app.include_router(publish.router)
app.include_router(uploads.router)

# 静态文件：MkDocs 输出
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "output")
if os.path.exists(OUTPUT_DIR):
    app.mount("/site", StaticFiles(directory=OUTPUT_DIR, html=True), name="site")

# 前端静态文件（生产环境）
FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
if os.path.exists(FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")


@app.get("/api/health")
def health():
    return {"status": "ok", "db": "mysql" if USE_MYSQL else "sqlite"}


@app.on_event("startup")
async def startup():
    """启动时检查并初始化数据"""
    from sqlalchemy.orm import Session
    from .database import SessionLocal
    db = SessionLocal()
    try:
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

from datetime import datetime
