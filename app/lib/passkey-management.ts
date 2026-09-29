import { and, eq } from "drizzle-orm"
import type { ApiErrorCode } from "./api-codes"
import { adminChange, adminError } from "./admin-management"
import { createDb } from "./db"
import { PasskeyError, type verifyRegistration } from "./passkeys"
import { passkeys } from "./schema"

type PasskeyRow = Awaited<ReturnType<typeof verifyRegistration>>

function isUniqueViolation(error: unknown) {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 5; depth++) {
    const candidate = current as { code?: unknown; cause?: unknown }
    if (candidate.code === "23505" || candidate.code === "SQLITE_CONSTRAINT_UNIQUE" || candidate.code === "SQLITE_CONSTRAINT_PRIMARYKEY") return true
    current = candidate.cause
  }
  return false
}

/** Map expected passkey failures to their protocol code; log anything else. */
export function passkeyFailure(error: unknown, fallback: ApiErrorCode) {
  if (error instanceof PasskeyError) return adminError(error.code, error.status)
  console.error("passkey.operation_failed", { name: error instanceof Error ? error.name : "UnknownError" })
  return adminError(fallback, 500)
}

/** Insert a verified credential together with its account audit entry. */
export async function savePasskey(actorId: string, row: PasskeyRow) {
  try {
    await adminChange({ actorId, userId: row.userId, action: "passkey.create", target: row.name || row.id }, [{
      text: "INSERT INTO passkey (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, aaguid, name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      values: [row.id, row.userId, row.credentialId, row.publicKey, row.counter, row.transports, row.deviceType, row.backedUp, row.aaguid, row.name, row.createdAt, row.lastUsedAt],
    }])
  } catch (error) {
    if (isUniqueViolation(error)) throw new PasskeyError("PASSKEY_ALREADY_REGISTERED", 409)
    throw error
  }
}

/** Call only after authenticating the owner (with recent verification) or an Emperor. */
export async function removePasskey(actorId: string, userId: string, passkeyId: string) {
  const target = await createDb().query.passkeys.findFirst({
    where: and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)),
    columns: { id: true, name: true },
  })
  if (!target) throw new PasskeyError("PASSKEY_NOT_FOUND", 404)
  await adminChange({ actorId, userId, action: "passkey.delete", target: target.name || target.id }, [{
    text: "DELETE FROM passkey WHERE id = ? AND user_id = ?",
    values: [passkeyId, userId],
  }])
}

/** Passkey management is limited to browser sessions; API keys never qualify. */
export async function authorizeAccountSession(request: Request) {
  const { authorizeRequest } = await import("./request-auth")
  const auth = await authorizeRequest(request)
  if (!auth.ok) return auth
  const { kind, sessionId, userId } = auth.principal
  if (kind !== "session" || !sessionId) return { ok: false as const, response: adminError("UNAUTHORIZED", 401) }
  return { ok: true as const, userId, sessionId }
}
