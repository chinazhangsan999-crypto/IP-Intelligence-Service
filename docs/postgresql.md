# PostgreSQL 管理数据

## 作用范围

PostgreSQL 只保存客户端、用量、数据源版本、分类规则、更新任务、审计和纠错反馈。IP 区间仍由 MMDB、BIN 和 CIDR 文件查询，不复制进 PostgreSQL。

初始迁移创建：

- `api_clients`
- `api_usage_hourly`
- `data_source_versions`
- `network_classification_rules`
- `update_jobs`
- `audit_logs`
- `lookup_feedback`

审计与反馈只允许保存 IP 的 HMAC 摘要，不设置原始 IP 字段。

## 客户端密钥

HMAC 验签要求服务端持有可用密钥，因此只保存不可逆密码摘要无法完成验签。当前设计使用：

- 32 字节随机客户端密钥。
- AES-256-GCM 加密后保存到 PostgreSQL。
- `CLIENT_SECRET_MASTER_KEY` 只存在服务器环境变量中。
- 加密附加数据绑定 `client_id`，密文不能在客户端之间互换。
- SHA-256 指纹只用于运维识别，不用于验签。
- 创建或轮换时，明文客户端密钥只在命令行结果中返回一次。
- 未完成全部客户端密钥重新加密前，不得直接替换 `CLIENT_SECRET_MASTER_KEY`。

## 配置

```env
DATABASE_URL=postgresql://ip_service:password@127.0.0.1:5432/ip_intelligence
DATABASE_SSL_MODE=disable
CLIENT_SECRET_MASTER_KEY=<64位十六进制随机值>
```

生产环境远程连接应使用 `DATABASE_SSL_MODE=verify-full`；只有本机回环连接才建议 `disable`。`require` 兼容不提供可验证证书的托管数据库，但不会验证服务端证书身份。

## 命令

```text
npm run db:migrate
npm run client:admin -- list
npm run client:admin -- create nav-site-01 "导航站一" 600
npm run client:admin -- rotate nav-site-01
npm run client:admin -- disable nav-site-01
```

迁移使用 PostgreSQL advisory lock，防止多个实例同时执行；已经执行的迁移会校验 SHA-256，禁止静默修改历史 SQL。

## 当前验证限制

本地环境没有 PostgreSQL 或 Docker，因此当前已完成单元测试、迁移事务流程测试和 SQL 结构检查，尚未对真实 PostgreSQL 实例执行迁移。部署数据库后必须先在空库执行 `npm run db:migrate` 并检查七张管理表，再允许服务连接生产数据。
