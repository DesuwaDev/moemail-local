import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import Database from "better-sqlite3"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres"
import { migrate as migratePostgres } from "drizzle-orm/node-postgres/migrator"
import { digestApiKey, storedApiKeyDigest } from "../../app/lib/api-key-digest"
import { migratePostgresApiKeyDigests, migrateSqliteApiKeyDigests } from "../../app/lib/api-key-migration"
import { createDefaultConfig } from "../../app/lib/config/schema"
import { stringifyConfig } from "../../app/lib/config/file"

const keys = Array.from({ length: 501 }, (_, index) => ({ id: String(index), key: `mk_test_legacy_${index}` }))
const hashed = digestApiKey("already-migrated")
assert.equal(storedApiKeyDigest(hashed), hashed)
assert.notEqual(digestApiKey(hashed), hashed, "a digest supplied as a credential must be hashed again")
assert.equal(storedApiKeyDigest("mk_legacy"), digestApiKey("mk_legacy"))

const sqlite = new Database(":memory:")
try {
  sqlite.exec("CREATE TABLE api_keys (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE)")
  const insert = sqlite.prepare("INSERT INTO api_keys (id, key) VALUES (?, ?)")
  for (const { id, key } of keys) insert.run(id, key)
  insert.run("existing", hashed)
  assert.equal(migrateSqliteApiKeyDigests(sqlite), keys.length)
  assert.equal(migrateSqliteApiKeyDigests(sqlite), 0)
  for (const { id, key } of keys) assert.equal((sqlite.prepare("SELECT key FROM api_keys WHERE id = ?").get(id) as { key: string }).key, digestApiKey(key))
  assert.equal((sqlite.prepare("SELECT key FROM api_keys WHERE id = 'existing'").get() as { key: string }).key, hashed)
  insert.run("collision", "already-migrated")
  insert.run("rollback", "must-remain-unmodified")
  assert.throws(() => migrateSqliteApiKeyDigests(sqlite))
  assert.equal((sqlite.prepare("SELECT key FROM api_keys WHERE id = 'rollback'").get() as { key: string }).key, "must-remain-unmodified")
} finally {
  sqlite.close()
}
console.log("api-key.sqlite: batch migration, idempotence and rollback passed")

// Exercise the actual D1 import CLIs, including an already migrated input.
const artifactRoot = resolve("docs/security-review-artifacts")
mkdirSync(artifactRoot, { recursive: true })
const importWorkspace = mkdtempSync(join(artifactRoot, "run-import-"))
mkdirSync(join(importWorkspace, "data"))
const sourcePath = join(importWorkspace, "source.db")
const source = new Database(sourcePath)
migrate(drizzle(source), { migrationsFolder: resolve("drizzle-local") })
source.prepare("INSERT INTO user (id, username) VALUES ('import-user', 'import-user')").run()
source.prepare("INSERT INTO role (id, name) VALUES ('import-owner-role', 'emperor')").run()
source.prepare("INSERT INTO user_role (user_id, role_id) VALUES ('import-user', 'import-owner-role')").run()
source.prepare("INSERT INTO api_keys (id, user_id, name, key, expires_at) VALUES (?, 'import-user', ?, ?, ?)")
  .run("raw", "raw", "mk_import-legacy", Math.floor(Date.now() / 1000) + 3600)
source.prepare("INSERT INTO api_keys (id, user_id, name, key, expires_at) VALUES (?, 'import-user', ?, ?, ?)")
  .run("digest", "digest", hashed, Math.floor(Date.now() / 1000) + 3600)
source.close()
// Runtime migration folders are resolved from the disposable command cwd.
for (const folder of ["drizzle-local", "drizzle-postgres"]) cpSync(resolve(folder), join(importWorkspace, folder), { recursive: true })
const config = createDefaultConfig()
config.database.sqlite.path = "data/import.db"
config.setup.completed = true
config.auth.secret = randomBytes(32).toString("hex")
config.auth.passwordPepper = randomBytes(32).toString("hex")
config.email.ingestSecret = randomBytes(32).toString("hex")
cpSync(sourcePath, join(importWorkspace, "data/import.db"))
writeFileSync(join(importWorkspace, "data/config.yaml"), stringifyConfig(config))
const tsxCli = resolve("node_modules/tsx/dist/cli.mjs")
execFileSync(process.execPath, [tsxCli, resolve("scripts/sqlite/import-d1.ts"), sourcePath, "--force"], { cwd: importWorkspace, stdio: "pipe", windowsHide: true })
const importedSqlite = new Database(join(importWorkspace, "data/import.db"), { readonly: true })
try {
  assert.equal((importedSqlite.prepare("SELECT key FROM api_keys WHERE id = 'raw'").get() as { key: string }).key, digestApiKey("mk_import-legacy"))
  assert.equal((importedSqlite.prepare("SELECT key FROM api_keys WHERE id = 'digest'").get() as { key: string }).key, hashed)
} finally {
  importedSqlite.close()
}
console.log("api-key.sqlite: D1 import stores digests and preserves existing digests")

