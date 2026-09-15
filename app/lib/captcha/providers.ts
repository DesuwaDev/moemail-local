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

export const CAPTCHA_OPTION_FIELDS = ["threshold", "theme", "size", "endpoint"] as const
export type CaptchaOptionField = (typeof CAPTCHA_OPTION_FIELDS)[number]

// Some providers publish the same service on a second origin for networks that
// cannot reach the first. Both fronts share one backend, so a token minted
// through either verifies through either.
export const CAPTCHA_REGIONS = ["global", "china"] as const
export type CaptchaRegion = (typeof CAPTCHA_REGIONS)[number]

// Pinning a region forces every visitor and the server onto one origin, which
// is only right when the whole audience sits on one side of a filter. `auto`
// lets each side settle it for itself and is the default.
export const CAPTCHA_ENDPOINTS = ["auto", ...CAPTCHA_REGIONS] as const
export type CaptchaEndpoint = (typeof CAPTCHA_ENDPOINTS)[number]

// A vendor bundle that never arrives — a filtered origin, a dead key, an
// extension that blocks the host — leaves the form unsubmittable, and a retry
// on the same channel cannot help. The operator can name a second channel the
// login page switches to on its own; "none" keeps the single-channel behaviour.
export const CAPTCHA_FALLBACK_OFF = "none"
export type CaptchaFallback = CaptchaProviderId | typeof CAPTCHA_FALLBACK_OFF
export const CAPTCHA_FALLBACK_CHOICES = [CAPTCHA_FALLBACK_OFF, ...CAPTCHA_PROVIDER_IDS] as const

export const DEFAULT_SCORE_THRESHOLD = 0.5

// Google publishes recaptcha.net for networks where google.com is unreachable;
// it serves the same api.js and the same siteverify backend.
const RECAPTCHA_ORIGINS: Record<CaptchaRegion, string> = {
  global: "https://www.google.com",
  china: "https://www.recaptcha.net",
}

// A provider with no regional mirror answers from one origin everywhere, so it
// repeats it and callers never branch on whether a mirror exists.
function everywhere(origin: string): Record<CaptchaRegion, string> {
  return { global: origin, china: origin }
}

interface CaptchaProviderDescriptor {
  id: CaptchaProviderId
  // Origin fronting the verification backend, per region.
  apiOrigins: Record<CaptchaRegion, string>
  siteverifyPath: string
  // Origin serving the browser bundle, per region. hCaptcha splits the two;
  // the rest reuse one host.
  scriptOrigins: Record<CaptchaRegion, string>
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
    apiOrigins: everywhere("https://challenges.cloudflare.com"),
    siteverifyPath: "/turnstile/v0/siteverify",
    scriptOrigins: everywhere("https://challenges.cloudflare.com"),
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
    apiOrigins: RECAPTCHA_ORIGINS,
    siteverifyPath: "/recaptcha/api/siteverify",
    scriptOrigins: RECAPTCHA_ORIGINS,
    consoleUrl: "https://www.google.com/recaptcha/admin",
    optionFields: ["theme", "size", "endpoint"],
    sendsSiteKeyOnVerify: false,
    scoreBased: false,
  },
  recaptchaV3: {
    id: "recaptchaV3",
    apiOrigins: RECAPTCHA_ORIGINS,
    siteverifyPath: "/recaptcha/api/siteverify",
    scriptOrigins: RECAPTCHA_ORIGINS,
    consoleUrl: "https://www.google.com/recaptcha/admin",
    optionFields: ["threshold", "endpoint"],
    sendsSiteKeyOnVerify: false,
    scoreBased: true,
  },
  hcaptcha: {
    id: "hcaptcha",
    apiOrigins: everywhere("https://api.hcaptcha.com"),
    siteverifyPath: "/siteverify",
    scriptOrigins: everywhere("https://js.hcaptcha.com"),
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
  endpoint: CaptchaEndpoint
}

export interface CaptchaConfig {
  enabled: boolean
  provider: CaptchaProviderId
  fallback: CaptchaFallback
  scopes: Record<CaptchaScope, boolean>
  providers: Record<CaptchaProviderId, CaptchaProviderSettings>
}

// What the browser needs to mint a token with one channel. The login page holds
// two of these at once, so it is named apart from the document below.
export interface CaptchaChannelConfig {
  provider: CaptchaProviderId
  siteKey: string
  theme: CaptchaTheme
  size: CaptchaSize
  endpoint: CaptchaEndpoint
}

