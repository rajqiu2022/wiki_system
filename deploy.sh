#!/bin/bash
# Wiki System 部署脚本
# 用于服务器端部署

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 配置
PROJECT_DIR="/var/www/html/makerfabs/wiki-editor"
COMPOSE_FILE="/var/www/html/makerfabs/docker-compose.yml"

log_info "=== Wiki System 部署脚本 ==="

# 检查目录
if [ ! -d "$PROJECT_DIR" ]; then
    log_info "创建项目目录: $PROJECT_DIR"
    mkdir -p "$PROJECT_DIR"
fi

# 进入项目目录
cd "$PROJECT_DIR"

# 构建镜像
log_info "构建 Docker 镜像..."
docker compose -f "$COMPOSE_FILE" build wiki-editor

# 停止旧容器（如果存在）
if docker ps -a --format '{{.Names}}' | grep -q "^wiki-editor$"; then
    log_info "停止旧容器..."
    docker compose -f "$COMPOSE_FILE" stop wiki-editor
    docker compose -f "$COMPOSE_FILE" rm -f wiki-editor
fi

# 启动新容器
log_info "启动新容器..."
docker compose -f "$COMPOSE_FILE" up -d wiki-editor

# 等待启动
log_info "等待服务启动..."
sleep 5

# 检查健康状态
if curl -s http://localhost:8001/api/health > /dev/null; then
    log_info "✅ 部署成功！服务运行正常"
    log_info "API 地址: http://localhost:8001/api"
else
    log_warn "服务可能还在启动中，请稍后检查"
fi

# 显示日志
log_info "近期日志:"
docker logs wiki-editor --tail 20

log_info "=== 部署完成 ==="
