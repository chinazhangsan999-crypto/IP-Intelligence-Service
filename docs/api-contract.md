# API 契约（v1）

本文件是实现和导航站接入的唯一业务口径；机器可读定义见 [openapi.yaml](openapi.yaml)。v1 发布后，已有字段不改变含义，新增字段只能保持向后兼容。

## 批量查询

```http
POST /v1/ip/lookup
Content-Type: application/json
X-Client-ID: nav-site-01
X-Timestamp: 1789000000
X-Nonce: 4f2d8b71-5a39-4dbd-8c17-b441042af4ce
X-Signature: <64位小写十六进制HMAC-SHA256>
```

```json
{
  "ips": ["1.1.1.1", "2409:8000::/64"]
}
```

约束：

- `Content-Type` 必须为 `application/json`，可以附带 `charset`；其他类型返回 HTTP 415。
- `ips` 必须是数组，数量为 1～100。
- 每项必须是长度不超过 64 的字符串；类型错误属于请求结构错误并返回 HTTP 400。
- 支持单个 IPv4、单个 IPv6，以及隐私归一化后的 IPv6 `/64`。
- 不接受域名、URL、其他 CIDR 或混合文本。
- 重复输入由服务端去重；结果按首次出现顺序返回一项，`meta` 同时返回请求数量和去重数量。
- JSON 结构正确但部分 IP 无效时，整批仍返回 HTTP 200；无效项的 `status` 为 `invalid`。
- JSON 格式或顶层结构错误时，返回 HTTP 400/422。

## 成功响应

```json
{
  "request_id": "req_01JQX8W5QFK5A7ZB2K9V9FQ4M0",
  "code": "OK",
  "data": [
    {
      "input": "1.1.1.1",
      "status": "resolved",
      "message": null,
      "ip": "1.1.1.1",
      "ip_version": 4,
      "scope": "public",
      "country_code": "AU",
      "country_name": "Australia",
      "region": null,
      "city": null,
      "asn": 13335,
      "asn_org": "Cloudflare, Inc.",
      "isp": null,
      "network_type": "cdn",
      "is_mobile": null,
      "is_hosting": true,
      "is_proxy": null,
      "is_vpn": null,
      "is_tor": false,
      "is_anycast": null,
      "special_purpose": null,
      "is_fullbogon": false,
      "verified_crawler": false,
      "crawler_operator": null,
      "crawler_type": null,
      "is_private_relay": false,
      "private_relay_region": null,
      "confidence": "high"
    }
  ],
  "meta": {
    "requested_count": 2,
    "unique_count": 2,
    "resolved_count": 2,
    "invalid_count": 0,
    "unavailable_count": 0,
    "generated_at": "2026-09-10T08:00:00.000Z",
    "database_versions": {
      "dbip-city": "2026-09",
      "dbip-asn": "2026-09"
    }
  }
}
```

## 字段语义

`status`：

- `resolved`：完成查询；不代表所有字段都有数据。
- `invalid`：输入不是支持的 IP 或 IPv6 `/64`。
- `unavailable`：输入合法，但本次查询因内部数据源不可用而未完成。

## 多来源地理字段

查询结果除 `country_code`、`region`、`city`、`asn` 外，还可能包含 `state1`、`state2`、`postcode`、`latitude`、`longitude` 与 `timezone`。正式客户端接口只返回自动裁决后的最终基础画像；原始 `source_claims`、`evidence`、候选结果、支持票数和所有 `*_judgment` 对象均属于 IP 系统内部数据，不向导航站或其他 API 客户端返回。

面向客户端中文界面的字段包括 `scope_zh`、`network_type_zh`、`confidence_zh` 与 `asn_org_zh`。英文/代码字段继续保留。

每批必须满足：`unique_count = resolved_count + invalid_count + unavailable_count`。

成功响应同时返回限速头：

- `X-Rate-Limit-Limit`：客户端每分钟额度；
- `X-Rate-Limit-Remaining`：当前分钟剩余额度；
- `X-Rate-Limit-Reset`：距离当前分钟窗口重置的秒数。

每次响应都会返回 `X-Request-ID`。调用方可以提供安全格式的 `X-Request-ID`，用于跨导航站与中心服务关联排障。

`scope`：`public`、`private`、`loopback`、`link_local`、`multicast`、`reserved`、`unknown`。

`network_type` 是主要网络归类，不代替独立风险标签：`residential`、`mobile`、`business`、`education`、`government`、`hosting`、`cdn`、`unknown`。

`confidence`：`unknown`、`low`、`medium`、`high`。它表示证据充分程度，不表示 IP 安全等级。

## 内部裁决边界与客户端网络身份字段

