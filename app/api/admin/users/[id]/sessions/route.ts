import { authorizeEmperor } from "@/lib/admin-management"
import { manageSessions } from "@/lib/session-management"
export const runtime = "nodejs"
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, { params }: Context) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  return manageSessions(request, (await params).id, auth.principal.userId, auth.principal.sessionId)
}
export async function DELETE(request: Request, { params }: Context) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  return manageSessions(request, (await params).id, auth.principal.userId, auth.principal.sessionId)
}
