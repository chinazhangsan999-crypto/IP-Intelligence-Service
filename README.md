# IP Intelligence Service

这是一个独立于导航站的中心 IP 查询服务。它只接收规范化 IP 地址并返回地理、ASN、网络类型和风险标签；不接收 SID、友链积分、来源页面或访客行为明细。

## 第一阶段边界

- 本地数据库查询：DB-IP City Lite、DB-IP ASN Lite、IP2Proxy Lite、Tor Exit List、云厂商网段和自定义 ASN 分类规则。
- 私有批量接口：`POST /v1/ip/lookup`，每次最多 100 个 IP；仅返回最终基础画像，ASN 裁决、BGP/RPKI 与来源证据只保留在 IP 系统内部。
- 每个导航站独立身份与 HMAC 签名；部署时叠加 Cloudflare Access Service Token。
- 查询失败时，导航站继续正常服务，只显示“识别中”或“未知”。

## 已锁定的契约

- [API 契约](docs/api-contract.md)
- [OpenAPI 定义](docs/openapi.yaml)
- [系统边界与不变量](docs/architecture-boundaries.md)
- [导航站接入边界](docs/navigation-integration.md)

## 当前实现状态

- 基础配置校验与安全默认值。
- 统一 JSON 响应和请求 ID。
- JSON 结构化访问/错误日志。
- `/health` 存活检查与 `/ready` 就绪检查。
- SIGINT/SIGTERM 优雅关闭及强制关闭上限。
- 基础工程自动化测试。
- PostgreSQL 连接池、并发安全迁移和七张管理表。
- 导航站客户端创建、停用及加密密钥轮换。
- HMAC-SHA256请求验签、时间窗、Nonce防重放和每客户端限速。
- DB-IP City Lite / ASN Lite 本地 MMDB 加载、IPv4/IPv6规范化和批量查询。
- AWS、Google Cloud、Cloudflare 官方网段识别，以及 Tor、IP2Proxy Lite 和自定义 ASN/CIDR 规则的可选增强。
- 开放网段数据的一键下载、格式校验和原子替换；单个可选来源不可达时安全降级。
- 统一 IP 判断引擎：固定证据优先级、三态裁决、同级冲突回避和完整冲突证据。
- 正式 `/v1/ip/lookup` 批量查询 API：严格 JSON 契约、必需数据源门禁、HMAC 防重放、每客户端限额、聚合用量与统一错误响应。
- 数据自动更新：月度 DB-IP、开放网段与 Tor 定时检查，带校验回滚、多实例锁和整套查询服务热切换。
- 可观测性：受保护的 Prometheus 指标、HMAC 运行状态、慢请求日志、数据源/更新器/连接池状态和告警规则示例。
- 运维后台：独立账号密码登录、安全会话、账户修改、运行概览、实时吞吐趋势、数据源、更新器、连接池和接口性能。
- 暗黑公开查询前台：单 IP 查询、当前访问地址识别、网络身份摘要、风险三态、判断证据与数据覆盖说明。
- 系统管理数据库中心：统一管理 DB-IP、SAPICS、RIPE RIS、RouteViews、RPKI、NRO/RIR、RDAP、CAIDA、PeeringDB、IANA 特殊地址、Team Cymru Fullbogon、Google/Bing 官方爬虫、Apple Private Relay 与云厂商来源；每组支持启停、自动周期、手动更新、强制下载、状态、版本和错误展示。
- 正式查询使用本地快照补充 BGP Origin、RPKI、RIR、RDAP、特殊用途、Fullbogon、官方爬虫、Apple Private Relay、CAIDA 组织与 PeeringDB 类型证据；查询过程中不会同步请求外部服务，也不会将任一辅助标签直接用于封禁或处罚。
- 身份与路由标签只作为证据和人工审核信息，不作为单项封禁、扣分或处罚依据。
- Azure Public 与 Azure China（世纪互联）作为两个独立官方来源每周同步；Akamai 按当前授权保持停用且不配置凭据。

当前 City / ASN 数据源已经接入；生产环境仍需同时配置 PostgreSQL 和客户端身份后，`/ready` 才会返回 200。

PostgreSQL 配置与运维命令见 [PostgreSQL 管理数据](docs/postgresql.md)。
鉴权规范见 [请求鉴权与防重放](docs/authentication.md)。
本地数据库位置、字段能力和署名要求见 [本地 City / ASN 数据库](docs/local-ip-data.md)。
网络类型、Tor、代理和云厂商数据源见 [IP 情报增强](docs/ip-enrichment.md)。
自动更新频率、回滚和热重载见 [数据自动更新](docs/data-updates.md)。
全部来源、用途边界和启用前置条件见 [多源证据管理](docs/evidence-sources.md)。
指标、运行状态、慢请求和告警规则见 [可观测性](docs/observability.md)。
后台访问、安全边界和刷新策略见 [运维后台](docs/admin-console.md)。
公开前台的查询范围、限速和反向代理设置见 [公开查询前台](docs/public-query.md)。

## 目录

```text
src/       服务代码
config/    ASN 与网络类型规则
data/      本地 IP 数据库（不提交 Git）
docs/      API 与导航站接入说明
public/    暗黑公开查询前台与只读运维后台
tests/     自动化测试
```

## 后续实施顺序

1. 为导航站增加异步队列和本地 SQLite 缓存。
2. 根据实际运营需要增加公开查询统计；不记录单次查询 IP。