// Everything the browser needs to render a challenge, and nothing else: the
// secret never leaves the server.
export interface CaptchaClientConfig extends CaptchaChannelConfig {
  enabled: boolean
  scopes: Record<CaptchaScope, boolean>
  // The channel to switch to when the first one never loads, or null when the
  // operator configured none — an unusable one is never advertised.
  fallback: CaptchaChannelConfig | null
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
    endpoint: normalizeOption(source.endpoint, CAPTCHA_ENDPOINTS, "auto"),
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
  const migrated = providers !== stored
  const selected = normalizeOption(source.provider, CAPTCHA_PROVIDER_IDS, DEFAULT_PROVIDER)
  const provider = migrated && selected === "recaptcha" ? "recaptchaV3" : selected
  const declared = normalizeOption(source.fallback, CAPTCHA_FALLBACK_CHOICES, CAPTCHA_FALLBACK_OFF)
  const fallback = migrated && declared === "recaptcha" ? "recaptchaV3" : declared
  return {
    enabled: source.enabled === true,
    provider,
    // A channel cannot stand in for itself: the second attempt would repeat the
    // load that just failed, with the same key, against the same origin.
    fallback: fallback === provider ? CAPTCHA_FALLBACK_OFF : fallback,
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

// Candidate origins in the order they should be tried. A pinned region yields
// exactly one; `auto` leads with the global origin and keeps the mirror behind
// it, deduplicated so a provider without a mirror is never tried twice.
function candidateOrigins(origins: Record<CaptchaRegion, string>, endpoint: CaptchaEndpoint) {
  if (endpoint !== "auto") return [origins[endpoint]]
  return [...new Set([origins.global, origins.china])]
}

export function captchaScriptUrls(channel: CaptchaChannelConfig, locale: string): string[] {
  const descriptor = CAPTCHA_PROVIDERS[channel.provider]
  return candidateOrigins(descriptor.scriptOrigins, channel.endpoint)
    .map(origin => vendorScriptUrl(channel, locale, origin))
}

export function captchaSiteverifyUrls(
  provider: CaptchaProviderId,
  endpoint: CaptchaEndpoint,
): string[] {
  const descriptor = CAPTCHA_PROVIDERS[provider]
  return candidateOrigins(descriptor.apiOrigins, endpoint)
    .map(origin => `${origin}${descriptor.siteverifyPath}`)
}

// reCAPTCHA takes its language from the script URL, and the score-based
// generation binds the site key there instead of at render time.
function vendorScriptUrl(channel: CaptchaChannelConfig, locale: string, origin: string) {
  const language = encodeURIComponent(locale)
  if (channel.provider === "recaptchaV3") {
    return `${origin}/recaptcha/api.js?render=${encodeURIComponent(channel.siteKey)}&hl=${language}`
  }
  if (channel.provider === "recaptcha") {
    return `${origin}/recaptcha/api.js?render=explicit&hl=${language}`
  }
  if (channel.provider === "hcaptcha") return `${origin}/1/api.js?render=explicit`
  return `${origin}/turnstile/v0/api.js?render=explicit`
}

function channelConfig(
  provider: CaptchaProviderId,
  settings: CaptchaProviderSettings,
): CaptchaChannelConfig {
  return {
    provider,
    siteKey: settings.siteKey,
    theme: settings.theme,
    size: settings.size,
    endpoint: settings.endpoint,
  }
}

// The configured backup, or null when there is none — a channel missing either
// half of its key pair cannot verify anything, so offering it would only turn a
// load failure into a rejection.
export function captchaFallbackProvider(config: CaptchaConfig): CaptchaProviderId | null {
  if (config.fallback === CAPTCHA_FALLBACK_OFF) return null
  return captchaProviderReady(config.providers[config.fallback]) ? config.fallback : null
}

export function publicCaptchaConfig(config: CaptchaConfig): CaptchaClientConfig {
  const settings = config.providers[config.provider]
  const fallback = captchaFallbackProvider(config)
  return {
    ...channelConfig(config.provider, settings),
    enabled: config.enabled && captchaProviderReady(settings),
    scopes: config.scopes,
    fallback: fallback ? channelConfig(fallback, config.providers[fallback]) : null,
  }
}
