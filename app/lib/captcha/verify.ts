import { getCaptchaConfig } from "./config"
import {
  CAPTCHA_PROVIDERS,
  type CaptchaScope,
  captchaProviderReady,
} from "./providers"

export interface CaptchaVerificationResult {
  success: boolean
  reason?: "missing-token" | "verification-failed"
}

interface SiteverifyResponse {
  success?: boolean
  score?: number
  action?: string
}

const VERIFY_TIMEOUT_MS = 8_000

export async function verifyCaptchaToken(
  scope: CaptchaScope,
  token?: string | null,
): Promise<CaptchaVerificationResult> {
  const config = await getCaptchaConfig()
  const settings = config.providers[config.provider]

  // An unconfigured or scope-disabled challenge must never lock anyone out of
  // their own instance, so the gate opens instead of failing closed.
  if (!config.enabled || !config.scopes[scope] || !captchaProviderReady(settings)) {
    return { success: true }
  }

  const trimmedToken = token?.trim()
  if (!trimmedToken) {
    return { success: false, reason: "missing-token" }
  }

  const descriptor = CAPTCHA_PROVIDERS[config.provider]
  const body = new URLSearchParams({
    secret: settings.secretKey,
    response: trimmedToken,
  })
  if (descriptor.sendsSiteKeyOnVerify) {
    body.set("sitekey", settings.siteKey)
  }

  try {
    const response = await fetch(descriptor.siteverifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })

    if (!response.ok) {
      return { success: false, reason: "verification-failed" }
    }

    const data = await response.json() as SiteverifyResponse
    if (!data.success) {
      return { success: false, reason: "verification-failed" }
    }

    // A score-based channel always succeeds; the risk signal is the score, and
    // the action pins the token to the form it was minted for.
    if (descriptor.scoreBased) {
      if (data.action !== scope) {
        console.warn("captcha.action_mismatch", { expected: scope, received: data.action })
        return { success: false, reason: "verification-failed" }
      }
      const score = typeof data.score === "number" ? data.score : 0
      if (score < settings.threshold) {
        console.warn("captcha.score_below_threshold", { score, threshold: settings.threshold })
        return { success: false, reason: "verification-failed" }
      }
    }

    return { success: true }
  } catch (error) {
    console.error("captcha.verification_failed", error)
    return { success: false, reason: "verification-failed" }
  }
}
