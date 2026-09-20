# 登录会话管理

用户在「账户 → 登录安全 → 设备与会话」管理自己的登录；皇帝在「用户 → 用户详情 → 会话」查看和退出指定用户的会话。单条登出、退出其他已记录会话和全部退出都有确认，邮箱、邮件和 API Key 不受影响。

列表每页 5 条，当前会话置顶，显示设备摘要、最近 IP、最近访问、近期活跃标记及累计活跃时间；展开某条查看完整 UA、登录方式、首次登录/记录时间、登录与最近 IP。只允许同时展开一条，长 UA 换行，列表高度随视口限制。宽屏操作按钮与摘要同排。

## 时间与来源

- 一次登录对应一个独立会话，同一浏览器共享 Cookie 的标签页通常共用会话；再次登录会创建新记录。
- 首次登录时间由服务器在登录成功时记录。Cookie 续期不会重置该时间或会话标识。
- 最后访问来自通过会话校验的服务器请求，每条会话最多每分钟更新一次，不等同于用户最近一次键盘或鼠标操作。
- 累计活跃为估算值：可见页面每 30 秒发出心跳，近 5 分钟有键盘、指针、触摸或滚动操作才计时；隐藏页面停止心跳，超过 90 秒的间隔不累加。服务器按相邻心跳的实际间隔原子累加，多标签页不会重复计时。它不是考勤、计费或精确停留时长数据。
- UA 是客户端自报数据，仅作设备辨识参考。完整字符串最长保存 1024 字符并按普通文本显示。
- 来源 IP 沿用 `server.trustProxyHeaders`：关闭时显示未知，开启时读取部署代理提供的 IP。只有已确保代理覆盖来源头、源站入口受控时才应信任这些请求头。不会自动开启此设置。Cloudflare 场景请使用下文对应的反代配置。

## 升级与安全

SQLite/PostgreSQL 自动迁移 `0009_login_sessions`，记录独立于 Auth.js 的加密 JWT。每次认证均检查用户状态、全局撤销版本、会话归属、撤销状态与有效期；API Key 不允许访问会话管理接口。

升级前的有效 JWT 在首次访问时补录，使用稳定的服务端派生标识，Cookie 续期后继续指向同一记录。无法追溯原始登录时间、历史 IP/UA 和活跃时间；这类记录明确显示「升级前登录，时间未知」。未再次访问的旧会话尚未入表，可通过「全部退出」一并撤销。

单条撤销保留失效记录，防止旧 Cookie 重新补录；正常的 Auth.js 登出同样撤销服务端记录。全部退出还递增用户撤销版本，覆盖尚未入表的旧会话。维护清理任务仅在会话记录有效期结束一天后按原有批量上限清理，用户删除时级联删除记录。

跨用户管理仅接受皇帝登录会话。普通用户只能列出和退出自己的会话，服务端绑定用户与会话 ID，并沿用同源校验。管理接口设置 `private, no-store`，不返回 Cookie、JWT 或认证秘密。手动会话撤销与审计日志在同一事务提交。

被撤销的会话在下一次认证请求时失效；前台页面每 30 秒检查一次，隐藏或断网页面恢复访问后检查。网络失败不会自动清除有效登录。

## 验证

复用 `pnpm validate:credential-security`，验证稳定会话标识、旧 Cookie 撤销、单条与其他会话退出、用户隔离、皇帝操作、并发与空闲计时、正常登出后的 Cookie 重用、分页和可信代理 IP；同一脚本支持可丢弃 PostgreSQL 数据库。原有登录、API Key、同源防护及 HTTPS 代理行为一并验证。

## IP 地区与 Cloudflare

会话列表加载后再向同源接口请求地区，不参与登录校验或阻塞登出。普通用户只查询自己的会话，皇帝只查询已选用户当前页的会话，每页最多 10 个不同的首次/最近 IP；接口不接受任意 IP 或 URL。不会在浏览器直接调用外部服务或把地区存入 localStorage。

