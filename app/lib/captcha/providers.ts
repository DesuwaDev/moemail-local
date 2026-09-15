// Single source of truth for every verification channel. Both the browser
// widget and the server-side siteverify call read this registry, so adding a
// provider is one entry here plus its `captcha.providers.*` catalog strings.
// The module stays pure (no config store, no DOM) so client and server bundles
// can share it.

export const CAPTCHA_PROVIDER_IDS = ["turnstile", "recaptcha", "hcaptcha"] as const
export type CaptchaProviderId = (typeof CAPTCHA_PROVIDER_IDS)[number]

export const CAPTCHA_THEMES = ["auto", "light", "dark"] as const
export type CaptchaTheme = (typeof CAPTCHA_THEMES)[number]

export const CAPTCHA_SIZES = ["normal", "compact"] as const
export type CaptchaSize = (typeof CAPTCHA_SIZES)[number]

// reCAPTCHA v2 renders a checkbox widget; v3 is invisible and returns a score
// that the server compares against `threshold`.
export const RECAPTCHA_MODES = ["v2", "v3"] as const
export type RecaptchaMode = (typeof RECAPTCHA_MODES)[number]

export const CAPTCHA_SCOPES = ["login", "register"] as const
export type CaptchaScope = (typeof CAPTCHA_SCOPES)[number]

export const CAPTCHA_OPTION_FIELDS = ["mode", "threshold", "theme", "size"] as const
export type CaptchaOptionField = (typeof CAPTCHA_OPTION_FIELDS)[number]

export const DEFAULT_SCORE_THRESHOLD = 0.5

interface CaptchaProviderDescriptor {
  id: CaptchaProviderId
  siteverifyUrl: string
  // Where the operator creates a site key pair.
  consoleUrl: string
  // Options the provider actually honours, in display order.
  optionFields: readonly CaptchaOptionField[]
  // hCaptcha scopes a verification to its site key; the others infer it from
  // the secret.
  sendsSiteKeyOnVerify: boolean
}

export const CAPTCHA_PROVIDERS: Record<CaptchaProviderId, CaptchaProviderDescriptor> = {
  turnstile: {
    id: "turnstile",
    siteverifyUrl: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    consoleUrl: "https://dash.cloudflare.com/?to=/:account/turnstile",
    optionFields: ["theme", "size"],
    sendsSiteKeyOnVerify: false,
  },
  recaptcha: {
    id: "recaptcha",
    siteverifyUrl: "https://www.google.com/recaptcha/api/siteverify",
    consoleUrl: "https://www.google.com/recaptcha/admin",
    optionFields: ["mode", "threshold", "theme", "size"],
    sendsSiteKeyOnVerify: false,
  },
  hcaptcha: {
    id: "hcaptcha",
    siteverifyUrl: "https://api.hcaptcha.com/siteverify",
    consoleUrl: "https://dashboard.hcaptcha.com/sites",
    optionFields: ["theme", "size"],
    sendsSiteKeyOnVerify: true,
  },
}

export interface CaptchaProviderSettings {
  siteKey: string
  secretKey: string
  theme: CaptchaTheme
  size: CaptchaSize
  mode: RecaptchaMode
  threshold: number
}

export interface CaptchaConfig {
  enabled: boolean
  provider: CaptchaProviderId
  scopes: Record<CaptchaScope, boolean>
  providers: Record<CaptchaProviderId, CaptchaProviderSettings>
}

// Everything the browser needs to render a challenge, and nothing else: the
// secret never leaves the server.
export interface CaptchaClientConfig {
  enabled: boolean
  provider: CaptchaProviderId
  siteKey: string
  theme: CaptchaTheme
  size: CaptchaSize
  mode: RecaptchaMode
  scopes: Record<CaptchaScope, boolean>
}

const DEFAULT_PROVIDER: CaptchaProviderId = "turnstile"
const MAX_KEY_LENGTH = 512

function normalizeKey(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, MAX_KEY_LENGTH) : ""
}

function normalizeOption<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback
}

function normalizeThreshold(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""))
  if (!Number.isFinite(parsed)) return DEFAULT_SCORE_THRESHOLD
  return Math.min(1, Math.max(0, Math.round(parsed * 100) / 100))
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

function normalizeSettings(value: unknown): CaptchaProviderSettings {
  const source = asRecord(value)
  return {
    siteKey: normalizeKey(source.siteKey),
    secretKey: normalizeKey(source.secretKey),
    theme: normalizeOption(source.theme, CAPTCHA_THEMES, "auto"),
    size: normalizeOption(source.size, CAPTCHA_SIZES, "normal"),
    mode: normalizeOption(source.mode, RECAPTCHA_MODES, "v2"),
    threshold: normalizeThreshold(source.threshold),
  }
}

// Every read and write funnels through here, so a hand-edited config row, an
// older document shape or a malicious request body can only ever produce a
// fully populated config with in-range values.
export function normalizeCaptchaConfig(value: unknown): CaptchaConfig {
  const source = asRecord(value)
  const providers = asRecord(source.providers)
  const scopes = asRecord(source.scopes)
  return {
    enabled: source.enabled === true,
    provider: normalizeOption(source.provider, CAPTCHA_PROVIDER_IDS, DEFAULT_PROVIDER),
    scopes: Object.fromEntries(
      CAPTCHA_SCOPES.map(scope => [scope, scopes[scope] !== false]),
    ) as Record<CaptchaScope, boolean>,
    providers: Object.fromEntries(
      CAPTCHA_PROVIDER_IDS.map(id => [id, normalizeSettings(providers[id])]),
    ) as Record<CaptchaProviderId, CaptchaProviderSettings>,
  }
}

export function captchaProviderReady(settings: CaptchaProviderSettings) {
  return settings.siteKey.length > 0 && settings.secretKey.length > 0
}

// Options that do not apply to the current provider stay in storage but are
// hidden: reCAPTCHA v3 has no widget to theme, v2 has no score to threshold.
export function captchaOptionFields(
  provider: CaptchaProviderId,
  mode: RecaptchaMode,
): readonly CaptchaOptionField[] {
  const fields = CAPTCHA_PROVIDERS[provider].optionFields
  if (provider !== "recaptcha") return fields
  return mode === "v3"
    ? fields.filter(field => field !== "theme" && field !== "size")
    : fields.filter(field => field !== "threshold")
}

export function publicCaptchaConfig(config: CaptchaConfig): CaptchaClientConfig {
  const settings = config.providers[config.provider]
  return {
    enabled: config.enabled && captchaProviderReady(settings),
    provider: config.provider,
    siteKey: settings.siteKey,
    theme: settings.theme,
    size: settings.size,
    mode: settings.mode,
    scopes: config.scopes,
  }
}
