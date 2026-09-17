# 本轮安全修复的部署

工作区代码已修复，服务器只有运行新构建后才获得保护。

## 发布顺序

1. 按现有运维流程备份数据库及配套配置；部署多实例时一起替换旧版本，避免混跑。
2. 发布包含本次修改的代码和锁文件。裸机安装及构建：

   ```powershell
   pnpm install --frozen-lockfile
   pnpm build
   pnpm build:maintenance
   ```

3. 重启 Web 服务及使用旧维护构建的任务。新 Web 进程在开放业务接口前自动迁移数据库中的旧 API Key。也可在停止旧进程后，通过新版本的 `pnpm db:migrate` 显式执行迁移。
4. 登录检查正常角色管理、邮箱操作及已有 CLI/MCP API Key。监控启动迁移错误和 HTTP 401/403；不应通过关闭来源校验解决代理配置错误。

Docker 部署需要重新构建、发布并使用包含本次修改的 Web 和 maintenance 镜像。仅重启旧镜像或拉取尚未更新的远端标签不会应用工作区修复。

## 兼容性

- API Key 的客户端值不变，新签发值仍为 `mk_...`，只在创建时展示；数据库的 `key` 列改存 `sha256:` 摘要。
- SQLite 和 PostgreSQL 的数据迁移支持重复执行；失败时事务回滚。D1 导入会直接生成摘要，不会把明文重新引入目标库。
- 旧程序无法识别摘要格式，不应与新版本混跑。回滚需使用升级前的数据库/配置备份，不能只回滚程序。
- 旧备份中的明文不会自动消失。若数据库或旧备份曾泄漏，应禁用/删除并重新签发相关 Key；仅迁移存储格式不会使已泄漏的原始 Key 失效。
- 使用会话 Cookie 的 POST / PUT / PATCH 必须使用 `Content-Type: application/json`，浏览器请求必须来自同源。反向代理应正确保留 Host，并由代理设置 X-Forwarded-Proto；API Key 客户端不受会话来源检查限制。

## 本地验证

```powershell
pnpm validate:security
pnpm validate:api-key-migration --postgres
pnpm validate:setup:http
pnpm audit
```

PostgreSQL 迁移测试使用独立临时集群，要求 PATH 中有 `initdb`、`pg_ctl`。不带 `--postgres` 时执行 SQLite 迁移及 D1 导入测试。当前依赖审计为 0 项告警，不代表覆盖了所有业务漏洞或生产部署差异。
