import { authRateLimitHeaders, consumeAuthRateLimit } from "@/lib/auth-abuse-guard"
import { isSetupCompleted } from "@/lib/config/runtime"
import { apiError } from "@/lib/api-response"
import { isSameOriginMutation } from "@/lib/request-origin"

export const runtime = "nodejs"

/**
 * Issue a single-use challenge for username-less passkey sign-in. Each request
 * stores a challenge, so it shares the login rate limit; verification happens
 * in the Auth.js "passkey" credentials provider.
 */
export async function POST(request: Request) {
  if (!isSetupCompleted()) return apiError("SETUP_REQUIRED", 503, { headers: { "Cache-Control": "no-store" } })
  if (!isSameOriginMutation(request)) return apiError("CROSS_ORIGIN_FORBIDDEN", 403)
  const rateLimit = consumeAuthRateLimit("login", request.headers)
  if (!rateLimit.allowed) {
    return apiError("AUTH_RATE_LIMITED", 429, {
      headers: authRateLimitHeaders(rateLimit),
      details: { retryAfter: rateLimit.retryAfterSeconds },
    })
  }
  const { PasskeyError, createAuthenticationOptions } = await import("@/lib/passkeys")
  try {
    return Response.json(await createAuthenticationOptions(), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof PasskeyError) return apiError(error.code, error.status, { headers: { "Cache-Control": "no-store" } })
    console.error("passkey.login_options_failed", { name: error instanceof Error ? error.name : "UnknownError" })
    return apiError("PASSKEY_VERIFICATION_FAILED", 500)
  }
}
