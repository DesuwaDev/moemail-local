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

  // Disabled scopes do not require a token; an invalid enabled Cap configuration
  // fails closed instead of silently removing protection.
  if (!config.enabled || !config.scopes[scope]) {
    return { success: true }
  }

  if (!captchaProviderReady(settings, config.provider)) {
    return config.provider === "cap"
      ? { success: false, reason: "verification-failed" }
      : { success: true }
  }

  const trimmedToken = token?.trim()
  if (!trimmedToken) {
    return { success: false, reason: "missing-token" }
  }

  // A visitor whose browser could not load the first channel submits a token
  // from the backup. Its provider hint selects one operator-configured
  // channel; an unknown channel is rejected.
  const fallback = captchaFallbackProvider(config)
  const channels = fallback ? [config.provider, fallback] : [config.provider]
  // With self-hosted backends a token must never leak to another provider.
  // The browser hint can select only a channel the administrator enabled.
  if (mintedBy && !(channels as string[]).includes(mintedBy)) {
    return { success: false, reason: "verification-failed" }
  }
  const ordered = mintedBy ? [mintedBy as CaptchaProviderId] : [config.provider]

  for (const provider of ordered) {
    if (await verifyWithProvider(provider, config.providers[provider], scope, trimmedToken)) {
      return { success: true }
    }
  }

  return { success: false, reason: "verification-failed" }
}
