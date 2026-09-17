import { NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/request-auth"
import { revokeUserSessions } from "@/lib/session-security"
import { apiError } from "@/lib/api-response"

export const runtime = "nodejs"

export async function DELETE(request: Request) {
  const authorization = await authorizeRequest(request)
  if (!authorization.ok) return authorization.response
  try {
    await revokeUserSessions(authorization.principal.userId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("session.revoke_failed", { name: error instanceof Error ? error.name : "UnknownError" })
    return apiError("SESSION_REVOKE_FAILED", 500)
  }
}
