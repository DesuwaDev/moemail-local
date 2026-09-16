import {
  CAPTCHA_PROVIDERS, captchaSiteverifyUrls,
  type CaptchaProviderId, type CaptchaProviderSettings, type CaptchaScope,
} from "./providers"

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

function siteverifyUrls(provider: CaptchaProviderId, settings: CaptchaProviderSettings) {
  const urls = captchaSiteverifyUrls(provider, settings.endpoint, settings)
  const preferred = lastAnsweringUrl.get(provider)
  if (!preferred || !urls.includes(preferred)) return urls
  return [preferred, ...urls.filter(url => url !== preferred)]
}

export async function verifyWithProvider(
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
  for (const url of siteverifyUrls(provider, settings)) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": provider === "cap" ? "application/json" : "application/x-www-form-urlencoded" },
        body: provider === "cap" ? JSON.stringify(Object.fromEntries(body)) : body.toString(),
        redirect: "error",
        cache: "no-store",
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

  if (data?.success !== true) return false

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

