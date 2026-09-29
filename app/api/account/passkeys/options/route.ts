import { adminJson } from "@/lib/admin-management"
import { authorizeAccountSession, passkeyFailure } from "@/lib/passkey-management"
import { createRegistrationOptions, requireRecentAuthentication } from "@/lib/passkeys"

export const runtime = "nodejs"

/** Adding a passkey grants lasting access, so the session must be recently verified. */
export async function POST(request: Request) {
  const auth = await authorizeAccountSession(request)
  if (!auth.ok) return auth.response
  try {
    await requireRecentAuthentication(auth.userId, auth.sessionId)
    return adminJson(await createRegistrationOptions(auth.userId, auth.sessionId))
  } catch (error) {
    return passkeyFailure(error, "PASSKEY_SAVE_FAILED")
  }
}
