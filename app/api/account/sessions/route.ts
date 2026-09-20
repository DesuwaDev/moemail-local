import { z } from "zod"
import { authorizeRequest } from "@/lib/request-auth"
import { manageSessions } from "@/lib/session-management"
import { heartbeatSession } from "@/lib/session-security"
import { adminError, adminJson } from "@/lib/admin-management"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await authorizeRequest(request)
  if (!auth.ok) return auth.response
  return manageSessions(request, auth.principal.userId, auth.principal.userId, auth.principal.sessionId)
}
export async function DELETE(request: Request) {
  const auth = await authorizeRequest(request)
  if (!auth.ok) return auth.response
  return manageSessions(request, auth.principal.userId, auth.principal.userId, auth.principal.sessionId)
}
export async function POST(request: Request) {
  const auth = await authorizeRequest(request)
  if (!auth.ok) return auth.response
  if (!auth.principal.sessionId) return adminError("UNAUTHORIZED", 401)
  const payload = z.object({ active: z.boolean() }).strict().safeParse(await request.json().catch(() => null))
  if (!payload.success) return adminError("INVALID_REQUEST", 400)
  try {
    if (payload.data.active) await heartbeatSession(auth.principal.userId, auth.principal.sessionId)
    return adminJson({ success: true })
  } catch { return adminError("SESSIONS_READ_FAILED", 500) }
}
