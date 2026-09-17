# 安全审查：2026-09-17

## 修复状态

下方问题清单描述修复前的基线。本轮已落实以下修改，尚未部署到外部服务器：

- Next.js / eslint-config-next 升至 `15.5.24`，sharp 升至 `0.35.4`，Nodemailer 升至 `9.1.1`；更新构建和开发依赖中的漏洞版本。完整 `pnpm audit`（含开发依赖）当前为 0 项告警，peer 检查通过。
- 统一鉴权入口对会话认证的写请求执行同源检查；POST / PUT / PATCH 要求 JSON 内容类型。API Key 客户端保留独立认证路径。
- 新 API Key 仅存 `sha256:` 摘要；启动、数据库迁移和 D1 导入都处理旧值。复用原唯一索引列，无需新增数据库列；已有客户端 Key 保持可用，数据库摘要不能作为凭据重放。
- 已通过真实 HTTP 回归、SQLite / PostgreSQL 批量迁移与回滚、PostgreSQL 并发迁移、两种 D1 导入、生产构建、完整 SQLite 业务 HTTP 测试、类型检查、lint、五语校验、真实 TCP SMTP 测试、SQLite 恢复测试、Miniflare 本地运行测试和 Wrangler Worker 打包 dry-run（未部署）。

部署前保留备份，一起替换所有旧实例，避免新旧版本混跑。启动时会自动迁移 API Key；旧版本无法识别摘要格式，回滚需配套旧备份。旧备份本身不会被改写；若其曾泄漏，应轮换旧 Key。详细步骤见 `docs/security-fix-deployment.zh-CN.md`。

## 修复前的发现

本轮检查当前工作区的认证、角色授权、邮件所有权、分享、初始化、Webhook、邮件渲染和依赖。发现需要优先处理的依赖漏洞，以及已通过真实 HTTP 请求复现的业务 CSRF 和 API Key 明文保存问题。没有确认普通用户在无管理员会话、无引导密钥条件下直接获得 emperor 的路径。

## 1. 高优先级：Next.js 版本命中 Windows 未认证 RCE 公告

- 位置：`package.json:94`；声明、锁文件和已安装版本均为 `15.5.23`。
- 公告：CVE-2026-75604 / GHSA-p293-qw3h-jr36，2026-09-08 发布；15.x 首个修复版本为 `15.5.24`。
- 条件：部署服务器使用 Windows 文件系统，应用使用 Pages / App Router 且不使用 Cache Component。本项目使用 App Router，没有配置该特性。开发机为 Windows，不能据此认定生产部署也为 Windows；仓库 Dockerfile 使用 Linux。
- 影响：公告报告未认证远程代码执行。这里只确认受影响版本和代码配置，未运行 RCE 载荷。
- 修复：至少升级 `next` 至 `15.5.24`，同步更新 `eslint-config-next` 和锁文件，重新构建并替换部署产物。若服务实际对外运行在 Windows，应立即优先处理。

[Next.js 官方公告](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)

## 2. 高优先级：图片优化链命中 Next.js / sharp 的 AVIF 漏洞

- 位置：`package.json:94,105`，`next.config.ts:27`；已安装 `sharp 0.35.0`。
- 公告：Next.js GHSA-2xp9-vwfh-vxw4；sharp GHSA-rgj7-g3m4-5g8c。修复下限分别为 `next 15.5.24`、`sharp 0.35.4`。
- 条件：恶意 AVIF 内容进入图片优化器。远程图片当前限制在 GitHub 和 Google 头像域名，降低了任意来源可达性；尚未证明攻击者能通过这些来源投递所需恶意原始文件。不能据版本命中直接认定本项目已可利用。
- 影响：底层 libheif 内存安全漏洞可能造成进程崩溃或远程代码执行，sharp 公告说明特定 glibc Linux 条件下的 RCE 风险。Linux Docker 部署不应因不受上一条 Windows 漏洞影响而忽略这一条。
- 修复：同时升级 Next.js 和 sharp；仅升级 Next.js 不能证明项目显式固定的旧 sharp 已替换。检查最终锁文件及镜像内实际版本。

[Next.js 官方公告](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4)、[sharp 官方公告](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c)

## 3. 高优先级：业务写接口缺少统一来源校验，可借管理员会话变更角色

