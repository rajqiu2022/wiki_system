# Wiki System 部署指南

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

## 四、常用命令

```bash
# 查看日志
docker logs wiki-editor -f --tail 100

# 重启服务
docker compose restart wiki-editor

# 进入容器
docker exec -it wiki-editor bash

# 重新构建
docker compose build --no-cache wiki-editor
docker compose up -d wiki-editor
```

## 五、回滚

如果部署出现问题，可以快速回滚到旧系统：

```bash
# 停止新容器
docker compose stop wiki-editor

# 旧系统（Go 服务）继续在 phpfpm 容器中运行
# 域名解析需要改回 wikiadmin.makerfabs.com
```
