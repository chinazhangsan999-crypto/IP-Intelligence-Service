# 尚需外部凭据或授权的数据源

本清单只记录尚不能由程序自行取得的内容。密钥不得写入 Git、前端 JavaScript、公开 API 或聊天记录；准备完成后应直接写入服务器受限环境文件，再由应用加密或只读加载。

## GitHub Meta

用途：稳定同步 GitHub Actions、Pages、Hooks、Git、API 与 Packages 官方网段。匿名接口可能受到共享出口限速。

需要准备：

- 一个仅供 IP 中心使用的 GitHub Token；
- 不授予仓库写入、组织管理或代码访问权限；
- 后续配置名预留为 `GITHUB_META_TOKEN`。

## MaxMind GeoLite2

用途：增加独立 ASN、Country 与 City 验证源。

需要准备：

- MaxMind 账号；
- 接受 GeoLite2 EULA；
- Account ID；
- License Key；
- 明确只供自有服务内部查询，不公开再分发原始数据库。

后续配置名预留为：

```text
MAXMIND_ACCOUNT_ID
MAXMIND_LICENSE_KEY
```

## Spamhaus

用途：Spamhaus DROP 每日自动更新，只作为辅助证据，不单独触发封禁。当前接入使用其公开 DROP 数据，不需要账户或密钥；若未来切换到需要授权的产品，再单独评估许可与凭据。

## 商业 VPN / 代理情报

用途：补充商业 VPN、开放代理、住宅代理、匿名等级及近期滥用信息。

需要准备：

- 选定供应商；
- API Key 或离线数据库下载凭据；
- 调用额度和更新频率；
- 是否允许缓存、内部转发和多站点使用的许可说明。

任何供应商结果都只能作为辅助证据，不得覆盖精确人工 CIDR/ASN 规则，也不得单独触发处罚。

## 已移除来源

Akamai 已从数据中心、运行时加载和自动更新目录移除，不需要准备账号、接口凭据或下载任务。