- 位置：`app/lib/request-auth.ts:48`，`app/api/roles/promote/route.ts:12-46`；现成防护函数位于 `app/lib/request-origin.ts`，目前没有在统一授权入口调用。
- 原因：角色变更只检查会话和 `promote_user` 权限，随后直接调用 `request.json()`，既不检查 Origin / Sec-Fetch-Site，也不限制 JSON Content-Type。Auth.js 登录接口的 CSRF 防护不会自动保护这些业务路由。
- 隔离 HTTP 复现：创建临时管理员、普通测试用户和 SQLite 数据库，正常登录管理员；向 `/api/roles/promote` 发送 `Content-Type: text/plain`、不同 Origin、`Sec-Fetch-Site: same-site` 的 JSON 请求，返回 200，数据库中目标用户角色变为 `duke`。相同请求移除会话后返回 401。
- 实际攻击前提：受害者已登录且具备角色管理权限，攻击者控制同站但不同源的页面，例如同一主域下的兄弟子域，或同主机不同端口。SameSite=Lax 不能阻止此类同站请求；text/plain 是浏览器可发送的简单请求，攻击不需要读取响应。普通跨站页面通常受 SameSite 限制，因此不应描述为“任意网站无条件提权”。
- 范围：本轮实测达到 duke，不是 emperor；`init-emperor` 另有引导密钥保护。配置修改、Webhook 保存等 POST 接口也缺少统一来源校验，但尚未逐个执行状态变更复现。
- 修复：在 `authorizeRequest` 中对使用会话的 POST / PUT / PATCH / DELETE 统一调用现有 `isSameOriginMutation`，拒绝同站不同源及跨站请求；JSON 写接口额外限制 Content-Type。API Key 调用单独保留兼容性，不依赖浏览器 Cookie 作为认证。增加同源成功、同站不同源拒绝、跨站拒绝、无会话拒绝及 API Key 正常调用的回归测试。

本次使用真实 Next.js HTTP 服务和真实 Auth.js 会话；测试客户端手动构造浏览器请求头，没有运行浏览器交互式攻击演示。

## 4. 中优先级：API Key 明文入库，数据库只读泄漏可变成账户 API 访问

- 位置：`app/api/api-keys/route.ts:49-56`，`app/lib/apiKey.ts:24`。
- 原因：完整 `mk_...` 凭据原样写入 `api_keys.key`，认证直接按明文等值查询；默认有效期一年。
- 隔离复现：通过接口签发测试密钥，读取隔离数据库中的值，确认与签发值完全一致；使用该数据库值作为 X-API-Key 请求 `/api/config`，返回 200。
- 影响边界：需要先获得数据库、备份或类似只读访问，本问题本身不提供数据库读取入口。取得密钥后可以使用该用户获准的邮件/配置 API；API Key 路由白名单仍限制角色管理接口，不能说它直接授予全部管理员能力。
- 修复：新增摘要字段，为高熵随机 API Key 保存 SHA-256 摘要及用于展示的前缀，只在创建时返回完整密钥；查询时摘要匹配。兼容迁移旧行后去掉明文。旧备份仍可能包含密钥，迁移后应轮换旧密钥，而不只是修改当前表。

## 依赖扫描与验证边界

`pnpm audit --prod --json` 报告 14 项：2 critical、8 high、3 moderate、1 low。这是依赖公告计数，不代表 14 条已可利用的项目攻击路径；其中 Next.js / sharp 的图片问题也有共同的底层原因。next-pwa 引入的部分告警主要属于构建链。

此外 `nodemailer 9.0.5` 有多项公告，建议随本轮依赖更新升至至少 `9.1.1`。本项目对收件人做长度、数量和地址规范化检查，且未发现调用旧签名 `MailMessage.resolveContent` 的业务路径，所以没有把这些公告直接列为已复现的文件读取、SSRF 或投递绕过。

正向检查：已读的邮件详情/删除路径绑定当前用户和邮箱；过期邮箱有检查；角色变更禁止任意指定 emperor；引导密钥比较使用固定长度摘要和 timingSafeEqual；Webhook 会检查非公网地址并将连接固定到已解析 IP；HTML 邮件位于无脚本权限的 sandbox iframe。这些检查不构成对所有路由和所有部署配置的安全保证。

修复后回归命令：`pnpm validate:security` 和 `pnpm validate:api-key-migration --postgres`。HTTP 脚本复制源码至独立临时目录，使用新数据库和测试身份，仅监听 `127.0.0.1`，不读取项目原有 `data/`。为验证 API，测试服务未启用 PWA 构建和后台邮件轮询；未测试生产反向代理或真实 OAuth 提供方。`results.json` 保留原始漏洞证据，修复后结果写入 `docs/security-review-artifacts/regression-results.json`；依赖原始结果、修复后审计和公告快照位于同目录。历史复现模式 `--baseline` 仅适用于修复前源码。

生产实现和依赖已在当前工作区修复，未操作现有部署数据。临时副本的递归清理被执行策略拒绝，测试副本保留在 `docs/security-review-artifacts/run-*/`，已通过同目录 `.gitignore` 排除 Git 跟踪。