服务器按 GeoJS → ipwho.is → country.is 查询；首个来源缺少城市时继续尝试细化，采用单个来源的较详细结果，不拼接相互矛盾的地址。有国家、省/州和城市就显示到城市，只有国家就显示国家。展开会话可查看来源实际返回的运营商、邮编、时区、估算经纬度及精度半径。国家名称跟随界面语言；省市名称沿用服务商返回值。IP 位置可能对应运营商、VPN 或代理出口，不能作为街道门牌或真实住址。

对外只发送被查询的公网 IP，不转发用户 Cookie、UA、账户或邮件。固定 HTTPS 目标、禁止重定向，单服务 2.5 秒超时，响应上限 32 KiB；私网、回环和保留地址不查询。成功缓存 24 小时，失败缓存 5 分钟，最多 1024 个缓存条目；并发相同 IP 复用请求，单进程最多 4 个查询运行、16 个待处理 IP。429 遵守有上限的 Retry-After 冷却。服务不可用时显示“地区未知”，不影响会话管理。缓存仅在内存中，多实例各自缓存。

### 普通 CF 代理（橙云）

现有直连反代示例刻意使用 TCP 对端地址；不能原样套在 CF 后面，否则会记录成 CF 节点。

- Caddy 2.8+：参考 deploy/local/Caddyfile.cloudflare.example，使用 CF 官方网段作为 trusted_proxies，通过 CF-Connecting-IP 提取访客，再覆盖 X-MoeMail-Client-IP 为解析出的 client_ip。
- Nginx：把 deploy/local/cloudflare-real-ip.nginx.conf 放到服务器并在现有 http/server 块中 include；需要 http_realip_module。现有 nginx.conf.example 的 remote_addr 将变成还原后的访客 IP。
- 两种方案都保持 Node 端口不对公网开放，并配置 server.trustProxyHeaders: true。建议源站防火墙仅允许 CF 网段进入代理端口；CF SSL 使用 Full (strict)。
- 示例中的 22 个 IPv4/IPv6 网段取自 CF 官方列表，快照日期 2026-09-20。部署前和 CF 网段更新时重新核对，不要使用 0.0.0.0/0 或 ::/0 作为可信代理。
- CF 的 Pseudo IPv4 设为 Off 或 Add Header，保留真实 IPv6。直接由可信入口向应用传递 CF 头时，应用也兼容 Overwrite Headers 的 CF-Connecting-IPv6；上述 Caddy/Nginx 示例要求 Off/Add Header，避免在反代层把伪 IPv4 固化成标准来源头。
- 如果使用 cloudflared Tunnel，中间代理的 TCP 对端是本机 cloudflared，不是 CF 公网网段，必须单独只信任该受控入口，并覆盖客户端可以伪造的 X-MoeMail-Client-IP；不可直接套用公网 CF 网段配置。应用无法从 Next.js Headers 验证 TCP 对端，这个信任边界由入口代理负责。

CF 提供的是连接到其边缘节点的访客 IP，不能揭示访客 VPN/代理背后的原始地址。跨区域 Workers 子请求也可能只有 CF 的固定地址；不能把这些地址推断成真实访客。

