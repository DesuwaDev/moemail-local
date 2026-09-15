import { CONFIG_KEYS, getConfigValues, setConfigValues } from "../config-store"
import {
  type CaptchaClientConfig,
  type CaptchaConfig,
  normalizeCaptchaConfig,
  publicCaptchaConfig,
} from "./providers"

// Deployments that predate the multi-provider registry stored Turnstile in
// three flat rows. They are read through, never rewritten: the first save from
// the admin panel writes CAPTCHA_CONFIG and the legacy rows simply stop being
// consulted, so rolling back keeps working.
async function readLegacyTurnstileConfig(): Promise<CaptchaConfig> {
  const legacy = await getConfigValues([
    CONFIG_KEYS.TURNSTILE_ENABLED,
    CONFIG_KEYS.TURNSTILE_SITE_KEY,
    CONFIG_KEYS.TURNSTILE_SECRET_KEY,
  ])

  return normalizeCaptchaConfig({
    enabled: legacy.TURNSTILE_ENABLED === "true",
    provider: "turnstile",
    providers: {
      turnstile: {
        siteKey: legacy.TURNSTILE_SITE_KEY,
        secretKey: legacy.TURNSTILE_SECRET_KEY,
      },
    },
  })
}

export async function getCaptchaConfig(): Promise<CaptchaConfig> {
  const stored = await getConfigValues([CONFIG_KEYS.CAPTCHA_CONFIG])
  const raw = stored.CAPTCHA_CONFIG

  if (!raw) return readLegacyTurnstileConfig()

  try {
    return normalizeCaptchaConfig(JSON.parse(raw))
  } catch (error) {
    console.error("captcha.config_parse_failed", error)
    return readLegacyTurnstileConfig()
  }
}

export async function getPublicCaptchaConfig(): Promise<CaptchaClientConfig> {
  return publicCaptchaConfig(await getCaptchaConfig())
}

export async function saveCaptchaConfig(input: unknown): Promise<CaptchaConfig> {
  const config = normalizeCaptchaConfig(input)
  await setConfigValues({ [CONFIG_KEYS.CAPTCHA_CONFIG]: JSON.stringify(config) })
  return config
}
