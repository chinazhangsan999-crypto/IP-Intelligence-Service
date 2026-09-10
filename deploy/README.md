# Google Compute Engine 单机部署

当前生产拓扑为 Caddy、Node.js 服务和 PostgreSQL 三个容器。只有 Caddy 暴露 80/443；应用和数据库仅存在于 Docker 内部网络。

服务器根目录：`/opt/ip-intelligence`

## 首次部署

1. 将项目上传到 `/opt/ip-intelligence`。
2. 在 `deploy/.env.production` 配置 `POSTGRES_PASSWORD`、`CLIENT_SECRET_MASTER_KEY` 和 `METRICS_TOKEN`。
3. 在 `deploy` 目录运行：

```text
docker-compose --env-file .env.production up -d --build
```

生产密钥由 `bootstrap.sh` 首次运行时在服务器本地生成。重复部署会保留原密钥，不会导致已有客户端凭证失效。

## 域名和 HTTPS

首次部署在没有域名时使用 `:80`。域名解析到固定公网 IP 后，将 Caddyfile 第一行替换为实际域名并重启 Caddy，Caddy 会自动申请和续期证书。

## 更新代码

上传新版本后，在 `deploy` 目录重新执行构建命令。PostgreSQL、Caddy 证书和 IP 数据目录均持久化，不随应用容器重建而删除。
