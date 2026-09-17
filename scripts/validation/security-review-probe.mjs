import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import Database from "better-sqlite3"

// Isolated source snapshot and disposable database; never opens project data/.
const root = process.cwd()
const fixed = !process.argv.includes("--baseline")
mkdirSync(resolve(root, "docs/security-review-artifacts"), { recursive: true })
// Keep the snapshot on the dependency volume for Next.js on Windows.
const workspace = mkdtempSync(resolve(root, "docs/security-review-artifacts/run-"))
for (const directory of ["app", "drizzle-local", "drizzle-postgres"]) {
  cpSync(resolve(root, directory), join(workspace, directory), { recursive: true })
}
symlinkSync(resolve(root, "node_modules"), join(workspace, "node_modules"), "junction")
for (const file of ["package.json", "tsconfig.json", "next-env.d.ts"]) {
  cpSync(resolve(root, file), join(workspace, file))
}
// API-only run: excludes asset/PWA generation and background mail pollers.
writeFileSync(join(workspace, "next.config.mjs"), 'export default { serverExternalPackages: ["better-sqlite3", "pg"] }\n')
writeFileSync(join(workspace, "instrumentation.ts"), `export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { awaitInitialConfigReady } = await import("./app/lib/config/runtime")
    await awaitInitialConfigReady()
  }
}\n`)
const listener = createServer()
await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve))
const port = listener.address().port
await new Promise(resolve => listener.close(resolve))
const baseUrl = `http://127.0.0.1:${port}`
let logs = ""
function launch() {
  const child = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: workspace,
    env: { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  child.stdout.on("data", chunk => { logs += chunk })
  child.stderr.on("data", chunk => { logs += chunk })
  return child
}
let child = launch()
async function stop() {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once("exit", resolve))
  child.kill()
  await exited
}
const cookies = new Map()
async function request(path, init = {}, authenticated = true) {
  const headers = new Headers(init.headers)
  if (authenticated && cookies.size) headers.set("Cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "))
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(120_000) })
  if (authenticated) for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0]
    const index = pair.indexOf("=")
    cookies.set(pair.slice(0, index), pair.slice(index + 1))
  }
  return response
}
async function ready() {
  const deadline = Date.now() + 120_000
  while (true) {
    try {
      const health = await request("/api/internal/health")
      if (health.ok) break
    } catch {}
    if (Date.now() > deadline || child.exitCode !== null) throw new Error("SERVER_START_FAILED")
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}
const findings = []
try {
  await ready()
  // Requesting setup initializes its one-time token in this disposable workspace.
  await request("/api/setup")
  const token = readFileSync(join(workspace, "data/setup-token"), "utf8").trim()
  const setup = await request("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MoeMail-Setup-Token": token },
    body: JSON.stringify({
      config: { server: { baseUrl }, database: { driver: "sqlite", sqlite: { path: "data/audit.db" } } },
      admin: { username: "audit-admin", password: "audit-password-12345678" },
    }),
  })
  assert.equal(setup.status, 200, await setup.text())
  const csrf = await (await request("/api/auth/csrf")).json()
  const login = await request("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, username: "audit-admin", password: "audit-password-12345678", callbackUrl: baseUrl }),
  })
  assert.ok([302, 303].includes(login.status))
  const session = await (await request("/api/auth/session")).json()
  assert.ok(session.user.roles.some(role => role.name === "emperor"))
  const registered = await request("/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "audit-member", password: "audit-password-12345678" }),
  }, false)
  assert.equal(registered.status, 201)
  const member = (await registered.json()).user
  const forged = {
    method: "POST",
    headers: { "Content-Type": "text/plain", Origin: "http://127.0.0.1:1", "Sec-Fetch-Site": "same-site" },
    body: JSON.stringify({ userId: member.id, roleName: "duke" }),
  }
  assert.equal((await request("/api/roles/promote", forged, false)).status, 401)
  const promoted = await request("/api/roles/promote", forged)
  assert.equal(promoted.status, fixed ? 403 : 200, await promoted.text())
  const db = new Database(join(workspace, "data/audit.db"))
  if (fixed) {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM user_role WHERE user_id = ?").get(member.id).count, 0)
    for (const site of ["same-site", "cross-site"]) {
      const rejected = await request("/api/roles/promote", {
        ...forged,
        headers: { ...forged.headers, "Content-Type": "application/json", "Sec-Fetch-Site": site },
      })
      assert.equal(rejected.status, 403)
      assert.equal((await rejected.json()).code, "CROSS_ORIGIN_FORBIDDEN")
    }
    const sameOrigin = { ...forged.headers, Origin: baseUrl, "Sec-Fetch-Site": "same-origin" }
    assert.equal((await request("/api/roles/promote", { ...forged, headers: sameOrigin })).status, 415)
    assert.equal((await request("/api/roles/promote", { ...forged, headers: { ...sameOrigin, "Content-Type": "application/json" } })).status, 200)
  }
  assert.equal(db.prepare("SELECT role.name FROM user_role JOIN role ON role.id = user_role.role_id WHERE user_role.user_id = ?").get(member.id).name, "duke")
  findings.push({ check: "cross-origin-role-mutation", crossOriginStatus: promoted.status, legitimatePromotion: "duke", unauthenticatedControl: 401, fixed })
  const created = await request("/api/api-keys", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "audit-key" }),
  })
  assert.equal(created.status, 200)
  const key = (await created.json()).key
  const stored = db.prepare("SELECT key FROM api_keys WHERE name = ?").get("audit-key").key
  if (fixed) assert.equal(stored, `sha256:${createHash("sha256").update(key).digest("hex")}`)
  else assert.equal(stored, key)
  const replay = await request("/api/config", { headers: { "X-API-Key": stored } }, false)
  assert.equal(replay.status, fixed ? 401 : 200)
  assert.equal((await request("/api/config", { headers: { "X-API-Key": key } }, false)).status, 200)
  if (fixed) {
    // API credentials are explicit authentication, and must keep working for CLI clients.
    const keyMutation = await request("/api/config", {
      method: "POST",
      headers: { "X-API-Key": key, Origin: "https://client.example", "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" },
      body: JSON.stringify({ defaultRole: "civilian", adminContact: "" }),
    }, false)
    assert.equal(keyMutation.status, 200)
    // Simulate an old database or restored backup, then exercise cold-start migration.
    const legacy = `mk_${randomBytes(24).toString("base64url")}`
    db.prepare("INSERT INTO api_keys (id, user_id, name, key, created_at, expires_at, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)")
      .run(randomUUID(), session.user.id, "legacy-key", legacy, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 3600)
    await stop()
    child = launch()
    await ready()
    assert.equal((await request("/api/config", { headers: { "X-API-Key": legacy } }, false)).status, 200)
    const migrated = db.prepare("SELECT key FROM api_keys WHERE name = ?").get("legacy-key").key
    assert.equal(migrated, `sha256:${createHash("sha256").update(legacy).digest("hex")}`)
    assert.equal((await request("/api/config", { headers: { "X-API-Key": migrated } }, false)).status, 401)
    assert.equal(db.prepare("SELECT key FROM api_keys WHERE name = ?").get("audit-key").key, stored)
    assert.equal((await request("/api/config", { headers: { "X-API-Key": key } }, false)).status, 200)
    db.prepare("UPDATE api_keys SET enabled = 0 WHERE name = ?").run("audit-key")
    assert.equal((await request("/api/config", { headers: { "X-API-Key": key } }, false)).status, 401)
    db.prepare("UPDATE api_keys SET expires_at = 1 WHERE name = ?").run("legacy-key")
    assert.equal((await request("/api/config", { headers: { "X-API-Key": legacy } }, false)).status, 401)
  }
  findings.push({ check: "api-key-storage", databaseValueEqualsIssuedCredential: stored === key, databaseValueReplayStatus: replay.status, fixed, coldStartMigration: fixed, originalCredentialWorks: true, disabledAndExpiredRejected: fixed })
  db.close()
  writeFileSync(resolve(root, `docs/security-review-artifacts/${fixed ? "regression-results" : "results"}.json`), JSON.stringify(findings, null, 2))
  console.log(JSON.stringify({ workspace, findings }, null, 2))
} finally {
  await stop()
  writeFileSync(join(workspace, "server.log"), logs)
}
