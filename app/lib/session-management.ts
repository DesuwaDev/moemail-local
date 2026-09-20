import { and, eq, isNull } from "drizzle-orm"
import { createDb } from "./db"
import { loginSessions, users } from "./schema"
import { adminChange, adminError, adminJson, pageNumber } from "./admin-management"
import { listUserSessions } from "./session-security"

/** Call only after authenticating the owner or an Emperor session. */
export async function manageSessions(request: Request, userId: string, actorId: string, currentId?: string, selectedId?: string) {
  try {
    const user = await createDb().query.users.findFirst({ where: eq(users.id, userId), columns: { id: true } })
    if (!user) return adminError("USER_NOT_FOUND", 404)
    if (request.method === "GET") {
      const query = new URL(request.url).searchParams
      const page = await listUserSessions(userId, currentId, pageNumber(query.get("page")))
      if (query.get("locations") !== "1") return adminJson(page)
      const { lookupIpLocation } = await import("./ip-location")
      const ips = [...new Set(page.items.flatMap(item => [item.firstIp, item.lastIp]).filter((ip): ip is string => Boolean(ip)))]
      return adminJson({ locations: Object.fromEntries(await Promise.all(ips.map(async ip => [ip, await lookupIpLocation(ip)]))) })
    }

    const mode = selectedId ? "single" : new URL(request.url).searchParams.get("mode") ?? "all"
    if (!["single", "all", "others"].includes(mode) || (mode === "others" && (!currentId || userId !== actorId))) return adminError("INVALID_REQUEST", 400)
    if (selectedId) {
      const target = await createDb().query.loginSessions.findFirst({ where: and(eq(loginSessions.id, selectedId), eq(loginSessions.userId, userId), isNull(loginSessions.revokedAt)), columns: { id: true } })
      if (!target) return adminError("SESSION_NOT_FOUND", 404)
    }
    const where = 'user_id = ? AND revoked_at IS NULL' + (selectedId ? ' AND id = ?' : mode === "others" ? ' AND id <> ?' : '')
    const values = [new Date(), userId, ...(selectedId ? [selectedId] : mode === "others" ? [currentId!] : [])]
    await adminChange({ actorId, userId, action: "session.revoke", target: selectedId ?? mode }, [
      ...(mode === "all" ? [{ text: 'UPDATE "user" SET session_version = session_version + 1 WHERE id = ?', values: [userId] }] : []),
      { text: 'UPDATE login_session SET revoked_at = ? WHERE ' + where, values },
    ])
    return adminJson({ success: true, currentRevoked: userId === actorId && (mode === "all" || selectedId === currentId) })
  } catch (error) {
    console.error("session.management_failed", { name: error instanceof Error ? error.name : "UnknownError" })
    return adminError(request.method === "GET" ? "SESSIONS_READ_FAILED" : "SESSION_REVOKE_FAILED", 500)
  }
}
