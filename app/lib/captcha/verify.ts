import { getCaptchaConfig } from "./config"
import {
  CAPTCHA_PROVIDERS,
  type CaptchaEndpoint,
  type CaptchaProviderId,
  type CaptchaProviderSettings,
  type CaptchaScope,
  captchaFallbackProvider,
  captchaProviderReady,
  captchaSiteverifyUrls,
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

// Which origin last answered, per provider. Under `auto` on a network that
// cannot reach the leading candidate, every verification would otherwise pay
// the full timeout before falling through to the mirror. It is only a hint: an
// origin that later goes dark simply falls through again and the memo moves.
const lastAnsweringUrl = new Map<CaptchaProviderId, string>()

function siteverifyUrls(provider: CaptchaProviderId, endpoint: CaptchaEndpoint) {
  const urls = captchaSiteverifyUrls(provider, endpoint)
  const preferred = lastAnsweringUrl.get(provider)
  if (!preferred || !urls.includes(preferred)) return urls
  return [preferred, ...urls.filter(url => url !== preferred)]
}

async function verifyWithProvider(
  provider: CaptchaProviderId,
  settings: CaptchaProviderSettings,
  scope: CaptchaScope,
  token: string,
) {
  const descriptor = CAPTCHA_PROVIDERS[provider]
  const body = new URLSearchParams({
    secret: settings.secretKey,
    response: token,
  })
  if (descriptor.sendsSiteKeyOnVerify) {
    body.set("sitekey", settings.siteKey)
  }

  // The candidates front one backend, so a token minted through either verifies
  // through either: an origin that cannot be reached is skipped rather than
  // treated as a rejection.
  let data: SiteverifyResponse | null = null
  for (const url of siteverifyUrls(provider, settings.endpoint)) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      })
      if (!response.ok) continue

      data = await response.json() as SiteverifyResponse
      lastAnsweringUrl.set(provider, url)
      break
    } catch (error) {
      console.error("captcha.siteverify_unreachable", url, error)
    }
  }

  if (!data?.success) return false

  // A score-based channel always succeeds; the risk signal is the score, and
  // the action pins the token to the form it was minted for.
  if (descriptor.scoreBased) {
    if (data.action !== scope) {
      console.warn("captcha.action_mismatch", { expected: scope, received: data.action })
      return false
    }
    const score = typeof data.score === "number" ? data.score : 0
    if (score < settings.threshold) {
      console.warn("captcha.score_below_threshold", { score, threshold: settings.threshold })
      return false
    }
  }

  return true
}

export async function verifyCaptchaToken(
  scope: CaptchaScope,
  token?: string | null,
  mintedBy?: string | null,
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

  // A visitor whose browser could not load the first channel submits a token
  // from the backup, so both are accepted. The browser says which one minted
  // it, but only to put that one first: the hint picks between channels the
  // operator configured, and a wrong or forged one costs a round trip at most.
  const fallback = captchaFallbackProvider(config)
  const channels = fallback ? [config.provider, fallback] : [config.provider]
  const ordered = mintedBy && (channels as string[]).includes(mintedBy)
    ? [mintedBy as CaptchaProviderId, ...channels.filter(id => id !== mintedBy)]
    : channels

  for (const provider of ordered) {
    if (await verifyWithProvider(provider, config.providers[provider], scope, trimmedToken)) {
      return { success: true }
    }
  }

  return { success: false, reason: "verification-failed" }
}
