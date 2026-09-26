# IP Intelligence Service（IP 情报中心）

[English documentation](README.en.md)

IP 情报中心把地理、ASN、代理/VPN/Tor、云厂商/CDN、RPKI、路由、注册机构、恶意网段和人工分类证据聚合为统一查询结果。它面向导航站提供 HMAC 签名 API，同时提供独立后台管理数据源、客户端、更新任务和分类规则。

> 所有下载 Token、License Key、API Client Secret、管理员密码和数据库密钥只保存在服务器；后台敏感字段不回显明文。

## 1. 功能总览

- `POST /v1/ip/lookup` HMAC-SHA256 认证查询、时间偏差校验、nonce 防重放和客户端限速。
- 公开单 IP 查询页/接口，可独立关闭和限速。
- PostgreSQL 管理客户端、用量、审计、反馈、更新任务和管理员会话。
- Client ID/Secret 创建、轮换、禁用；Secret 只显示一次并由主密钥加密。
- DB-IP、MaxMind、SAPICS 等 MMDB；IP2Proxy LITE BIN；内存缓存。
- 云/CDN、Tor、RPKI、BGP、RIR/RDAP、特殊地址、Fullbogon、爬虫、Private Relay、信誉数据证据。
- 证据优先级和冲突裁决、中文本地化、人工分类规则。
- 数据源检查、下载、强制更新、定时更新、状态和失败原因。
- `/health`、`/ready`、可选 Bearer 保护的 Prometheus `/metrics`。

## 2. 推荐部署位置

与控制中心部署在服务器 B：

- 控制中心 `127.0.0.1:3100`
- IP 情报 `127.0.0.1:3101`
- PostgreSQL `127.0.0.1:5432`，不同数据库/用户
- Routinator（可选）`127.0.0.1:8323`
- Caddy 统一提供 `control.example.com` 和 `ip.example.com`

仓库自带 Docker/Caddy 部署可用于 IP 独占服务器。两系统同机时不要原样启动其中的 Caddy 容器，否则会与主机 Caddy 抢占 80/443；本文使用原生 Node systemd + 主机 PostgreSQL。

## 3. 从空服务器安装

### 3.1 基础软件和用户

```bash
sudo apt update
sudo apt install -y ca-certificates curl git build-essential postgresql unzip
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo useradd --system --create-home --home-dir /opt/apps --shell /usr/sbin/nologin apps
sudo mkdir -p /opt/ip-intelligence /etc/ip-intelligence /var/lib/ip-intelligence/data /var/lib/ip-intelligence/config
sudo chown -R apps:apps /opt/ip-intelligence /var/lib/ip-intelligence
sudo chmod 750 /etc/ip-intelligence
```

### 3.2 空数据库

```bash
sudo -u postgres psql <<'SQL'
CREATE USER ip_service WITH ENCRYPTED PASSWORD 'REPLACE_WITH_RANDOM_DATABASE_PASSWORD';
CREATE DATABASE ip_intelligence OWNER ip_service;
REVOKE ALL ON DATABASE ip_intelligence FROM PUBLIC;
SQL
```

用 `openssl rand -base64 36` 生成密码。此用户只拥有 `ip_intelligence` 数据库。

### 3.3 获取代码

```bash
sudo -u apps git clone https://github.com/zhangsan4188/ip-intelligence-service.git /opt/ip-intelligence
cd /opt/ip-intelligence
sudo -u apps npm ci --omit=dev
```

镜像仓库为 `https://github.com/chinazhangsan999-crypto/IP-Intelligence-Service.git`。服务器 Deploy Key 只需 `Contents: Read`。

### 3.4 环境文件

```bash
openssl rand -hex 32  # CLIENT_SECRET_MASTER_KEY
openssl rand -base64 48 # optional METRICS_TOKEN
```

创建 `/opt/ip-intelligence/.env`（启动脚本使用 Node `--env-file=.env`）：

