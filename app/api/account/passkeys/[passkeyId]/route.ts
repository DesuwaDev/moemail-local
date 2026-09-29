import { z } from "zod"
import { adminError, adminJson } from "@/lib/admin-management"
import { authorizeAccountSession, passkeyFailure, removePasskey } from "@/lib/passkey-management"
import { renamePasskey, requireRecentAuthentication } from "@/lib/passkeys"

export const runtime = "nodejs"
type Context = { params: Promise<{ passkeyId: string }> }

export async function PATCH(request: Request, { params }: Context) {
  const auth = await authorizeAccountSession(request)
  if (!auth.ok) return auth.response
  const payload = z.object({ name: z.string().max(256) }).strict().safeParse(await request.json().catch(() => null))
  if (!payload.success) return adminError("PASSKEY_NAME_INVALID", 400)
  try {
    return adminJson({ name: await renamePasskey(auth.userId, (await params).passkeyId, payload.data.name) })
  } catch (error) {
    return passkeyFailure(error, "PASSKEY_SAVE_FAILED")
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const auth = await authorizeAccountSession(request)
  if (!auth.ok) return auth.response
  try {
    await requireRecentAuthentication(auth.userId, auth.sessionId)
    await removePasskey(auth.userId, auth.userId, (await params).passkeyId)
    return adminJson({ success: true })
  } catch (error) {
    return passkeyFailure(error, "PASSKEY_DELETE_FAILED")
  }
}
