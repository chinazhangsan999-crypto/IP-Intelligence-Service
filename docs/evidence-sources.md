# 多源证据管理

## 无需账户的基础身份与路由证据

- IANA IPv4/IPv6 Special-Purpose Registry：特殊用途、保留和协议专用地址登记。
- Team Cymru Fullbogon：尚未分配或当前无全球路由的前缀；命中只作为辅助审核证据。
- Googlebot、Google Special Crawlers、Google User-Triggered Fetchers 与 Bingbot：官方机器人网段；不能仅凭 User-Agent 判断。
- Apple iCloud Private Relay：官方出口网段及声明地区；正常隐私中继不等于恶意代理。

以上来源均进入现有数据源管理，支持独立启停、自动更新、手动更新、一键下载、版本与错误展示。原始数据在完成格式、记录数和 CIDR 校验后原子替换，更新失败继续保留上一版。

## 已授权来源

- CAIDA AS2Org：接受 CAIDA AUA，仅用于自有 IP 中心和自有导航站，不转售原始数据。
- PeeringDB：按 AUP 用于自有网络的 IP/ASN 审核和运维，使用游客只读 GET 接口。
- RPKI：由内网 Routinator 容器提供 `/json`，不映射 HTTP 或 RTR 公网端口。
- Microsoft Azure：Public Cloud 与 China Cloud 分开下载、分开管理、分开显示版本和错误。
- Akamai：保持停用，不配置账号、密钥或下载地址。

Azure Public 与 Azure China 的命中结果分别保存为 `azure-public` 与 `azure-china`，不会把世纪互联运营的中国云误写为全球公有云。命中云网段只作为网络类型证据，不能单独触发封禁、扣分或下架。

系统管理的“数据库中心”是全部数据来源的唯一操作入口。每个来源组都提供启停、自动更新周期、手动更新、强制下载、成员状态、版本、最近错误和关联规则入口；“一键下载全部”只处理已启用来源。

## 证据职责

| 来源 | 主要职责 | 默认状态 | 查询链路 |
| --- | --- | --- | --- |
| DB-IP、SAPICS | 国家、城市、ASN、组织原始声明 | 启用 | 正式查询 |
| AWS、Google Cloud、Cloudflare、Tor | 云/CDN/Tor 精确网段 | 启用 | 正式判断 |
| IP2Proxy LITE | 代理、VPN、Tor、用途辅助信息 | 启用，自动更新关闭 | 正式判断 |
| RIPE RIS | Prefix 到当前 Origin ASN 的路由证据 | 启用 | 正式查询与冲突识别 |
| RouteViews | 采集器可用性与第二路由源准备 | 启用 | 当前仅管理，不冒充路由结论 |
| RPKI / Routinator | Prefix-Origin ASN 授权状态 | 启用 | 正式查询 |
| NRO/RIR delegated | 资源注册机构、国家、分配状态 | 启用 | 正式查询 |
| IANA RDAP bootstrap | IP 到权威 RDAP 服务映射 | 启用 | 正式查询返回端点，不同步外呼 |
| IANA Special / Fullbogon | 特殊用途和全球路由异常辅助证据 | 启用 | 正式查询 |
| Google/Bing / Apple Relay | 官方爬虫和隐私中继网段 | 启用 | 正式查询 |
| CAIDA AS2Org | ASN 到真实组织归并 | 启用 | 正式查询组织标准化 |
| PeeringDB | ASN 网络名称、范围与类型辅助信息 | 启用 | 正式查询与中置信度类型辅助 |
| Oracle、Fastly、DigitalOcean | 扩展云与 CDN 网段 | 启用 | 正式判断 |
| Azure Public / Azure China | 微软官方云网段 | 启用 | 正式判断 |
| Akamai | 按当前决定不使用 | 停用 | 不下载、不判断 |

所有来源都保留原始声明。不同来源不是简单投票：RPKI 只证明路由授权，不证明住宅或 VPN；PeeringDB 只辅助网络用途，不覆盖精确 CIDR 人工规则；未知值保持未知。

## 需要管理员完成的前置条件

1. CAIDA：已确认 Acceptable Use Agreement，仅用于自有 IP 中心与自有导航站。
2. PeeringDB：已确认 AUP；当前使用游客只读接口并限制更新频率。
3. RPKI：已部署内网 Routinator，未映射公网端口。
4. Azure Public 与 Azure China：程序从微软官方下载中心分别解析当期 Service Tags JSON，无需账号或固定下载地址。
5. Akamai：按当前授权保持停用，不配置账号、密钥或下载地址。
6. IP2Proxy：继续使用服务器上的下载 Token/Code；后台不会返回这些秘密。

任何前置条件未完成的来源都应保持停用。尝试手动下载时，任务错误会显示缺少的具体配置，不会替换现有数据。

## 正式查询新增字段

正式查询会返回 BGP Origin、路由前缀、ASN 冲突、RPKI 状态、RIR 注册信息、RDAP 服务、特殊用途、Fullbogon、官方爬虫、Apple Private Relay、CAIDA 统一组织和 PeeringDB 网络类型。所有字段均来自本地快照，查询请求过程中不会访问第三方服务。

这些字段只提供证据和人工审核支持：Fullbogon、Private Relay、爬虫身份、PeeringDB 类型或单个注册国家都不能单独触发封禁、处罚、下架或放行。

## 规则管理

数据库卡片上的“规则”按钮会打开分类规则区域，并预选当前来源。规则仍按现有优先级执行：精确人工 CIDR、精确人工 ASN 高于自动来源。关联来源用于管理、筛选和审计，不会让低可信来源自动取得更高判断权。

## 下载安全

- 只接受 HTTPS 地址；
- 限制下载体积和超时，最多重试一次；
- 下载到临时文件/内存后先做结构与最小记录数校验；
- 校验成功后原子替换，失败保留旧数据；
- 更新结果写入任务记录和各成员状态；
- 大型 RIPE IPv4/IPv6 文件顺序处理，限制峰值内存；
- 一键下载前检查磁盘空间，停用来源不参与。
