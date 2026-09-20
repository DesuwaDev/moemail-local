import { randomUUID } from "node:crypto"
import { createDb, getDatabaseDriver, getPostgresPool, getSqlite } from "./db"
import { emails, messages, users } from "./schema"
import { eq, sql } from "drizzle-orm"
import { authorizeRequest } from "./request-auth"
import { ROLES } from "./permissions"
import { apiError } from "./api-response"

export const adminHeaders = { "Cache-Control": "private, no-store" }
export async function authorizeEmperor(request: Request) {
  const auth = await authorizeRequest(request)
  if (!auth.ok) return auth
  if (auth.principal.kind !== "session" || !auth.principal.roles.includes(ROLES.EMPEROR)) {
    return { ok: false as const, response: apiError("EMPEROR_REQUIRED", 403, { headers: adminHeaders }) }
  }
  return auth
}
export const adminJson = (value: unknown) => Response.json(value, { headers: adminHeaders })
export const adminError = (code: Parameters<typeof apiError>[0], status: number) => apiError(code, status, { headers: adminHeaders })
export function pageNumber(value: string | null, fallback = 1, maximum = 10000) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback
}
// Explicit outer qualification is required: Drizzle strips interpolated column
// qualifiers in single-table selects, otherwise inner message.id is compared.
export const mailboxCounts = {
  messageCount: sql<number>`(SELECT COUNT(*) FROM message AS counted WHERE counted."emailId" = "email"."id")`.mapWith(Number),
  receivedCount: sql<number>`(SELECT COUNT(*) FROM message AS counted WHERE counted."emailId" = "email"."id" AND COALESCE(counted.type, 'received') <> 'sent')`.mapWith(Number),
  sentCount: sql<number>`(SELECT COUNT(*) FROM message AS counted WHERE counted."emailId" = "email"."id" AND counted.type = 'sent')`.mapWith(Number),
}
export async function adminMailbox(id: string) {
  const rows = await createDb().select({
    id: emails.id, address: emails.address, userId: emails.userId,
    owner: sql<string | null>`COALESCE(${users.name}, ${users.username}, ${users.email})`,
    createdAt: emails.createdAt, expiresAt: emails.expiresAt, disabledAt: emails.disabledAt,
    receiveEnabled: emails.receiveEnabled, sendEnabled: emails.sendEnabled, shareEnabled: emails.shareEnabled,
    ...mailboxCounts,
  }).from(emails).leftJoin(users, eq(users.id, emails.userId)).where(eq(emails.id, id)).limit(1)
  return rows[0] ?? null
}

// Commit mutations and their audit entry together. Never log mail bodies or secrets.
type Audit = { actorId: string; userId: string | null; mailboxId?: string | null; action: string; target: string }
type Statement = { text: string; values?: Array<string | number | boolean | Date | null> }
export async function adminChange(audit: Audit, statements: Statement[] = [], protectUser = false) {
  const log: Statement = { text: 'INSERT INTO admin_audit_log (id, actor_id, user_id, mailbox_id, action, target, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    values: [randomUUID(), audit.actorId, audit.userId, audit.mailboxId ?? null, audit.action, audit.target, new Date()] }
  const guard = 'SELECT id FROM "user" WHERE id = ?'
  const emperor = 'SELECT 1 FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.name = ?'
  if (getDatabaseDriver() === "sqlite") {
    return getSqlite().transaction(() => {
      if (protectUser) {
        if (!getSqlite().prepare(guard).get(audit.userId)) return "not_found" as const
        if (audit.userId === audit.actorId || getSqlite().prepare(emperor).get(audit.userId, ROLES.EMPEROR)) return "protected" as const
      }
      for (const statement of [...statements, log]) {
        getSqlite().prepare(statement.text).run(...(statement.values ?? []).map(value => value instanceof Date ? value.getTime() : typeof value === "boolean" ? Number(value) : value))
      }
      return "ok" as const
    }).immediate()
  }
  const client = await getPostgresPool().connect()
  const execute = (statement: Statement) => {
    let index = 0
    return client.query(statement.text.replace(/\?/g, () => "$" + ++index), statement.values ?? [])
  }
  try {
    await client.query("BEGIN")
    if (protectUser) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('moemail:init-emperor'))")
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["moemail:user-role:" + audit.userId])
      const target = await execute({ text: guard + " FOR UPDATE", values: [audit.userId] })
      if (!target.rowCount) { await client.query("ROLLBACK"); return "not_found" as const }
      if (audit.userId === audit.actorId || (await execute({ text: emperor, values: [audit.userId, ROLES.EMPEROR] })).rowCount) {
        await client.query("ROLLBACK"); return "protected" as const
      }
    }
    for (const statement of [...statements, log]) await execute(statement)
    await client.query("COMMIT")
    return "ok" as const
  } catch (error) { await client.query("ROLLBACK"); throw error }
  finally { client.release() }
}
export function reconcileMailboxes() {
  void import("./mailu/reconcile").then(m => m.reconcileCurrentMailuIfEnabled()).catch(error => console.error("admin.mailu_reconcile_failed", { name: error instanceof Error ? error.name : "UnknownError" }))
}
export const messageFields = { id: messages.id, subject: messages.subject, fromAddress: messages.fromAddress, toAddress: messages.toAddress, type: messages.type, receivedAt: messages.receivedAt, sentAt: messages.sentAt }