```dotenv
NODE_ENV=production
PORT=3101
HOST=127.0.0.1
LOG_LEVEL=info
IP_DATA_DIR=/var/lib/ip-intelligence/data
IP_CONFIG_DIR=/var/lib/ip-intelligence/config
DATABASE_URL=postgresql://ip_service:<数据库密码>@127.0.0.1:5432/ip_intelligence
DATABASE_SSL_MODE=disable
DATABASE_POOL_MAX=10
CLIENT_SECRET_MASTER_KEY=<64 位十六进制随机值>
REDIS_URL=
HMAC_MAX_CLOCK_SKEW_SECONDS=60
NONCE_TTL_SECONDS=300
NONCE_MAX_ENTRIES=100000
PUBLIC_LOOKUP_ENABLED=1
PUBLIC_LOOKUP_RATE_LIMIT_PER_MINUTE=30
PUBLIC_TRUST_PROXY=1
METRICS_ENABLED=0
METRICS_TOKEN=<启用 metrics 时填写独立随机值>
IP_DATA_AUTO_UPDATE_ENABLED=1
IP_DATA_UPDATE_INTERVAL_HOURS=6
IP_DATA_UPDATE_STARTUP_DELAY_SECONDS=60
IP2PROXY_AUTO_UPDATE_ENABLED=0
IP2PROXY_DOWNLOAD_TOKEN=
IP2PROXY_DOWNLOAD_CODE=PX12LITEBIN
SAPICS_AUTO_UPDATE_ENABLED=0
CAIDA_AUA_ACCEPTED=0
PEERINGDB_AUP_ACCEPTED=0
ROUTINATOR_URL=
```

```bash
sudo chown apps:apps /opt/ip-intelligence/.env
sudo chmod 600 /opt/ip-intelligence/.env
```

`CLIENT_SECRET_MASTER_KEY` 加密 API Client Secret，必须永久保存、单独备份。更换后已有客户端密文无法解密。`PUBLIC_TRUST_PROXY=1` 只在请求必经会覆盖转发头的可信 Caddy 时启用。

### 3.5 迁移和初始管理员

```bash
cd /opt/ip-intelligence
sudo -u apps npm run db:migrate
sudo -u apps npm run admin:account -- admin
```

空库命令创建初始账号 `admin`、密码 `admin123`，并在终端输出一次 JSON。管理员已存在时命令拒绝覆盖。首次登录后立即更换密码；当前规则允许 8–128 字符。

### 3.6 systemd

创建 `/etc/systemd/system/ip-intelligence.service`：

```ini
[Unit]
Description=IP Intelligence Service
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=apps
Group=apps
WorkingDirectory=/opt/ip-intelligence
ExecStartPre=/usr/bin/npm run db:migrate
ExecStart=/usr/bin/node --env-file=.env src/app.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/ip-intelligence /var/lib/ip-intelligence

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ip-intelligence
sudo systemctl status ip-intelligence --no-pager
curl -fsS http://127.0.0.1:3101/health
curl -fsS http://127.0.0.1:3101/ready
```

### 3.7 Caddy

服务器 B 的统一配置：

```caddyfile
control.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3100
}

ip.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3101
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -fsS https://ip.example.com/health
```

## 4. 创建导航站 API Client

```bash
cd /opt/ip-intelligence
sudo -u apps npm run client:admin -- create nav-main "Main Navigation" 600
```

输出包含 Client ID 和一次性 Secret。立即保存到对应导航站后台；服务端不再回显明文。其他命令：

```bash
sudo -u apps npm run client:admin -- list
sudo -u apps npm run client:admin -- rotate nav-main
sudo -u apps npm run client:admin -- disable nav-main
```

每个导航站独立 Client，按真实容量设置每分钟限额。轮换后旧 Secret 立即失效。HMAC 请求还要求服务器时间同步；两台服务器均启用 `systemd-timesyncd` 或 chrony。

## 5. 数据源全表

### 5.1 无账号即可直接下载/查询

