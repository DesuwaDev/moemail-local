import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, unwatchFile } from "node:fs"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { eq } from "drizzle-orm"


const root = process.cwd()
const scratch = resolve(root, "node_modules/.cache/admin-management")
mkdirSync(scratch, { recursive: true })
const temporaryRoot = mkdtempSync(join(scratch, "run-"))
const postgresUrl = process.argv.find(arg => arg.startsWith("--postgres-url="))?.slice(15)
const load = (file: string) => import(pathToFileURL(resolve(root, file)).href)
let server: ChildProcess | undefined
let closeDatabase: (() => Promise<void>) | undefined
let output = ""

try {
  for (const folder of ["drizzle-local", "drizzle-postgres"]) cpSync(resolve(root, folder), join(temporaryRoot, folder), { recursive: true })
  for (const folder of ["drizzle-local", "drizzle-postgres"]) {
    const path = join(temporaryRoot, folder, "meta/_journal.json")
    const journal = JSON.parse(readFileSync(path, "utf8"))
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 8)
    writeFileSync(path, JSON.stringify(journal))
  }
  process.chdir(temporaryRoot)
  const setup = await load("app/lib/setup-service.ts")
  assert.equal((await setup.completeSetup({
    config: { server: { baseUrl: "http://127.0.0.1:3000" }, database: postgresUrl
      ? { driver: "postgres", postgres: { url: postgresUrl } }
      : { driver: "sqlite", sqlite: { path: "data/security.db" } } },
    admin: { username: "security-owner", password: "security-test-password-123" },
  })).ok, true)
  if (postgresUrl) (globalThis as typeof globalThis & { __moemailBoundDriver?: string }).__moemailBoundDriver = "postgres"
  const database = await load("app/lib/db.ts")
  closeDatabase = database.closeDatabase
  const schema = await load("app/lib/schema.ts")
  const db = database.createDb()
  const [owner] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, "security-owner"))

  const legacyDate = new Date(Date.now() + 86400000)
  if (postgresUrl) {
    await database.getPostgresPool().query('INSERT INTO email (id, address, "userId", created_at, expires_at) VALUES ($1, $2, $3, $4, $4)', ["before-upgrade", "legacy@security.test", owner.id, legacyDate])
    const { migrate } = await import("drizzle-orm/node-postgres/migrator")
    await migrate(db, { migrationsFolder: resolve(root, "drizzle-postgres") })
  } else {
    database.getSqlite().prepare('INSERT INTO email (id, address, "userId", created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run("before-upgrade", "legacy@security.test", owner.id, legacyDate.getTime(), legacyDate.getTime())
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator")
    migrate(db, { migrationsFolder: resolve(root, "drizzle-local") })
  }
  const [legacy] = await db.select().from(schema.emails).where(eq(schema.emails.id, "before-upgrade"))
  assert.equal(legacy.disabledAt, null)
  assert.equal(legacy.receiveEnabled, true); assert.equal(legacy.sendEnabled, true); assert.equal(legacy.shareEnabled, true)
  for (const directory of [".next", "node_modules", "public"]) symlinkSync(resolve(root, directory), join(temporaryRoot, directory), "junction")
  for (const file of ["package.json", "next.config.ts", "next-intl.config.ts", "tsconfig.json"]) cpSync(resolve(root, file), join(temporaryRoot, file))
  for (const folder of ["drizzle-local", "drizzle-postgres"]) cpSync(resolve(root, folder), join(temporaryRoot, folder), { recursive: true })
  const listener = createServer()
  await new Promise<void>(done => listener.listen(0, "127.0.0.1", done))
  const port = (listener.address() as { port: number }).port
  await new Promise<void>(done => listener.close(() => done()))
  const base = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "start", ".", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: temporaryRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  server.stdout?.on("data", chunk => { output += String(chunk) })
  server.stderr?.on("data", chunk => { output += String(chunk) })
  for (let attempt = 0; ; attempt++) {
    if (await fetch(`${base}/api/auth/csrf`).then(r => r.ok).catch(() => false)) break
    if (attempt > 100) throw new Error("Server startup timed out")
    await new Promise(done => setTimeout(done, 200))
  }
  const makeClient = () => {
    const cookies = new Map<string, string>()
    return async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set("Cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "))
      if (!headers.has("Origin")) headers.set("Origin", base)
      const response = await fetch(base + path, { ...init, headers, redirect: "manual" })
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";", 1)[0], index = pair.indexOf("=")
        cookies.set(pair.slice(0, index), pair.slice(index + 1))
      }
      return response
    }
  }
  const { hashPassword } = await load("app/lib/password.ts")
  const password = await hashPassword("security-test-password-123")
  const { saveDomainPolicies } = await load("app/lib/domain-policies.ts")
  await saveDomainPolicies([{ domain: "security.test", inbound: { mode: "worker" }, outbound: { mode: "disabled" } }])
  const { inspectInboundRecipient, ingestEmail } = await load("app/lib/email-ingestion.ts")
  const [target] = await db.insert(schema.users).values({ username: "mail-owner", name: "邮箱测试用户", password }).returning()
  const [otherUser] = await db.insert(schema.users).values({ username: "other-owner", password }).returning()
  const [duke] = await db.insert(schema.roles).values({ name: "duke" }).returning()
  await db.insert(schema.userRoles).values([{ userId: target.id, roleId: duke.id }, { userId: otherUser.id, roleId: duke.id }])
  const mailboxes = await db.insert(schema.emails).values(Array.from({ length: 11 }, (_, index) => ({ userId: target.id, address: `searchable-${index}@security.test`, expiresAt: new Date(Date.now() + 86400000) }))).returning()
  const mailbox = mailboxes[0], spare = mailboxes[1]
  const [otherMailbox] = await db.insert(schema.emails).values({ userId: otherUser.id, address: "other@security.test", expiresAt: new Date(Date.now() + 86400000) }).returning()
  const entries = await db.insert(schema.messages).values(Array.from({ length: 14 }, (_, index) => ({ emailId: mailbox.id, subject: `测试邮件 ${index}`, fromAddress: "sender@security.test", toAddress: mailbox.address, content: "正文测试", html: "<p>正文测试</p><img src='https://tracking.invalid/pixel'>", type: index === 0 ? "sent" : index === 1 ? null : "received" }))).returning()
  const incoming = entries[1]
  await db.insert(schema.messageAttachments).values({ id: "fixture-attachment", messageId: incoming.id, filename: "hello.txt", contentType: "text/plain", size: 5, data: Buffer.from("hello") })
  const [mailShare] = await db.insert(schema.emailShares).values({ emailId: mailbox.id, token: "fixturemailshare01", expiresAt: new Date(Date.now() + 86400000) }).returning()
  const [messageShare] = await db.insert(schema.messageShares).values({ messageId: incoming.id, token: "fixturemessageshare01", expiresAt: new Date(Date.now() + 86400000) }).returning()
  const { digestApiKey } = await load("app/lib/api-key-digest.ts")
  await db.insert(schema.apiKeys).values({ userId: target.id, name: "fixture", key: digestApiKey("mk_admin_fixture"), expiresAt: new Date(Date.now() + 86400000) })
  const first = makeClient(), ordinary = makeClient(), other = makeClient()
  const login = async (request: typeof first, username: string, userId: string) => {
    const { csrfToken } = await (await request("/api/auth/csrf")).json()
    await request("/api/auth/callback/credentials", { method: "POST", body: new URLSearchParams({ csrfToken, username, password: "security-test-password-123", callbackUrl: base }) })
    assert.equal((await (await request("/api/auth/session")).json()).user?.id, userId)
  }
  await login(first, "security-owner", owner.id)
  await login(ordinary, target.username, target.id)
  await login(other, otherUser.username, otherUser.id)
  const json = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const adminPath = `/api/admin/mailboxes/${mailbox.id}`
  const body = async (response: Response, status = 200) => { const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value }
  assert.equal((await fetch(base + "/api/admin/mailboxes")).status, 401)
  assert.equal((await ordinary("/api/admin/mailboxes")).status, 403)
  assert.equal((await first(adminPath, { headers: { "X-API-Key": "mk_admin_fixture" } })).status, 403)
  assert.equal((await first(adminPath, { ...json({ disabled: true }, "PATCH"), headers: { "Content-Type": "application/json", Origin: "https://other.invalid" } })).status, 403)
  assert.equal((await first(adminPath, json({ userId: otherUser.id }, "PATCH"))).status, 400)
  const list = await body(await first(`/api/admin/mailboxes?search=SEARCHABLE-&page=1&pageSize=8`))
  assert.equal(list.total, 11); assert.equal(list.items.length, 8)
  assert.equal((await body(await first("/api/admin/mailboxes?search=%25"))).total, 0, "search treats percent literally")
  assert.equal((await body(await first(`/api/roles/users?search=searchable-0@security.test`))).users[0]?.id, target.id)
  const summary = await body(await first(`/api/users/${target.id}?mailboxPageSize=50`))
  const counted = summary.mailboxes.items.find((item: { id: string }) => item.id === mailbox.id)
  assert.equal(counted.receivedCount, 13); assert.equal(counted.sentCount, 1)
  assert.equal(summary.summary.receivedMessages, 13); assert.equal(summary.summary.sentMessages, 1)
  const inbox = await body(await first(adminPath + "/messages"))
  assert.equal(inbox.total, 13); assert.equal(inbox.items.length, 10)
  assert.equal(inbox.mailbox.receivedCount, 13); assert.equal(inbox.mailbox.sentCount, 1)
  assert.equal((await body(await first(adminPath + "/messages?page=2"))).items.length, 3)
  assert.equal((await body(await first(adminPath + "/messages?folder=sent"))).total, 1)
  assert.equal((await first(`/api/admin/mailboxes/${otherMailbox.id}/messages/${incoming.id}`)).status, 404)
  assert.equal((await body(await first(adminPath + `/messages/${incoming.id}`))).message.content, "正文测试")
  assert.equal(await (await first(adminPath + `/messages/${incoming.id}?attachment=fixture-attachment`)).text(), "hello")
  assert.equal((await other(`/api/emails/${mailbox.id}/${incoming.id}`)).status, 403)
  for (const tokenPath of [`/api/shared/${mailShare.token}`, `/api/shared/message/${messageShare.token}`]) assert.equal((await fetch(base + tokenPath)).status, 200)
  assert.equal((await inspectInboundRecipient(mailbox.address, "worker")).accepted, true)
  await body(await first(adminPath, json({ disabled: true }, "PATCH")))
  assert.equal((await inspectInboundRecipient(mailbox.address, "worker")).accepted, false)
  assert.equal((await ordinary(`/api/emails/${mailbox.id}`)).status, 403)
  assert.equal((await ordinary(`/api/emails/${mailbox.id}/${incoming.id}`)).status, 403)
  assert.equal((await first(adminPath + `/messages/${incoming.id}`)).status, 200, "emperor can inspect disabled mailbox")
  for (const tokenPath of [`/api/shared/${mailShare.token}`, `/api/shared/${mailShare.token}/messages`, `/api/shared/${mailShare.token}/messages/${incoming.id}`, `/api/shared/message/${messageShare.token}`]) assert.notEqual((await fetch(base + tokenPath)).status, 200)
  await body(await first(adminPath, json({ disabled: false, sendEnabled: false, shareEnabled: false, receiveEnabled: false }, "PATCH")))
  assert.equal((await inspectInboundRecipient(mailbox.address, "worker")).accepted, false)
  assert.equal((await ordinary(`/api/emails/send-permission?emailId=${mailbox.id}`)).status, 403)
  assert.equal((await ordinary(`/api/emails/${mailbox.id}/share`, json({ expiresIn: 3600 }))).status, 403)
  assert.equal((await ordinary(`/api/emails/${mailbox.id}/messages/${incoming.id}/share`, json({ expiresIn: 3600 }))).status, 403)
  await body(await first(adminPath, json({ sendEnabled: true, shareEnabled: true, receiveEnabled: true }, "PATCH")))
  const delivered = await ingestEmail({ raw: Buffer.from("From: sender@security.test\r\nTo: " + spare.address + "\r\nSubject: delivery-test\r\n\r\nhello"), envelopeFrom: "sender@security.test", envelopeTo: spare.address, transport: "worker" })
  assert.equal(delivered.status, "created", "enabled mailbox still receives mail through atomic commit")
  await body(await first(`/api/access-policies/users/${target.id}`, json({ permissions: { view_message_content: false, delete_message: false }, quotas: {} }, "PUT")))
  assert.equal((await ordinary(`/api/emails/${mailbox.id}`)).status, 200)
  assert.equal((await ordinary(`/api/emails/${mailbox.id}/${incoming.id}`)).status, 403)
  assert.notEqual((await fetch(base + `/api/shared/${mailShare.token}`)).status, 200, "share tokens cannot bypass revoked body permission")
  assert.equal((await ordinary(`/api/emails/${mailbox.id}/${incoming.id}`, { method: "DELETE" })).status, 403)
  await body(await first(`/api/access-policies/users/${target.id}`, json({ permissions: { download_attachment: false }, quotas: {} }, "PUT")))
  assert.equal((await ordinary(`/api/emails/${mailbox.id}/${incoming.id}?attachment=fixture-attachment`)).status, 403)
  assert.equal((await body(await ordinary(`/api/emails/${mailbox.id}/${incoming.id}`))).message.attachments.length, 0)
  await body(await first(`/api/access-policies/users/${target.id}`, { method: "DELETE" }))
  await body(await first(adminPath, json({ expiresAt: "9999-12-31T23:59:59.999Z" }, "PATCH")))
  assert.equal(new Date((await body(await first(adminPath))).mailbox.expiresAt).getUTCFullYear(), 9999)
  const beforePolicy = await body(await first("/api/access-policies"))
  await body(await first("/api/access-policies", json({ role: "knight", policy: { ...beforePolicy.policies.roles.knight, quotas: { ...beforePolicy.policies.roles.knight.quotas, maxActiveMailboxes: 7 } } }, "PATCH")))
  const afterPolicy = await body(await first("/api/access-policies"))
  assert.deepEqual(afterPolicy.policies.roles.duke, beforePolicy.policies.roles.duke)
  assert.deepEqual(afterPolicy.policies.mailQuotaRules, beforePolicy.policies.mailQuotaRules)
  assert.equal(afterPolicy.policies.roles.knight.quotas.maxActiveMailboxes, 7)
  for (const action of ["sessions", "apiKeys", "webhooks", "shares"]) {
    assert.equal((await first(`/api/admin/users/${owner.id}/actions`, json({ action }))).status, 403)
    await body(await first(`/api/admin/users/${target.id}/actions`, json({ action })))
  }
  assert.equal((await ordinary(`/api/emails/${mailbox.id}`)).status, 401)
  assert.equal((await fetch(base + `/api/emails/${mailbox.id}`, { headers: { "X-API-Key": "mk_admin_fixture" } })).status, 401)
  assert.equal((await fetch(base + `/api/shared/${mailShare.token}`)).status, 404)
  const audit = await body(await first(`/api/admin/users/${target.id}/audit`))
  assert.ok(audit.total >= 8); assert.equal(audit.items.length, 10)
  await body(await first(adminPath + `/messages/${incoming.id}`, { method: "DELETE" }))
  assert.equal((await db.select().from(schema.messageAttachments).where(eq(schema.messageAttachments.messageId, incoming.id))).length, 0)
  assert.equal((await body(await first(adminPath))).mailbox.receivedCount, 12)
  await body(await first(`/api/admin/mailboxes/${spare.id}`, { method: "DELETE" }))
  assert.equal((await db.select().from(schema.emails).where(eq(schema.emails.id, spare.id))).length, 0)
  assert.equal((await db.select().from(schema.sendQuotaEvents).where(eq(schema.sendQuotaEvents.userId, target.id))).length, 1, "deletion retains quota history")
  console.log(JSON.stringify({ driver: postgresUrl ? "postgres" : "sqlite", passed: ["owner-search", "live-counts", "pagination", "mail-and-attachments", "ownership", "emperor-session-only", "csrf", "mailbox-controls", "permission-enforcement", "targeted-role-save", "resource-revocation", "audit", "cascade-delete"] }))
  if (process.argv.includes("--keep-server")) {
    console.log(`UI fixture: ${base}/login (security-owner / security-test-password-123)`)
    await new Promise<void>(done => { process.once("SIGINT", done); process.once("SIGTERM", done) })
  }
} catch (error) {
  console.error(output.slice(-8000))
  throw error
} finally {
  server?.kill()
  await closeDatabase?.()
  unwatchFile(join(temporaryRoot, "data/config.yaml"))
  process.chdir(root)
}
