// Single source of truth for every verification channel. Both the browser
// widget and the server-side siteverify call read this registry, so adding a
// provider is one entry here plus its `captcha.providers.*` catalog strings.
// The module stays pure (no config store, no DOM) so client and server bundles
// can share it.

export const CAPTCHA_PROVIDER_IDS = ["turnstile", "recaptcha", "recaptchaV3", "hcaptcha"] as const
export type CaptchaProviderId = (typeof CAPTCHA_PROVIDER_IDS)[number]

export const CAPTCHA_THEMES = ["auto", "light", "dark"] as const
export type CaptchaTheme = (typeof CAPTCHA_THEMES)[number]

export const CAPTCHA_SIZES = ["normal", "compact"] as const
export type CaptchaSize = (typeof CAPTCHA_SIZES)[number]

export const CAPTCHA_SCOPES = ["login", "register"] as const
export type CaptchaScope = (typeof CAPTCHA_SCOPES)[number]

export const CAPTCHA_OPTION_FIELDS = ["threshold", "theme", "size"] as const
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
  // Runs without a widget and answers with a risk score instead of a verdict.
  scoreBased: boolean
}

export const CAPTCHA_PROVIDERS: Record<CaptchaProviderId, CaptchaProviderDescriptor> = {
  turnstile: {
    id: "turnstile",
    siteverifyUrl: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    consoleUrl: "https://dash.cloudflare.com/?to=/:account/turnstile",
    optionFields: ["theme", "size"],
    sendsSiteKeyOnVerify: false,
    scoreBased: false,
  },
  // The two reCAPTCHA generations are separate channels on purpose: the console
  // mints a key as either v2 or v3, and rendering one generation with the
  // other's key fails with "Invalid key type". Sharing a single key pair
  // between them would guarantee that error on every switch.
  recaptcha: {
    id: "recaptcha",
    siteverifyUrl: "https://www.google.com/recaptcha/api/siteverify",
    consoleUrl: "https://www.google.com/recaptcha/admin",
    optionFields: ["theme", "size"],
    sendsSiteKeyOnVerify: false,
    scoreBased: false,
  },
  recaptchaV3: {
    id: "recaptchaV3",
    siteverifyUrl: "https://www.google.com/recaptcha/api/siteverify",
    consoleUrl: "https://www.google.com/recaptcha/admin",
    optionFields: ["threshold"],
    sendsSiteKeyOnVerify: false,
    scoreBased: true,
  },
  hcaptcha: {
    id: "hcaptcha",
    siteverifyUrl: "https://api.hcaptcha.com/siteverify",
    consoleUrl: "https://dashboard.hcaptcha.com/sites",
    optionFields: ["theme", "size"],
    sendsSiteKeyOnVerify: true,
    scoreBased: false,
  },
}

export interface CaptchaProviderSettings {
  siteKey: string
  secretKey: string
  theme: CaptchaTheme
  size: CaptchaSize
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
    threshold: normalizeThreshold(source.threshold),
  }
}

// Documents written before the split kept both reCAPTCHA generations under
// `recaptcha` with a `mode` switch, so a stored `mode: "v3"` identifies the key
// pair as a v3 pair. It moves to the new channel rather than being copied:
// leaving a v3 key in the v2 slot is exactly the mismatch that makes Google
// answer "Invalid key type".
function migrateRecaptchaGenerations(providers: Record<string, unknown>) {
  if (asRecord(providers.recaptcha).mode !== "v3") return providers
  return { ...providers, recaptcha: undefined, recaptchaV3: providers.recaptcha }
}

// Every read and write funnels through here, so a hand-edited config row, an
// older document shape or a malicious request body can only ever produce a
// fully populated config with in-range values.
export function normalizeCaptchaConfig(value: unknown): CaptchaConfig {
  const source = asRecord(value)
  const stored = asRecord(source.providers)
  const providers = migrateRecaptchaGenerations(stored)
  const scopes = asRecord(source.scopes)
  const selected = normalizeOption(source.provider, CAPTCHA_PROVIDER_IDS, DEFAULT_PROVIDER)
  return {
    enabled: source.enabled === true,
    provider: providers !== stored && selected === "recaptcha" ? "recaptchaV3" : selected,
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

// Options that do not apply to the current channel stay in storage but are
// hidden: a score-based channel has no widget to theme, a widget has no score
// to threshold.
export function captchaOptionFields(provider: CaptchaProviderId): readonly CaptchaOptionField[] {
  return CAPTCHA_PROVIDERS[provider].optionFields
}

export function publicCaptchaConfig(config: CaptchaConfig): CaptchaClientConfig {
  const settings = config.providers[config.provider]
  return {
    enabled: config.enabled && captchaProviderReady(settings),
    provider: config.provider,
    siteKey: settings.siteKey,
    theme: settings.theme,
    size: settings.size,
    scopes: config.scopes,
  }
}
