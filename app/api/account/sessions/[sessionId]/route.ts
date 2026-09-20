import { authorizeRequest } from "@/lib/request-auth"
import { manageSessions } from "@/lib/session-management"
export const runtime = "nodejs"
export async function DELETE(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await authorizeRequest(request)
  if (!auth.ok) return auth.response
  return manageSessions(request, auth.principal.userId, auth.principal.userId, auth.principal.sessionId, (await params).sessionId)
}
