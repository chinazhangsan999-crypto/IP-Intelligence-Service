# 公开查询前台

访问 `/` 可使用暗黑风格的单 IP 查询页面。页面只调用：

```http
GET /api/public/lookup?ip=1.1.1.1
```

不传 `ip` 时查询当前连接地址。接口不使用导航站的 HMAC 客户端密钥，也不向浏览器下发任何服务端凭证。

## 配置

```env
PUBLIC_LOOKUP_ENABLED=1
PUBLIC_LOOKUP_RATE_LIMIT_PER_MINUTE=30
PUBLIC_TRUST_PROXY=0
```

公开接口每次只接受一个 IPv4 或 IPv6 地址，并按连接来源独立限速。它不会写入 API 客户端用量表，也不保存查询 IP。

## 反向代理

默认只信任 TCP 连接来源，不读取 `X-Forwarded-For`。使用 Caddy、Cloudflare Tunnel 或其他可信反向代理后，如需自动识别真实访客地址：

1. 确保源站端口不能被公网绕过代理直接访问；
2. 确保代理会覆盖而不是追加不可信的 `X-Forwarded-For`；
3. 再设置 `PUBLIC_TRUST_PROXY=1`。

如果不能满足以上条件，保持关闭，用户仍可手动输入地址查询。

## 结果边界

- 免费 City / ASN 库提供地理和网络归属；
- 云网段、Tor、IP2Proxy 和自定义规则按本机实际安装情况增强；
- 布尔值 `false` 显示“未命中”；
- `null` 显示“暂无数据”，不能解释为安全；
- 页面不生成没有数据依据的“纯净度分数”。