| 数据源 | 内容 | 许可/注意事项 |
|---|---|---|
| DB-IP City Lite / ASN Lite | 地理、ASN | CC BY 4.0，保留归属 |
| AWS、Google Cloud、Cloudflare 网段 | 云/CDN | 各上游条款 |
| Tor Project / Onionoo | Tor 出口 | 上游条款 |
| SAPICS 社区 MMDB | Country/City/ASN | 各文件 PDDL、GeoLite2 或 CC BY；保留文件级许可 |
| RIPE RIS、RouteViews | BGP/路由证据 | 上游条款；注意下载体积 |
| NRO/RIR delegated stats | 注册分配 | RIR 条款和校验和 |
| IANA RDAP Bootstrap | RDAP 目录 | IANA 数据条款 |
| IANA Special-Purpose | 特殊 IPv4/IPv6 | IANA 数据条款 |
| Team Cymru Fullbogons | 未分配/未路由 | 社区服务条款 |
| Google/Bing crawler ranges | 已验证爬虫 | 只能作为网段证据，仍需反向/正向 DNS 验证策略 |
| Apple Private Relay | 隐私中继出口 | Apple 条款 |
| Oracle、Fastly、DigitalOcean | 云/CDN | 各上游条款 |
| Azure Public / China | Service Tags | Microsoft 条款，下载 URL 可变化 |
| GitHub Meta | GitHub 服务网段 | 匿名可用；Token 仅用于降低限速 |
| Spamhaus DROP | 高风险网络块 | 必须保留来源/版权/日期；不得单独自动封禁 |
| ipgeo Community | 地理/ASN/VPN | CC BY-SA 4.0 |
| IPsum | 恶意 IP 出现次数 | 仓库条款；仅作信誉证据 |

这些源不等于“无限制使用”。首次启用和再分发前应读取上游许可；系统只聚合结论，不应公开原始受限数据集。

### 5.2 需要账号或 Token

#### MaxMind GeoLite2

后台填写：`Account ID`、`License Key`。

1. 创建 MaxMind 账号并完成邮箱验证。
2. 接受 GeoLite2 EULA。
3. 在账户中生成新的 License Key，只用于数据库下载。
4. 后台启用 Country、City、ASN 更新并测试。

不需要 MaxMind Web Service 权限；只需要下载 GeoLite2 数据库的许可。License Key 是秘密，Account ID 可显示脱敏值。不要把 GeoLite2 文件当作无条件公有数据再分发。

#### IP2Proxy LITE

后台/环境填写：`IP2PROXY_DOWNLOAD_TOKEN` 和 `IP2PROXY_DOWNLOAD_CODE`（例如 `PX12LITEBIN`）。

1. 创建 IP2Location/IP2Proxy LITE 账号。
2. 在下载区生成 Download Token。
3. 选择实际可下载的 LITE BIN 产品代码。
4. 先手动验证下载，再开启自动更新。

这里需要的是数据库 **Download Token**，不是付费 Web Service API Key。确认 LITE 许可、内部使用和归属要求。

#### GitHub Meta Token（可选）

匿名 `/meta` API 可用；遇到共享出口限速时使用 Fine-grained PAT：

- 只读；不需要仓库写权限。
- `Metadata: Read`，如 UI 要求仓库选择则只选必要公共仓库或不使用 Token。
- 不授予 Contents write、Issues、Actions、Secrets、Administration。
- 设置短到期时间。

### 5.3 需要人工接受条款或独立组件

- `CAIDA_AUA_ACCEPTED=1`：仅在负责人已阅读并接受 CAIDA AUA、确认用途允许后设置；不是绕过认证的开关。
- `PEERINGDB_AUP_ACCEPTED=1`：确认 PeeringDB AUP 后才启用。
- Routinator：独立 RPKI 验证器，不需要公网账号；HTTP/RTR 端口只在回环/私网开放。
- SAPICS 包含不同许可的数据文件；启用自动更新不代表获得超出上游许可的权利。

### 5.4 已移除/不需要

- Akamai 数据源已从后台移除，不需要 Akamai 账号或 Token。
- Spamhaus DROP 当前无需账号，但必须遵守归属和使用限制。

## 6. 可选 Routinator

推荐在内部运行 NLnet Labs Routinator，并把 JSON endpoint 仅暴露到 `127.0.0.1:8323`。可使用容器或官方包；无论方式都必须：

- 持久化 RPKI cache。
- 定期更新 Trust Anchors/ROAs。
- 不公开 HTTP/RTR 端口。
- `.env` 设置 `ROUTINATOR_URL=http://127.0.0.1:8323/json`。
- 用 `curl` 验证返回 JSON 后再启用数据源。

RPKI `invalid` 是强风险证据，但不应在没有业务策略和人工验证时单独永久封禁访客。

## 7. 更新数据

```bash
cd /opt/ip-intelligence
sudo -u apps npm run data:update-dbip
sudo -u apps npm run data:update-open
sudo -u apps npm run data:update-ip2proxy
sudo -u apps npm run data:update-sapics
sudo -u apps npm run data:update-all
```

