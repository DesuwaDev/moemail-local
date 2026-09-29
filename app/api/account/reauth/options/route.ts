import { adminJson } from "@/lib/admin-management"
import { authorizeAccountSession, passkeyFailure } from "@/lib/passkey-management"
import { createVerificationOptions } from "@/lib/passkeys"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = await authorizeAccountSession(request)
  if (!auth.ok) return auth.response
  try {
    return adminJson(await createVerificationOptions(auth.userId, auth.sessionId))
  } catch (error) {
    return passkeyFailure(error, "REAUTH_FAILED")
  }
}
