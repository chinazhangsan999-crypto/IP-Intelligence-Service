# 导航站接入边界

导航站仅在访问日志成功落库后，异步提交待识别的规范化 IP；不能在访客页面请求中等待中心服务。

中心接口请求必须包含：

- `X-Client-ID`
- `X-Timestamp`
- `X-Nonce`
- `X-Signature`

签名内容按换行连接 `METHOD`、`PATH`、`TIMESTAMP`、`NONCE`、`SHA256(BODY)`，准确格式见 [API 契约](api-contract.md)。时间误差不超过 60 秒，Nonce 在 5 分钟内不可重复。

导航站保留自己的 SQLite `ip_profiles` 缓存。中心服务不可获得友链归属、SID、页面 URL、联系方式或原始访问日志。

每个导航站必须使用独立客户端身份、HMAC 密钥和 Cloudflare Access Service Token。凭证只存入服务器环境变量，不得返回前端、进入系统设置接口或提交 Git。

查询必须在业务日志落库后异步执行。超时、限流或中心服务不可用时，导航站继续正常访问、记录和计分，只显示旧缓存、`识别中` 或 `未知`。
