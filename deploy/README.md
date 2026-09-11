# Google Compute Engine 单机部署

项目同时提供 Docker 部署和既有 Caddy / PM2 服务器部署两种方式。两种方式都只由 Caddy 暴露 80/443；应用和数据库不直接暴露公网端口。

Docker 部署目录：`/opt/ip-intelligence`

## 首次部署

1. 将项目上传到 `/opt/ip-intelligence`。
2. 在 `deploy/.env.production` 配置 `POSTGRES_PASSWORD`、`CLIENT_SECRET_MASTER_KEY` 和 `METRICS_TOKEN`。
3. 在 `deploy` 目录运行：

```text
docker-compose --env-file .env.production up -d --build
```

生产密钥由 `bootstrap.sh` 首次运行时在服务器本地生成。重复部署会保留原密钥，不会导致已有客户端凭证失效。

如需启用 IP2Proxy LITE 自动更新，只在服务器的 `deploy/.env.production` 中填写下载令牌：

```env
IP2PROXY_AUTO_UPDATE_ENABLED=1
IP2PROXY_DOWNLOAD_TOKEN=<download token>
IP2PROXY_DOWNLOAD_CODE=PX12LITEBIN
IP2PROXY_UPDATE_INTERVAL_DAYS=7
```

该文件权限为仅部署用户可读，不能提交到 Git；没有配置时，IP2Proxy 自动更新保持关闭。

## 域名和 HTTPS

首次部署在没有域名时使用 `:80`。域名解析到固定公网 IP 后，将 Caddyfile 第一行替换为实际域名并重启 Caddy，Caddy 会自动申请和续期证书。

## 更新代码

上传新版本后，在 `deploy` 目录重新执行构建命令。PostgreSQL、Caddy 证书和 IP 数据目录均持久化，不随应用容器重建而删除。

## 已有 Caddy / PM2 服务器

服务器已运行其他 Node.js 站点、没有 Docker 时，可使用 `bootstrap-pm2.sh`。它使用独立的 `/home/niaiwo/ip-intelligence`、PostgreSQL 数据库 `ip_intelligence`、本地端口 `3101` 和 `ip.chinazhangsan.ccwu.cc`，不会覆盖已有 Caddy 站点。

首次运行前需安装 Node.js、npm、PM2 与 PostgreSQL，并确认部署用户可执行免密 `sudo`。脚本会在服务器本地生成数据库密码、主密钥和监控令牌，随后等待服务的 `GET /health` 成功后才报告部署完成：

```text
bash deploy/bootstrap-pm2.sh
```

重复运行会保留已有 `.env` 与数据库，只拉取代码、执行迁移、更新公共数据源并重启 PM2 服务。IP2Proxy 下载令牌仍只应写入服务器 `/home/niaiwo/ip-intelligence/.env`，不能提交到 Git。
