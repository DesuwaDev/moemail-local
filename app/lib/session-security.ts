import { createHmac, randomUUID } from "node:crypto"
import type { JWT } from "next-auth/jwt"
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm"
import { createDb, getDatabaseDriver, getPostgresPool, getSqlite } from "./db"
import { loginSessions, users } from "./schema"
import { getConfig } from "./config/runtime"
import { getAuthClientAddress } from "./auth-abuse-guard"

export const SESSION_MAX_AGE = 30 * 86400
const TOUCH_INTERVAL = 60_000
const ACTIVE_GAP = 90_000
const SESSION_ID = /^[a-f0-9-]{36,64}$/
type SessionContext = { headers?: Headers; provider?: string }

function metadata(headers?: Headers) {
  const server = getConfig().server
  const address = headers ? getAuthClientAddress(headers, server.trustProxyHeaders, server) : "unknown-client"
  return {
    userAgent: (headers?.get("user-agent") ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 1024),
    ip: ["unknown-client", "untrusted-proxy-headers"].includes(address) ? null : address,
  }
}

function sessionId(token: JWT) {
  if (typeof token.loginSessionId === "string" && SESSION_ID.test(token.loginSessionId)) return token.loginSessionId
  // Auth.js rotates jti on cookie renewal. Store this derived ID in the renewed
  // JWT so old cookies and their replacement still refer to the same record.
  if (typeof token.jti !== "string" || typeof token.id !== "string") return null
  return createHmac("sha256", getConfig().auth.secret!).update("legacy-session\0" + token.id + "\0" + token.jti).digest("hex")
}

export async function validateSessionToken(token: JWT, signingIn = false, context: SessionContext = {}): Promise<JWT | null> {
  if (typeof token.id !== "string") return null
  const db = createDb()
  const user = await db.query.users.findFirst({
    where: eq(users.id, token.id),
    columns: { sessionVersion: true, bannedAt: true, allowRemoteResources: true },
  })
  if (!user || (signingIn && user.bannedAt)) return null
  if (signingIn) token.sessionVersion = user.sessionVersion
  if ((token.sessionVersion ?? 0) !== user.sessionVersion) return null

  const now = new Date(), info = metadata(context.headers)
  const id = signingIn ? randomUUID() : sessionId(token)
  if (!id) return null
  // Cookie renewal may occur between throttled writes; retain the row through
  // that interval and Auth.js clock tolerance.
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE * 1000 + TOUCH_INTERVAL + 30_000)
  if (signingIn || token.loginSessionId === undefined) {
    // Never recreate a revoked legacy session. Its tombstone survives at least
    // until every cookie which could reference it has expired.
    await db.insert(loginSessions).values({
      id, userId: token.id, sessionVersion: user.sessionVersion,
      provider: context.provider?.slice(0, 64) || "legacy", userAgent: info.userAgent,
      firstIp: info.ip, lastIp: info.ip, loginAt: signingIn ? now : null,
      createdAt: now, lastSeenAt: now, expiresAt,
    }).onConflictDoNothing()
  }
  const record = await db.query.loginSessions.findFirst({ where: and(eq(loginSessions.id, id), eq(loginSessions.userId, token.id)) })
  if (!record || record.revokedAt || record.sessionVersion !== user.sessionVersion || record.expiresAt <= now) return null
  if (now.getTime() - record.lastSeenAt.getTime() >= TOUCH_INTERVAL) {
    await db.update(loginSessions).set({ lastSeenAt: now, expiresAt, ...(context.headers ? { lastIp: info.ip, userAgent: info.userAgent } : {}) })
      .where(and(eq(loginSessions.id, id), isNull(loginSessions.revokedAt), lt(loginSessions.lastSeenAt, new Date(now.getTime() - TOUCH_INTERVAL + 1))))
  }
  token.loginSessionId = id
  token.bannedAt = user.bannedAt?.toISOString() ?? null
  token.allowRemoteResources = !user.bannedAt && user.allowRemoteResources
  return token
}

export async function endSessionToken(token: JWT | null) {
  if (!token || typeof token.id !== "string") return
  const id = sessionId(token)
  if (id) await createDb().update(loginSessions).set({ revokedAt: new Date() })
    .where(and(eq(loginSessions.id, id), eq(loginSessions.userId, token.id), isNull(loginSessions.revokedAt)))
}

export async function revokeUserSessions(userId: string) {
  // The version is also checked on every row, including legacy JWT migration.
  await createDb().update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId))
}

export async function listUserSessions(userId: string, currentId: string | undefined, requestedPage: number) {
  const db = createDb(), pageSize = 5, now = new Date()
  const active = and(eq(loginSessions.userId, userId), isNull(loginSessions.revokedAt), gt(loginSessions.expiresAt, now), eq(loginSessions.sessionVersion, users.sessionVersion))
  const [{ total }] = await db.select({ total: sql<number>`COUNT(*)`.mapWith(Number) }).from(loginSessions)
    .innerJoin(users, eq(users.id, loginSessions.userId)).where(active)
  const pages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(requestedPage, pages)
  const rows = await db.select({
    id: loginSessions.id, provider: loginSessions.provider, userAgent: loginSessions.userAgent,
    firstIp: loginSessions.firstIp, lastIp: loginSessions.lastIp, loginAt: loginSessions.loginAt,
    createdAt: loginSessions.createdAt, lastSeenAt: loginSessions.lastSeenAt,
    lastActiveAt: loginSessions.lastActiveAt, activeSeconds: loginSessions.activeSeconds,
  }).from(loginSessions).innerJoin(users, eq(users.id, loginSessions.userId)).where(active)
    .orderBy(desc(sql`CASE WHEN ${loginSessions.id} = ${currentId ?? ""} THEN 1 ELSE 0 END`), desc(loginSessions.lastSeenAt), desc(loginSessions.id))
    .limit(pageSize).offset((page - 1) * pageSize)
  return { items: rows.map(row => ({ ...row, current: row.id === currentId, online: Boolean(row.lastActiveAt && now.getTime() - row.lastActiveAt.getTime() <= ACTIVE_GAP) })), total, page, pages }
}

export async function heartbeatSession(userId: string, id: string) {
  const now = new Date(), cutoff = new Date(now.getTime() - ACTIVE_GAP), throttle = new Date(now.getTime() - 15_000)
  // Compute the interval in the UPDATE, never from a previously-read snapshot:
  // simultaneous browser tabs cannot multiply a session's online duration.
  if (getDatabaseDriver() === "sqlite") {
    getSqlite().prepare(`UPDATE login_session SET
      active_seconds = active_seconds + CASE WHEN last_active_at BETWEEN ? AND ? THEN CAST((? - last_active_at) / 1000 AS INTEGER) ELSE 0 END,
      last_active_at = ?
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
        AND session_version = (SELECT session_version FROM user WHERE id = ?)
        AND (last_active_at IS NULL OR last_active_at <= ?)`)
      .run(cutoff.getTime(), now.getTime(), now.getTime(), now.getTime(), id, userId, now.getTime(), userId, throttle.getTime())
  } else {
    await getPostgresPool().query(`UPDATE login_session SET
      active_seconds = active_seconds + CASE WHEN last_active_at BETWEEN $1 AND $2 THEN FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - last_active_at)))::integer ELSE 0 END,
      last_active_at = $2
      WHERE id = $3 AND user_id = $4 AND revoked_at IS NULL AND expires_at > $2
        AND session_version = (SELECT session_version FROM "user" WHERE id = $4)
        AND (last_active_at IS NULL OR last_active_at <= $5)`, [cutoff, now, id, userId, throttle])
  }
}