if (process.argv.includes("--postgres")) {
  const cluster = mkdtempSync(join(artifactRoot, "run-postgres-"))
  const listener = createServer()
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve))
  const address = listener.address()
  assert.ok(address && typeof address === "object")
  const port = address.port
  await new Promise<void>(resolve => listener.close(() => resolve()))
  let started = false
  let pool: Pool | undefined
  try {
    execFileSync("initdb", ["--pgdata", cluster, "--username", "postgres", "--auth", "trust", "--encoding", "UTF8", "--no-locale"], { stdio: "pipe", windowsHide: true })
    execFileSync("pg_ctl", ["--pgdata", cluster, "--options", `-h 127.0.0.1 -p ${port}`, "--log", join(cluster, "postgres.log"), "--wait", "start"], { stdio: "ignore", windowsHide: true })
    started = true
    pool = new Pool({ host: "127.0.0.1", port, user: "postgres", database: "postgres", password: () => "", ssl: false })
    await pool.query("CREATE TABLE api_keys (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE)")
    await pool.query("INSERT INTO api_keys SELECT * FROM unnest($1::text[], $2::text[])", [keys.map(key => key.id), keys.map(key => key.key)])
    await pool.query("INSERT INTO api_keys VALUES ('existing', $1)", [hashed])
    const first = await pool.connect()
    const second = await pool.connect()
    try {
      const counts = await Promise.all([migratePostgresApiKeyDigests(first), migratePostgresApiKeyDigests(second)])
      assert.equal(counts.reduce((sum, count) => sum + count, 0), keys.length)
      assert.equal(await migratePostgresApiKeyDigests(first), 0)
      const migrated = new Map((await pool.query<{ id: string; key: string }>("SELECT id, key FROM api_keys")).rows.map(row => [row.id, row.key]))
      for (const { id, key } of keys) assert.equal(migrated.get(id), digestApiKey(key))
      assert.equal(migrated.get("existing"), hashed)
      await pool.query("INSERT INTO api_keys VALUES ('rollback', 'must-remain-unmodified'), ('collision', 'already-migrated')")
      await assert.rejects(migratePostgresApiKeyDigests(first))
      assert.equal((await pool.query("SELECT key FROM api_keys WHERE id = 'rollback'")).rows[0].key, "must-remain-unmodified")
    } finally {
      first.release()
      second.release()
    }
    console.log("api-key.postgres: concurrent batch migration, idempotence and rollback passed")
    await pool.query("CREATE DATABASE import_probe")
    config.database.driver = "postgres"
    config.database.postgres.url = `postgresql://postgres@127.0.0.1:${port}/import_probe`
    writeFileSync(join(importWorkspace, "data/config.yaml"), stringifyConfig(config))
    const importedPool = new Pool({ host: "127.0.0.1", port, user: "postgres", database: "import_probe", password: () => "", ssl: false })
    try {
      await migratePostgres(drizzlePostgres(importedPool), { migrationsFolder: resolve("drizzle-postgres") })
      await importedPool.query('INSERT INTO "user" (id, username) VALUES ($1, $1)', ["import-user"])
      await importedPool.query("INSERT INTO role (id, name) VALUES ('import-owner-role', 'emperor')")
      await importedPool.query("INSERT INTO user_role (user_id, role_id) VALUES ('import-user', 'import-owner-role')")
      execFileSync(process.execPath, [tsxCli, resolve("scripts/postgres/import-d1.ts"), sourcePath, "--force"], { cwd: importWorkspace, stdio: "pipe", windowsHide: true })
      const imported = new Map((await importedPool.query<{ id: string; key: string }>("SELECT id, key FROM api_keys")).rows.map(row => [row.id, row.key]))
      assert.equal(imported.get("raw"), digestApiKey("mk_import-legacy"))
      assert.equal(imported.get("digest"), hashed)
    } finally {
      await importedPool.end()
    }
    console.log("api-key.postgres: D1 import stores digests and preserves existing digests")
  } finally {
    await pool?.end()
    if (started) execFileSync("pg_ctl", ["--pgdata", cluster, "--wait", "stop", "--mode", "fast"], { stdio: "ignore", windowsHide: true })
  }
}
