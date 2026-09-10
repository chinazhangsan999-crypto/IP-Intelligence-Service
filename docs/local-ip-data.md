# 本地 City / ASN 数据库

第 4 步使用 DB-IP City Lite 与 ASN Lite 的 MMDB 文件。服务启动时直接将数据库加载为只读查询器，查询过程不访问第三方网络，也不保存被查询的原始 IP。

## 文件位置

默认文件名：

```text
data/dbip-city-lite.mmdb
data/dbip-asn-lite.mmdb
```

可以通过环境变量覆盖文件名：

```env
DBIP_CITY_MMDB_FILE=dbip-city-lite.mmdb
DBIP_ASN_MMDB_FILE=dbip-asn-lite.mmdb
MMDB_CACHE_SIZE=10000
```

文件由 `.gitignore` 排除，不能提交到 Git。数据库缺失或损坏时进程仍能启动，但相应数据源标为 `unavailable`，`/ready` 返回 503；公开 `/health` 不受影响。

## 当前数据

当前本地导入的是 2026-09 版本：

| 数据库 | MMDB 大小 | 官方 MD5 |
|---|---:|---|
| City Lite | 127,339,927 字节 | `8a0a03f5b9098ba9f2e28f920473d6c1` |
| ASN Lite | 9,511,026 字节 | `89762c245e79382df2bdf834b166c506` |

City Lite 提供国家、地区和城市；ASN Lite 提供 AS 编号和组织名称。它们不提供可靠的 VPN、代理、Tor、机房、移动网络或 Anycast 判断，因此这些字段在第 4 步保持 `null`，`network_type` 保持 `unknown`。

## 授权要求

DB-IP Lite 使用 Creative Commons Attribution 4.0 许可。任何展示或使用查询结果的 Web 页面都必须提供 DB-IP 署名和链接：

```html
<a href="https://db-ip.com">IP Geolocation by DB-IP</a>
```

以后开发查询前端和导航站 IP 信息展示时，必须同步加入该署名。本项目不能把免费库当作无署名的自有数据发布。

## 自动更新

DB-IP Lite 每月更新。系统现在会在月份变化后成对下载 City 与 ASN，完成大小限制、解压、MMDB 类型、版本、样本查询和 SHA-256 校验，再通过备份切换替换旧文件。运行中的服务使用整套热重载，不需要重启。详细流程见 [数据自动更新](data-updates.md)。