- ASN 多源裁决、BGP、RPKI、RIR/RDAP、CAIDA、PeeringDB、候选值、冲突和来源证据只供 IP 系统自身页面及内部诊断使用，不属于 `/v1/ip/lookup` 客户端响应。
- 客户端仍可获得裁决完成后的 `asn`、`asn_org`、`asn_org_zh`、`isp` 与 `network_type` 基础画像，但无法反查裁决过程。
- `special_purpose`：IANA 特殊用途名称。
- `is_fullbogon`：Team Cymru 快照命中；只能作为辅助证据。
- `verified_crawler`、`crawler_operator`、`crawler_type`：Google/Bing 官方网段匹配结果，不依据 User-Agent 猜测。
- `is_private_relay`、`private_relay_region`：Apple 官方 Private Relay 出口及其声明地区，不等于恶意代理或 VPN。

## 三态规则

`is_mobile`、`is_hosting`、`is_proxy`、`is_vpn`、`is_tor`、`is_anycast` 必须支持：

- `true`：当前数据源有明确命中证据。
- `false`：至少一个具备该判断能力的数据源明确未命中。
- `null`：没有可用数据源能够判断，或相应数据源不可用。

严禁把 `null` 自动转换成 `false`。

## 错误响应

```json
{
  "request_id": "req_01JQX8W5QFK5A7ZB2K9V9FQ4M0",
  "code": "INVALID_REQUEST",
  "message": "ips 必须包含 1～100 项",
  "details": null
}
```

| HTTP | code | 含义 |
|---:|---|---|
| 400 | `INVALID_JSON` | 请求体不是合法 JSON |
| 400 | `INVALID_REQUEST` | 请求结构错误 |
| 401 | `AUTH_REQUIRED` | 缺少鉴权信息 |
| 401 | `INVALID_SIGNATURE` | 签名错误或时间戳过期 |
| 403 | `CLIENT_DISABLED` | 客户端已停用 |
| 409 | `REPLAY_DETECTED` | Nonce 在有效期内重复使用 |
| 404 | `NOT_FOUND` | 路由不存在 |
| 405 | `METHOD_NOT_ALLOWED` | 路径存在但请求方法错误 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超过服务限制 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 查询请求未声明 JSON 类型 |
| 422 | `BATCH_LIMIT_EXCEEDED` | IP 数量超过 100 |
| 429 | `RATE_LIMITED` | 客户端达到限额 |
| 500 | `INTERNAL_ERROR` | 未分类内部错误 |
| 503 | `SERVICE_NOT_READY` | 必需数据源尚未就绪 |

错误响应不得包含堆栈、密钥、签名原文或数据库路径。

## 健康与数据源接口

- `GET /health`：仅判断进程是否存活，不检查数据库。
- `GET /ready`：判断提供查询所需的必需数据源是否可用。
- `GET /v1/meta/sources`：返回数据源状态、版本、更新时间和是否过期；不返回服务器文件路径。
- `GET /v1/meta/observability`：返回当前实例的聚合请求、查询、更新器、内存和连接池状态；使用现有 HMAC 鉴权。

管理员会话接口：

- `GET /admin/api/management`：接入方、24 小时用量、判断规则、更新任务和审计记录；
- `POST /admin/api/clients`：创建接入方并一次性返回新密钥；
- `POST /admin/api/clients/:id/rotate`：轮换接入密钥；
- `POST /admin/api/clients/:id/status`：启用或暂停接入方；
- `POST /admin/api/classification-rules`：新增或覆盖同名判断规则；
- `POST /admin/api/classification-rules/:id/status`：启用或停用判断规则；
- `POST /admin/api/data-update`：启动后台数据更新任务。

除只读 GET 外，上述管理员写接口都要求同源请求和 `X-CSRF-Token`。
- `GET /metrics`：返回 Prometheus 文本指标；默认关闭，启用后使用独立 Bearer Token，不使用导航站 HMAC 密钥。

正式查询接口在 City、ASN 等任一必需数据源未就绪时返回 HTTP 503，不会用空结果伪装成功。Tor、IP2Proxy 和公共云网段属于可选数据源，不会单独阻止查询；不具备判断能力的字段保持 `null`。

`/health` 可以公开给基础设施探针；其余接口均要求鉴权。可观测性接口的配置与隐私边界见 [可观测性](observability.md)。

## 签名规范

客户端先对实际发送的原始 UTF-8 请求体计算小写十六进制 SHA-256，然后按以下内容用换行符 `\n` 连接。`PATH` 是客户端实际发送的原始 path-and-query（以 `/` 开头、包含原始查询串、不含域名或片段），服务端不先解码或重新排序：

```text
POST
/v1/ip/lookup
1789000000
4f2d8b71-5a39-4dbd-8c17-b441042af4ce
<body_sha256_hex>
```

再使用该客户端密钥计算 HMAC-SHA256，`X-Signature` 使用 64 位小写十六进制。时间戳为 Unix 秒，允许误差不超过 60 秒；`X-Nonce` 在 5 分钟内不可重复。

生产环境还应由 Cloudflare Access 校验每个导航站独立的 Service Token。Access 是边缘准入，HMAC 是应用层身份与完整性校验，两者不能互相替代。
