import { authorizeEmperor } from "@/lib/admin-management"
import { manageSessions } from "@/lib/session-management"
export const runtime = "nodejs"
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  const { id, sessionId } = await params
  return manageSessions(request, id, auth.principal.userId, auth.principal.sessionId, sessionId)
}
