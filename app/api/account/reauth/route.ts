import { eq } from "drizzle-orm"
import { z } from "zod"
import { adminError, adminJson } from "@/lib/admin-management"
import { AuthWorkloadOverloadedError, authRateLimitHeaders, consumeAuthRateLimit } from "@/lib/auth-abuse-guard"
import { apiError } from "@/lib/api-response"
import { createDb } from "@/lib/db"
import { authorizeAccountSession, passkeyFailure } from "@/lib/passkey-management"
import { markSessionVerified, verifyPasskeyAssertion } from "@/lib/passkeys"
import { verifyPassword } from "@/lib/password"
import { users } from "@/lib/schema"

export const runtime = "nodejs"

const reauthSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), password: z.string().min(1).max(256) }).strict(),
  z.object({ method: z.literal("passkey"), challengeId: z.string().max(64), response: z.record(z.unknown()) }).strict(),
])

/** Confirm the person at this session before sensitive account changes. */
export async function POST(request: Request) {
  const auth = await authorizeAccountSession(request)
  if (!auth.ok) return auth.response
  const payload = reauthSchema.safeParse(await request.json().catch(() => null))
  if (!payload.success) return adminError("INVALID_REQUEST", 400)

  try {
    if (payload.data.method === "passkey") {
      await verifyPasskeyAssertion(payload.data.challengeId, payload.data.response, { userId: auth.userId, sessionId: auth.sessionId })
    } else {
      // A hijacked session must not become an unlimited password oracle.
      const rateLimit = consumeAuthRateLimit("login", request.headers)
      if (!rateLimit.allowed) {
        return apiError("AUTH_RATE_LIMITED", 429, { headers: authRateLimitHeaders(rateLimit), details: { retryAfter: rateLimit.retryAfterSeconds } })
      }
      const user = await createDb().query.users.findFirst({ where: eq(users.id, auth.userId), columns: { password: true } })
      if (!user?.password) return adminError("REAUTH_METHOD_UNAVAILABLE", 409)
      const verification = await verifyPassword(payload.data.password, user.password)
      if (!verification.valid) return adminError("REAUTH_FAILED", 403)
    }
    return adminJson({ until: await markSessionVerified(auth.userId, auth.sessionId) })
  } catch (error) {
    if (error instanceof AuthWorkloadOverloadedError) {
      return apiError("AUTH_CAPACITY_EXCEEDED", 503, { headers: { "Cache-Control": "no-store", "Retry-After": error.retryAfterSeconds.toString() } })
    }
    return passkeyFailure(error, "REAUTH_FAILED")
  }
}
