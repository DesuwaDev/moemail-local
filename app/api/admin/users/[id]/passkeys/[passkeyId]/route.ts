import { adminJson, authorizeEmperor } from "@/lib/admin-management"
import { passkeyFailure, removePasskey } from "@/lib/passkey-management"

export const runtime = "nodejs"

/** Emperors can remove a lost or compromised passkey; the change is audited. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; passkeyId: string }> }) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  const { id, passkeyId } = await params
  try {
    await removePasskey(auth.principal.userId, id, passkeyId)
    return adminJson({ success: true })
  } catch (error) {
    return passkeyFailure(error, "PASSKEY_DELETE_FAILED")
  }
}
