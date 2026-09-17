import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unwatchFile, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { eq } from "drizzle-orm"

const root = process.cwd()
const scratch = resolve(root, "node_modules/.cache/credential-security")
mkdirSync(scratch, { recursive: true })
const temporaryRoot = mkdtempSync(join(scratch, "run-"))
const postgresUrl = process.argv.find(arg => arg.startsWith("--postgres-url="))?.slice(15)
const load = (file: string) => import(pathToFileURL(resolve(root, file)).href)
let server: ChildProcess | undefined
let closeDatabase: (() => Promise<void>) | undefined
let output = ""

try {
  for (const folder of ["drizzle-local", "drizzle-postgres"]) {
    cpSync(resolve(root, folder), join(temporaryRoot, folder), { recursive: true })
    const journalPath = join(temporaryRoot, folder, "meta/_journal.json")
    const journal = JSON.parse(readFileSync(journalPath, "utf8"))
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 6)
    writeFileSync(journalPath, JSON.stringify(journal))
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
  const { digestApiKey } = await load("app/lib/api-key-digest.ts")
  const oldKey = "mk_legacy_security_fixture"
  if (postgresUrl) {
    await database.getPostgresPool().query("INSERT INTO api_keys (id, user_id, name, key, expires_at) VALUES ('legacy', $1, 'legacy', $2, $3)", [owner.id, digestApiKey(oldKey), new Date(Date.now() + 3600000)])
    const { migrate } = await import("drizzle-orm/node-postgres/migrator")
    await migrate(db, { migrationsFolder: resolve(root, "drizzle-postgres") })
  } else {
    database.getSqlite().prepare("INSERT INTO api_keys (id, user_id, name, key, expires_at) VALUES ('legacy', ?, 'legacy', ?, ?)").run(owner.id, digestApiKey(oldKey), Math.floor(Date.now() / 1000) + 3600)
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator")
    migrate(db, { migrationsFolder: resolve(root, "drizzle-local") })
  }
  const [legacy] = await db.select().from(schema.apiKeys)
  assert.equal(legacy.accessLevel, "full")
  assert.equal(legacy.mailboxId, null)
  const [mailbox] = await db.insert(schema.emails).values({ userId: owner.id, address: "first@security.test", expiresAt: new Date(Date.now() + 86400000) }).returning()
  const [other] = await db.insert(schema.emails).values({ userId: owner.id, address: "second@security.test", expiresAt: new Date(Date.now() + 86400000) }).returning()
  const { validateSessionToken } = await load("app/lib/session-security.ts")
  assert.ok(await validateSessionToken({ id: owner.id }), "pre-upgrade JWT survives migration")

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
  const first = makeClient(), second = makeClient()
  const login = async (request: typeof first) => {
    const { csrfToken } = await (await request("/api/auth/csrf")).json()
    await request("/api/auth/callback/credentials", { method: "POST", body: new URLSearchParams({ csrfToken, username: "security-owner", password: "security-test-password-123", callbackUrl: base }) })
    assert.equal((await (await request("/api/auth/session")).json()).user?.id, owner.id)
  }
  await login(first)
  await login(second)
  const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const issue = async (body: unknown) => {
    const response = await first("/api/api-keys", json(body))
    assert.equal(response.status, 200, await response.clone().text())
    return (await response.json()).key as string
  }
  const readKey = await issue({ name: "readonly", accessLevel: "read", mailboxAddress: mailbox.address, expiresInDays: 7 })
  const mailKey = await issue({ name: "mail", accessLevel: "mail", expiresInDays: 30 })
  const scopedMailKey = await issue({ name: "scoped-mail", accessLevel: "mail", mailboxAddress: mailbox.address })
  const compatKey = await issue({ name: "old-client" })
  const keyRequest = (key: string, path: string, method = "GET") => fetch(base + path, { method, headers: { "X-API-Key": key, "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) })
  const list = await (await keyRequest(readKey, "/api/emails")).json()
  assert.deepEqual(list.emails.map((item: { id: string }) => item.id), [mailbox.id])
  assert.equal(list.total, 1)
  assert.equal((await keyRequest(readKey, `/api/emails/${mailbox.id}`)).status, 200)
  assert.equal((await keyRequest(readKey, `/api/emails/${other.id}`)).status, 403)
  assert.equal((await keyRequest(scopedMailKey, `/api/emails/send-permission?emailId=${other.id}`)).status, 403)
  assert.equal((await keyRequest(readKey, `/api/emails/send-permission?emailId=${mailbox.id}`)).status, 403)
  for (const [path, method] of [[`/api/emails/${mailbox.id}`, "DELETE"], [`/api/emails/${mailbox.id}/share`, "GET"], ["/api/emails/generate", "POST"], ["/api/config/domains", "GET"], ["/api/config", "POST"]]) {
    assert.equal((await keyRequest(readKey, path, method)).status, 403, path)
  }
  assert.equal((await (await keyRequest(readKey, "/api/config")).json()).captcha, undefined)
  assert.equal((await keyRequest(mailKey, "/api/config/domains")).status, 403)
  assert.equal((await keyRequest(mailKey, `/api/emails/${mailbox.id}/share`)).status, 200)
  for (const key of [oldKey, compatKey]) assert.equal((await keyRequest(key, "/api/config/domains")).status, 200)
  assert.equal((await first("/api/api-keys", json({ name: "invalid", accessLevel: "root" }))).status, 400)
  assert.equal((await first("/api/api-keys", json({ name: "missing", mailboxAddress: "missing@security.test" }))).status, 404)
  const [restricted] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.name, "readonly"))
  assert.equal(restricted.key, digestApiKey(readKey))
  assert.ok(Math.abs(restricted.expiresAt.getTime() - Date.now() - 7 * 86400000) < 60000)
  await db.update(schema.apiKeys).set({ enabled: false }).where(eq(schema.apiKeys.id, restricted.id))
  assert.equal((await keyRequest(readKey, "/api/emails")).status, 401)
  await db.update(schema.apiKeys).set({ enabled: true, expiresAt: new Date(0) }).where(eq(schema.apiKeys.id, restricted.id))
  assert.equal((await keyRequest(readKey, "/api/emails")).status, 401)
  await db.update(schema.apiKeys).set({ expiresAt: new Date(Date.now() + 86400000) }).where(eq(schema.apiKeys.id, restricted.id))
  await db.delete(schema.emails).where(eq(schema.emails.id, mailbox.id))
  assert.equal((await (await keyRequest(readKey, "/api/emails")).json()).total, 0)
  assert.equal((await keyRequest(readKey, `/api/emails/${other.id}`)).status, 403)
  assert.equal((await first("/api/account/sessions", { method: "DELETE", headers: { Origin: "https://other.test" } })).status, 403)
  assert.equal((await keyRequest(oldKey, "/api/account/sessions", "DELETE")).status, 403)
  assert.equal((await first("/api/account/sessions", { method: "DELETE" })).status, 200)
  assert.equal(await validateSessionToken({ id: owner.id }), null, "revocation invalidates pre-upgrade JWT")
  for (const request of [first, second]) {
    assert.equal((await request("/api/emails")).status, 401)
    assert.equal((await (await request("/api/auth/session")).json())?.user, undefined)
  }
  assert.equal((await keyRequest(oldKey, "/api/emails")).status, 200, "session revocation does not disable API keys")
  await login(first)
  await db.update(schema.users).set({ bannedAt: new Date() }).where(eq(schema.users.id, owner.id))
  assert.ok((await (await first("/api/auth/session")).json()).user?.bannedAt, "retain the existing ban notice")
  assert.equal((await first("/api/emails")).status, 403)
  await db.update(schema.users).set({ bannedAt: null }).where(eq(schema.users.id, owner.id))
  assert.equal((await first("/api/emails")).status, 200)
  const page = await first("/profile?tab=keys")
  assert.equal(page.headers.get("x-frame-options"), "SAMEORIGIN")
  assert.equal(page.headers.get("content-security-policy"), "frame-ancestors 'self'")
  assert.equal(page.headers.get("x-content-type-options"), "nosniff")
  console.log(JSON.stringify({ ok: true, driver: postgresUrl ? "postgres" : "sqlite", checks: ["upgrade-preserves-legacy-key-and-jwt", "read-and-mail-scopes", "mailbox-isolation", "config-redaction", "expiry-disable", "deleted-mailbox", "csrf", "two-session-revocation", "relogin", "security-headers"] }))
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
