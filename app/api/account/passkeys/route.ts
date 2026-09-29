import { z } from "zod"
import { adminError, adminJson } from "@/lib/admin-management"
import { authorizeAccountSession, passkeyFailure, savePasskey } from "@/lib/passkey-management"
import {
  PASSKEY_LIMIT,
  listPasskeys,
  passkeyRelyingParty,
  passkeyUserHandle,
  passkeysEnabled,
  reauthenticationState,
  verifyRegistration,
} from "@/lib/passkeys"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await authorizeAccountSession(request)
  if (!auth.ok) return auth.response
  try {
    const [items, reauth] = await Promise.all([listPasskeys(auth.userId), reauthenticationState(auth.userId, auth.sessionId)])
    const rp = passkeyRelyingParty()
    return adminJson({ items, limit: PASSKEY_LIMIT, enabled: passkeysEnabled(), rpId: rp?.rpId ?? null, userHandle: passkeyUserHandle(auth.userId), reauth })
  } catch (error) {
    return passkeyFailure(error, "PASSKEYS_READ_FAILED")
  }
}

const registrationSchema = z.object({
  challengeId: z.string().max(64),
  response: z.record(z.unknown()),
  name: z.string().max(256).optional(),
}).strict()

/** Finish a registration started by POST /api/account/passkeys/options. */
export async function POST(request: Request) {
  const auth = await authorizeAccountSession(request)
  if (!auth.ok) return auth.response
  const payload = registrationSchema.safeParse(await request.json().catch(() => null))
  if (!payload.success) return adminError("INVALID_REQUEST", 400)
  try {
    const row = await verifyRegistration(auth.userId, auth.sessionId, payload.data.challengeId, payload.data.response, payload.data.name)
    await savePasskey(auth.userId, row)
    const item = (await listPasskeys(auth.userId)).find(candidate => candidate.id === row.id)
    return adminJson({ item })
  } catch (error) {
    return passkeyFailure(error, "PASSKEY_SAVE_FAILED")
  }
}
