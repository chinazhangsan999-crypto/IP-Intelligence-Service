# 可观测性

第 9 步为中心 IP 服务增加三层观测能力：结构化日志、进程内聚合指标和现有 PostgreSQL 历史记录。观测失败不能改变查询结果，也不能记录被查询的原始 IP、HMAC 签名、Nonce 或客户端密钥。

## 配置

```env
METRICS_ENABLED=1
METRICS_TOKEN=<至少32字符的独立随机令牌>
SLOW_REQUEST_THRESHOLD_MS=1000
```

指标接口默认关闭。启用时必须设置独立令牌，生产环境应只允许 Prometheus 从内网或反向代理访问，并始终使用 HTTPS。令牌不要与导航站 HMAC 密钥复用。

## 接口

### `GET /health`

无鉴权的最小存活检查。只表示 Node.js 进程能够响应，不代表数据库和必需 IP 数据源已经可用。

### `GET /ready`

使用现有 HMAC 鉴权。检查 PostgreSQL、DB-IP City 和 DB-IP ASN 等必需来源。必需来源不可用时返回 `503`。

### `GET /v1/meta/observability`

使用现有 HMAC 鉴权，返回：

- 进程启动时间和运行时间；
- HTTP 请求总数、慢请求数；
- 查询批次数及 resolved / invalid / unavailable 聚合数量；
- 自动更新器是否运行、最近一次结果；
- Node.js 内存；
- PostgreSQL 连接池总连接、空闲连接和等待数；
- 当前数据源就绪与新鲜度。

数据为当前实例的运行快照，不包含逐 IP、逐请求或逐客户端明细。

### `GET /metrics`

Prometheus 文本格式，使用：

```http
Authorization: Bearer <METRICS_TOKEN>
```

该接口不使用 HMAC，便于标准监控系统抓取；令牌错误返回 `401`，功能未启用返回 `404`。

同一令牌也用于只读运维后台的 `GET /admin/api/observability`。后台使用方式见 [运维后台](admin-console.md)。

Prometheus 示例：

```yaml
scrape_configs:
  - job_name: ip-intelligence-service
    scheme: https
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/ip-intelligence-metrics-token
    static_configs:
      - targets: [ip-intelligence.example.com]
```

## 指标

| 指标 | 含义 |
|---|---|
| `ip_intelligence_http_requests_total` | 固定路由、方法和状态码的请求量 |
| `ip_intelligence_http_request_duration_seconds` | 请求耗时直方图，可计算 p50/p95/p99 |
| `ip_intelligence_slow_requests_total` | 超过慢请求阈值的累计数量 |
| `ip_intelligence_lookup_batches_total` | 成功进入判断引擎的查询批次数 |
| `ip_intelligence_lookup_ips_total` | requested、unique、resolved、invalid、unavailable 数量 |
| `ip_intelligence_data_source_ready` | 数据源能否用于查询 |
| `ip_intelligence_data_source_stale` | 数据源是否超过新鲜度期限 |
| `ip_intelligence_data_update_runs_total` | succeeded、failed、skipped 更新次数 |
| `ip_intelligence_data_update_running` | 当前是否正在更新 |
| `ip_intelligence_postgres_connections` | 连接池总连接与空闲连接 |
| `ip_intelligence_postgres_waiting_requests` | 等待数据库连接的请求数 |
| `ip_intelligence_process_*` | 运行时间和内存使用量 |

路由标签只会是固定路径或 `unmatched`，不会把 URL Query、IP 或动态值变成标签，避免指标基数失控。

## 日志

每次请求完成继续输出 JSON 日志：请求 ID、方法、固定路径、状态码和耗时。超过 `SLOW_REQUEST_THRESHOLD_MS` 时额外输出 `slow_request` 警告。错误日志只保存错误名称、消息和错误码，不输出密钥与完整堆栈。

## 历史数据边界

- Prometheus 指标存于进程内，重启后从零开始；长期曲线由 Prometheus 保存。
- `api_usage_hourly` 继续保存每个导航站的小时聚合用量。
- `update_jobs` 继续保存数据更新历史和失败原因。
- `data_source_versions` 保存当前数据版本、新鲜度和最近检查结果。

## 告警

示例规则位于 `config/prometheus-alerts.yml`，覆盖：

- 服务连续2分钟不可达；
- 必需数据源连续5分钟不可用；
- 数据源过期1小时；
- 5分钟HTTP 5xx比例超过5%；
- 5分钟p95延迟超过500毫秒；
- 最近30分钟出现自动更新失败；
- PostgreSQL连接池连续5分钟存在等待。

这些规则只生成监控事件。实际通知可由 Prometheus Alertmanager 接入 Telegram、Bark、邮件或其他通道，避免查询服务本身承担告警投递故障。
