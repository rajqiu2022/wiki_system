from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from .database import engine, Base
from .models import User, Document, NavNode, PublishLog
from .routers import users, documents, nav, publish

# 建表
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Wiki Editor API")

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

# 静态文件：MkDocs 输出
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "output")
if os.path.exists(OUTPUT_DIR):
    app.mount("/site", StaticFiles(directory=OUTPUT_DIR, html=True), name="site")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.on_event("startup")
async def startup():
    from sqlalchemy.orm import Session
    from .database import SessionLocal
    from .auth import hash_password
    db = SessionLocal()
    try:
        admin_user = db.query(User).filter(User.username == "admin").first()
        if not admin_user:
            admin_user = User(
                username="admin",
                display_name="管理员",
                role="admin",
                password_hash=hash_password("111111"),
            )
            db.add(admin_user)
            db.commit()
        elif not admin_user.password_hash:
            admin_user.password_hash = hash_password("111111")
            db.commit()
    finally:
        db.close()
