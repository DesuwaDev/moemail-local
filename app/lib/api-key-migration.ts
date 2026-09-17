import type Database from "better-sqlite3"
import type { PoolClient } from "pg"
import { digestApiKey } from "./api-key-digest"

const batchSize = 500
type LegacyKey = { id: string; key: string }

// Reuse the unique key column with a versioned representation. No plaintext
// fallback is accepted by authentication, including after a backup restore.
export function migrateSqliteApiKeyDigests(sqlite: Database.Database) {
  return sqlite.transaction(() => {
    const select = sqlite.prepare("SELECT id, key FROM api_keys WHERE key NOT LIKE 'sha256:%' LIMIT ?")
    const update = sqlite.prepare("UPDATE api_keys SET key = ? WHERE id = ? AND key = ?")
    let migrated = 0
    while (true) {
      const rows = select.all(batchSize) as LegacyKey[]
      if (!rows.length) return migrated
      for (const row of rows) migrated += update.run(digestApiKey(row.key), row.id, row.key).changes
    }
  }).immediate()
}

export async function migratePostgresApiKeyDigests(client: PoolClient) {
  await client.query("BEGIN")
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('moemail:api-key-digests'))")
    let migrated = 0
    while (true) {
      const { rows } = await client.query<LegacyKey>(
        "SELECT id, key FROM api_keys WHERE key NOT LIKE 'sha256:%' LIMIT $1 FOR UPDATE",
        [batchSize],
      )
      if (!rows.length) break
      for (const row of rows) {
        const result = await client.query(
          "UPDATE api_keys SET key = $1 WHERE id = $2 AND key = $3",
          [digestApiKey(row.key), row.id, row.key],
        )
        migrated += result.rowCount ?? 0
      }
    }
    await client.query("COMMIT")
    return migrated
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  }
}