资料：[GeoJS](https://www.geojs.io/docs/v1/endpoints/geo/)、[ipwho.is](https://ipwhois.io/documentation)、[country.is](https://country.is/)、[CF 请求头](https://developers.cloudflare.com/fundamentals/reference/http-headers/)、[CF IPv4 网段](https://www.cloudflare.com/ips-v4/)、[CF IPv6 网段](https://www.cloudflare.com/ips-v6/)。

必要回归：pnpm exec tsx scripts/validation/ip-location.ts（回退、缓存、地址过滤、限流冷却和 CF 头信任），以及原有会话接口权限校验。

## 其他 CDN / 多级反代的来源 IP

皇帝打开「账户 → 运行配置 → 服务 → 来源 IP / CDN」：

1. 先配置入口代理覆盖来源头、源站防火墙与端口访问限制，再打开信任开关。应用收到的 Request 不包含可用于验证可信网段的 TCP 对端信息；检测成功不代表代理可信。
2. 选择入口实际提供的头，支持 CF-Connecting-IP、True-Client-IP、Fastly-Client-IP、X-Real-IP、X-Forwarded-For、RFC 7239 Forwarded、CloudFront-Viewer-Address、X-Azure-ClientIP 及自定义头。名称是接入契约，不代表厂商一定默认发送或自动保证其安全。
3. 推荐在反代验证上游后，统一覆盖单值 X-MoeMail-Client-IP，并在面板明确选择它。直连部署继续用仓库的普通 Caddy/Nginx 示例；经过 CDN 时必须先在反代按 CDN 官方网段还原访客 IP，不能直接把 CDN 节点地址写成访客 IP。
4. 对 X-Forwarded-For、Forwarded、自定义逗号链，设置「从右侧取第几个 IP」。例如收到 `伪造值, 访客IP, CDN节点IP`，且受控入口确实把 CDN 节点追加在末尾时，选 2；不能仅按机器数量猜测。链中任一 IP 格式无效则拒绝整条链，不先删除无效项再改变索引。最安全的做法仍是在入口验证并归一化成单个 IP。
5. 点击「检测当前请求」，比较当前生效结果与草稿预览，展开查看收到的合法 IP 值。检测不保存、不自动启用信任、不发送第三方查询。确认后点击底部「保存并应用」，再检测一次。这个配置同时影响登录限流和新会话/最近访问记录；不会重写历史首次 IP。

对应 YAML（按实际入口调整）：

```yaml
server:
  trustProxyHeaders: true
  clientIpHeader: x-moemail-client-ip
  clientIpTrustedHops: 1
```

`clientIpHeader` 默认 `auto`，兼容顺序为 X-MoeMail-Client-IP → CF-Connecting-IP → X-Real-IP → X-Forwarded-For。默认只采用已有的这四类头，不自动扩大到所有 CDN 头；明确指定后不回退其他头。旧配置自动补齐字段，无需改数据库。代理链现在默认取最右侧 1 个，避免把最左侧客户端注入值当作访客；之前自定义了多级追加链的部署应按收到的实际链调整，仓库原有单值覆盖示例不受影响。关闭信任或头缺失/无效时记录未知，不猜测来源。

CloudFront 带端口的 `IPv4:port` / `[IPv6]:port`、Forwarded 中的 `for="[IPv6]:port"` 均可解析。单 IP 头出现多个值会拒绝；请求头最大 2048 字符、32 个链元素，位置可选 1–16。自定义头不能使用 Cookie、Authorization 或含 token/secret/key 的认证类名称。诊断接口仅限皇帝登录会话，响应不缓存，且仅返回解析后的 IP，不回显原始头内容。

厂商注意事项：Fastly-Client-IP 默认可能沿用客户端值，应在首次进入服务时按官方 VCL 示例用 client.ip 覆盖；Akamai True-Client-IP 应禁止客户自行提供该头。其他 CDN 同样按官方文档配置边缘覆盖与可信源站入口，不要直接信任同名头。CF 的注意事项和入口示例见上节。

参考：[Fastly-Client-IP](https://www.fastly.com/documentation/reference/http/http-headers/Fastly-Client-IP/)、[Akamai Origin / True Client IP](https://techdocs.akamai.com/property-mgr/reference/latest-origin)、[RFC 7239](https://www.rfc-editor.org/rfc/rfc7239.html)。

必要回归：`pnpm exec tsx scripts/validation/client-ip.ts`，以及 `pnpm validate:credential-security` 中的诊断权限隔离和只预览不保存检查。
