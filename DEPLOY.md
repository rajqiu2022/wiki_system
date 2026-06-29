# Wiki System 部署指南

## 〇、服务器连接

### 服务器信息

| 项目 | IP | 端口 | 系统 |
|------|-----|------|------|
| Makerfabs Wiki | `47.89.148.199` | 22 (SSH) | Ubuntu |
| Lighthouse 实例 | `106.55.226.176` | 22 (SSH) | Ubuntu |

### SSH 连接

```bash
# Makerfabs Wiki 服务器
ssh root@47.89.148.199

# Lighthouse 实例
ssh root@106.55.226.176
```

### 项目路径

```
/var/www/html/makerfabs/          ← 主项目目录
  ├── docker-compose.yml          ← 主 compose 文件
  ├── wiki-editor/                ← wiki 编辑器项目
  ├── nginx/                      ← nginx 配置
  └── wiki/mkdoc/wiki/            ← mkdocs 输出站点（挂载卷）
```

---

## 一、部署架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Nginx (容器)                            │
│  wiki-editor.makerfabs.com → wiki-editor:8001               │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   wiki-editor (容器)                         │
│  FastAPI + React 前端                                       │
│  端口: 8001                                                 │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                      db (MariaDB)                            │
│  数据库: makerfabs_wiki                                      │
│  表: user, wiki_list, wiki_file, type_list                  │
└─────────────────────────────────────────────────────────────┘
```

## 二、服务器端操作

### 1. 上传代码到服务器

```bash
# 在本地执行
scp -r F:\Code\wiki-system root@47.89.148.199:/var/www/html/makerfabs/wiki-editor
```

### 2. 更新 docker-compose.yml

在服务器 `/var/www/html/makerfabs/docker-compose.yml` 中添加：

```yaml
  wiki-editor:
    build: ./wiki-editor
    container_name: wiki-editor
    restart: always
    environment:
      - TZ=Asia/Shanghai
      - USE_MYSQL=true
      - MYSQL_HOST=db
      - MYSQL_PORT=3306
      - MYSQL_USER=makerfabs_wiki
      - MYSQL_PASSWORD=aJD*Hg6D!f88GD
      - MYSQL_DATABASE=makerfabs_wiki
    volumes:
      - wiki-docs:/app/docs
      - wiki-output:/app/output
    depends_on:
      - db
```

### 3. 添加 Nginx 配置

创建 `/var/www/html/makerfabs/nginx/wiki-editor.conf`：

```nginx
server {
    listen 80;
    server_name wiki-editor.makerfabs.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name wiki-editor.makerfabs.com;

    client_max_body_size 64M;

    ssl_certificate /etc/letsencrypt/live/wiki-editor.makerfabs.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wiki-editor.makerfabs.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    http2 on;

    # API 代理
    location /api {
        proxy_pass http://wiki-editor:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # MkDocs 输出站点
    location /site {
        proxy_pass http://wiki-editor:8001;
    }

    # 前端静态文件
    location / {
        proxy_pass http://wiki-editor:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 4. 申请 SSL 证书

```bash
# 在服务器执行
docker exec certbot certbot certonly --webroot -w /var/www/certbot -d wiki-editor.makerfabs.com
```

### 5. 构建并启动

```bash
cd /var/www/html/makerfabs
docker compose build wiki-editor
docker compose up -d wiki-editor

# 重载 Nginx 配置
docker exec nginx nginx -s reload
```

### 6. 验证

```bash
# 检查容器状态
docker ps | grep wiki-editor

# 检查 API
curl http://localhost:8001/api/health

# 检查日志
docker logs wiki-editor -f
```

## 三、数据库兼容性

新系统使用现有数据库表：

| 表名 | 用途 |
|------|------|
| `user` | 用户账户 |
| `wiki_list` | 文档元数据 |
| `wiki_file` | 文档内容 |
| `type_list` | 导航菜单 |

新增表（自动创建）：
- `publish_logs` - 发布日志
- `document_locks` - 编辑锁
- `document_history` - 文档历史

## 四、日常更新部署流程

### 方式一：完整重建（代码变更较大时）

```bash
# 1. 在本地推送代码到 GitHub
cd F:\Code\wiki-system
git add .
git commit -m "描述更新内容"
git push origin main

# 2. SSH 连接服务器
ssh root@47.89.148.199

# 3. 拉取最新代码
cd /var/www/html/makerfabs/wiki-editor
git pull origin main

# 4. 重建镜像并重启容器
cd /var/www/html/makerfabs
docker compose build --no-cache wiki-editor
docker compose up -d wiki-editor

# 5. 重载 Nginx（如有配置变更）
docker exec nginx nginx -s reload

# 6. 验证部署
docker logs wiki-editor --tail 20
curl http://localhost:8001/api/health
```

### 方式二：热更新（仅代码改动，不重建镜像）

适用场景：只改了 Python 代码或前端 assets，不需要重新安装依赖。

```bash
# 1. SSH 连接服务器
ssh root@47.89.148.199

# 2. 更新代码
cd /var/www/html/makerfabs/wiki-editor
git pull origin main

# 3. 复制更新文件到容器
docker cp ./backend/app wiki-editor:/app/
docker cp ./frontend/dist wiki-editor:/app/frontend/

# 4. 重启容器使其生效
docker compose restart wiki-editor

# 5. 验证
docker logs wiki-editor --tail 20
```

### 方式三：仅更新前端（最快）

```bash
# 1. SSH 连接服务器
ssh root@47.89.148.199

# 2. 更新代码
cd /var/www/html/makerfabs/wiki-editor
git pull origin main

# 3. 直接复制前端构建产物
docker cp ./frontend/dist wiki-editor:/app/frontend/

# 4. 无需重启，前端即时生效
curl -I https://wiki-editor.makerfabs.com/
```

### 方式四：仅更新前端（无需 SSH，本地构建 + scp）

```bash
# 1. 本地构建前端
cd F:\Code\wiki-system\frontend
npm run build

# 2. 上传构建产物到服务器
scp -r F:\Code\wiki-system\frontend\dist root@47.89.148.199:/var/www/html/makerfabs/wiki-editor/frontend/

# 3. SSH 复制到容器
ssh root@47.89.148.199 "docker cp /var/www/html/makerfabs/wiki-editor/frontend/dist wiki-editor:/app/frontend/"
```

---

## 五、常用命令

```bash
# 查看日志
docker logs wiki-editor -f --tail 100

# 重启服务
docker compose restart wiki-editor

# 进入容器
docker exec -it wiki-editor bash

# 查看容器状态
docker ps | grep wiki-editor

# 查看镜像占用
docker images | grep wiki-editor

# 清理旧镜像（节省磁盘）
docker image prune -f
```

## 六、回滚

如果部署出现问题，可以快速回滚到旧系统：

```bash
# 停止新容器
docker compose stop wiki-editor

# 旧系统（Go 服务）继续在 phpfpm 容器中运行
# 域名解析需要改回 wikiadmin.makerfabs.com
```

---

## 七、本地开发环境

```bash
# 后端
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001

# 前端
cd frontend
npm install
npm run dev

# 构建文档
mkdocs build
```

访问地址：`http://localhost:5173`（前端） / `http://localhost:8001`（后端 API）
