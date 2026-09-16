import { getCaptchaConfig } from "./config"
import { verifyWithProvider } from "./siteverify"
import {
  type CaptchaProviderId,
  type CaptchaScope,
  captchaFallbackProvider,
  captchaProviderReady,
} from "./providers"

export interface CaptchaVerificationResult {
  success: boolean
  reason?: "missing-token" | "verification-failed"
}

export async function verifyCaptchaToken(
  scope: CaptchaScope,
  token?: string | null,
  mintedBy?: string | null,
): Promise<CaptchaVerificationResult> {
  const config = await getCaptchaConfig()
  const settings = config.providers[config.provider]

  // Disabled scopes do not require a token.
  if (!config.enabled || !config.scopes[scope]) {
    return { success: true }
  }

  // A hosted channel missing half a key pair verifies nothing, and the browser
  // is told the gate is off, so demanding a token would lock the site out of its
  // own login. A self-hosted Cap keeps the gate shut instead: the login page
  // still shows it, and a Cap server that cannot be reached is exactly what a
  // bypass would look like.
  const primaryReady = captchaProviderReady(settings, config.provider)
  if (!primaryReady && config.provider !== "cap") {
    return { success: true }
  }

  // Channels the browser could have minted this token with, in the order the
  // login page offers them. An unusable primary drops out of the list instead of
  // taking the backup down with it: the page is handed both and switches on its
  // own, so the backup's token is the only one that can arrive.
  const fallback = captchaFallbackProvider(config)
  const channels: CaptchaProviderId[] = [
    ...(primaryReady ? [config.provider] : []),
    ...(fallback ? [fallback] : []),
  ]
  if (!channels.length) {
    return { success: false, reason: "verification-failed" }
  }

  const trimmedToken = token?.trim()
  if (!trimmedToken) {
    return { success: false, reason: "missing-token" }
  }

  // With self-hosted backends a token must never leak to another provider, so
  // the browser's claim about which channel minted it selects exactly one the
  // administrator enabled; anything else is rejected rather than tried around.
  const minted = mintedBy ?? channels[0]
  const channel = channels.find(id => id === minted)
  if (!channel) {
    return { success: false, reason: "verification-failed" }
  }

  return await verifyWithProvider(channel, config.providers[channel], scope, trimmedToken)
    ? { success: true }
    : { success: false, reason: "verification-failed" }
}
