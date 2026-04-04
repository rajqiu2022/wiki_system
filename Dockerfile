# Wiki System - 多阶段构建
# 支持开发环境 (SQLite) 和生产环境 (MySQL)

# ============ 阶段1: 构建前端 ============
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# 复制 package.json 并安装依赖
COPY frontend/package*.json ./
RUN npm ci --registry=https://registry.npmmirror.com

# 复制前端源码并构建
COPY frontend/ ./
RUN npm run build

# ============ 阶段2: 最终镜像 ============
FROM python:3.10-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple \
    && pip install --no-cache-dir mkdocs mkdocs-material -i https://pypi.tuna.tsinghua.edu.cn/simple

# 复制后端代码
COPY backend/app ./app
COPY docs ./docs
COPY mkdocs.yml .

# 复制前端源码（用于调试）
COPY frontend/src ./frontend/src
COPY frontend/public ./frontend/public
COPY frontend/index.html ./frontend/index.html
COPY frontend/vite.config.js ./frontend/vite.config.js

# 复制前端构建产物
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# 创建数据目录
RUN mkdir -p /app/data /app/output /app/uploads/images

# 环境变量（生产环境使用 MySQL）
ENV USE_MYSQL=true \
    MYSQL_HOST=db \
    MYSQL_PORT=3306 \
    MYSQL_USER=makerfabs_wiki \
    MYSQL_PASSWORD=aJD*Hg6D!f88GD \
    MYSQL_DATABASE=makerfabs_wiki \
    TZ=Asia/Shanghai

EXPOSE 8001

# 启动命令
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
