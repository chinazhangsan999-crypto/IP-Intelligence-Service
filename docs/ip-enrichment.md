# IP 情报增强

第 5 步在 City / ASN 查询之上增加网络类型和风险标签。所有结果只用于展示与人工分析，不得单独作为封禁、处罚或友链扣分条件。

## 数据源

| 数据源 | 默认文件 | 能力 | 必需性 |
|---|---|---|---|
| AWS、Google Cloud、Cloudflare 官方网段 | `data/cloud-ranges.json` | `hosting`、`cdn`、云厂商证据 | 可选 |
| Tor Exit List / Onionoo | `data/tor-exit-nodes.txt` | `is_tor`、`is_proxy` | 可选 |
| IP2Proxy Lite | `data/IP2PROXY-LITE.BIN` | 代理、VPN、用途类型和 ISP | 可选，需从 IP2Location LITE 控制台自行下载 BIN |
| 本地与 PostgreSQL 分类规则 | `config/asn-classification.json` | 按 ASN、ASN 组织名或 CIDR 覆盖分类 | 可选 |

City 和 ASN 数据仍是查询接口的必需数据源。上述任一增强数据不存在或不可用时，服务继续运行，相应字段保持 `null` 或 `unknown`，并在数据源状态中报告 `unavailable`。

## 更新开放数据

```powershell
npm run data:update-open
```

命令从官方 HTTPS 地址下载 AWS、Google Cloud、Cloudflare 网段，并尝试下载 Tor Exit List；Tor 主列表失败时会自动尝试 Onionoo。下载内容通过格式和最小记录数校验后才原子替换现有文件。

生产环境可以启用内置更新调度和热重载，配置及故障边界见 [数据自动更新](data-updates.md)。

Tor 是可选源。如果当前网络无法连接两个 Tor 官方地址，云厂商网段仍会更新，已有 Tor 文件会原样保留；没有旧文件时 `is_tor` 保持 `null`。

## IP2Proxy Lite 安装

IP2Proxy LITE 的注册与下载已迁移到 [IP2Location LITE 数据库](https://www.ip2location.com/database/lite)。使用一个免费账户即可取得 IP2Location、IP2Proxy 与 ASN 的 LITE 数据；本项目只需要其中的 IP2Proxy LITE BIN 文件。

下载后将 BIN 文件命名为 `IP2PROXY-LITE.BIN` 并放入 `data/`，再重启服务。文件有效时，数据源状态会从“不可用”变为“就绪”。也可在服务器私有 `.env` 启用自动下载：系统只使用下载令牌，不保存登录账号或在线查询 API Key；新文件通过校验后才替换当前 BIN。

生成的数据文件不提交 Git。部署时应在目标服务器执行更新命令，并按数据源许可要求保留相应署名。

## 自定义分类规则

`config/asn-classification.json` 示例：

```json
{
  "version": 1,
  "rules": [
    {
      "name": "example-isp",
      "priority": 200,
      "match_type": "asn",
      "match_value": "64500",
      "network_type": "residential",
      "confidence": "high",
      "flags": { "is_hosting": false }
    }
  ]
}
```

`match_type` 支持：

- `asn`：精确匹配 ASN 数字；
- `asn_org`：忽略大小写的组织名包含匹配；
- `cidr`：匹配 IPv4 或 IPv6 网段。

规则可以设置 `is_mobile`、`is_hosting`、`is_proxy`、`is_vpn`、`is_tor`、`is_anycast` 布尔标记。自定义规则优先级高于公共云网段和 IP2Proxy 自动分类，但其他数据源的证据仍会保留，便于追溯。

## 三态与边界

- `true`：至少有明确命中证据；
- `false`：有具备判断能力的数据源明确给出未命中；
- `null`：当前没有数据源能判断。

公共云网段未命中不能证明该 IP 不是数据中心，因此不会把 `is_hosting` 自动写成 `false`。同样，未安装 IP2Proxy 时不能判断 VPN 或通用代理。

当前开放云网段只覆盖 AWS、Google Cloud 和 Cloudflare，不等于全球全部 IDC。`is_anycast` 也不会因 Cloudflare 命中而自动判真，除非后续数据源或显式规则提供证据。

## 统一判断引擎

所有来源都先转换成标准断言，再由 `IpJudgmentEngine` 一次性裁决，业务接口不直接采用任何数据源的原始值。

固定优先级：

1. 管理员显式 ASN、组织名或 CIDR 规则；
2. Tor 官方当前出口节点；
3. Cloudflare CDN、AWS 和 Google Cloud 官方网段；
4. IP2Proxy Lite 自动分类。

每个断言包含字段、值、来源、置信度和优先级。引擎分别裁决 `network_type` 及六个三态标签，不允许一个字段的证据推断另一个无关字段。

冲突处理：

- 优先级更高的明确证据胜出；
- 同优先级时选择置信度更高的证据；
- 同优先级、同置信度但值相反时主动放弃判断，返回 `unknown` 或 `null`；
- 无论最终选择哪一方，冲突双方都会保留在 `evidence` 中，并增加 `judgment_conflict` 记录；
- 判断与数据源遍历顺序无关，相同输入和相同数据版本必须得到相同输出。

这个引擎只判断 IP 属性，不输出恶意分数，不判断真人，也不执行封禁、扣分或验证门禁。