后台也可检查、下载和强制更新。大文件下载应写入临时文件、完成校验后原子替换；失败时保留上一版有效文件。不要在服务运行目录手工写半成品 MMDB/BIN。

## 8. API 安全模型

导航站请求至少包含 Client ID、时间戳、nonce、body hash 和 HMAC 签名。服务校验：

- Client 已启用且 Secret 可解密。
- 时间偏差不超过 `HMAC_MAX_CLOCK_SKEW_SECONDS`。
- nonce 在 TTL 内未使用。
- 请求体未超过上限，签名以 timing-safe 方法比较。
- 客户端限速未超额。

客户端 Secret 不能放浏览器。查询应由导航站服务端发起。`METRICS_TOKEN` 与 API Secret、管理员 Session 完全独立。

## 9. 备份、更新和回滚

至少备份 PostgreSQL、`.env`、`config/`、人工规则和当前有效数据文件清单。公开数据文件可重新下载，但自定义分类和凭据无法靠下载恢复。

```bash
sudo -u postgres pg_dump -Fc ip_intelligence > /secure-backups/ip-intelligence-$(date +%F-%H%M).dump
cd /opt/ip-intelligence
sudo -u apps git fetch --all --prune
sudo -u apps git pull --ff-only
sudo -u apps npm ci --omit=dev
sudo -u apps npm test
sudo systemctl restart ip-intelligence
curl -fsS http://127.0.0.1:3101/ready
```

回滚时配对恢复兼容的代码、数据库和配置。不要删除数据目录后立即上线；先离线完成数据源校验。

## 10. 上线验收

- `/health`、`/ready` 正常，3101/5432/8323 不直接公网开放。
- `admin/admin123` 首次可登录，随后已更换，旧 Session 失效。
- 创建、查询、轮换和禁用 API Client 正常；明文 Secret 只显示一次。
- 正确 HMAC 成功，错误签名、旧时间戳、重复 nonce 和超限请求失败。
- DB-IP、开放数据、MaxMind/IP2Proxy（若配置）分别完成更新与测试查询。
- 管理后台显示来源、许可、更新时间、版本和失败原因。
- 对 IPv4、IPv6、私网、保留地址、Tor、代理、云厂商和普通住宅样本进行回归。
- 日志/API/Git 不包含 License Key、Token、Client Secret、主密钥或数据库密码。

## 11. 故障排查

- **管理员已存在**：`admin:account` 不覆盖；在后台修改或按恢复流程处理，不能删除表重建。
- **HMAC 失败**：核对 Client ID/Secret、URL path、body 原始字节、时钟和 nonce；轮换后旧 Secret 失效。
- **数据源下载失败**：查看后台错误、上游许可状态、Token 类型、产品代码、磁盘和出口网络。
- **MaxMind 401/403**：检查 Account ID、License Key、EULA 和下载权限，不要使用旧 GeoIP legacy key。
- **IP2Proxy 下载失败**：确认是 Download Token 和正确 LITE download code，而非 Web Service key。
- **来源显示 ready 但查询无字段**：确认有效文件路径与 `.env` 一致、文件非零且数据覆盖目标 IP。
- **真实 IP 被代理覆盖**：只在可信 Caddy 后启用 `PUBLIC_TRUST_PROXY`，并阻止直接访问 Node 端口。

## 12. 安全与隐私

- 初始 `admin/admin123` 只用于首次引导，必须立即修改。
- 每个导航站一个 API Client；不要把管理 Client 用作访客查询。
- IP 数据属于网络标识符；设定保留期、访问目的和审计，避免无期限保存原始访客行为。
- 单一信誉源不能直接决定永久封禁；保留 evidence、confidence 和人工申诉/修正渠道。
- 所有第三方凭据使用最小权限、到期和轮换计划。

## 13. 许可与归属

每个数据源拥有独立许可。部署者必须保留上游名称、许可、更新时间和必要归属；GeoLite2、DB-IP、SAPICS 文件、Spamhaus、PeeringDB、CAIDA、IPsum 等不可因被系统聚合而忽略原条款。

官方/上游参考：[MaxMind 数据库更新](https://dev.maxmind.com/geoip/updating-databases/)、[IP2Location/IP2Proxy LITE](https://www.ip2location.com/database/lite)、[IANA RDAP 数据](https://data.iana.org/rdap/)、[Routinator 文档](https://routinator.docs.nlnetlabs.nl/en/stable/)。
