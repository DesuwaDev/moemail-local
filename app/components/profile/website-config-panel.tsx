"use client"

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Bot,
  ChevronRight,
  Cloud,
  ExternalLink,
  Gauge,
  Settings,
  ShieldCheck,
  Server,
  ShieldOff,
  type LucideIcon,
} from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useState, useEffect } from "react"
import { Role, ROLES } from "@/lib/permissions"
import { Input } from "@/components/ui/input"
import { SecretInput } from "@/components/ui/secret-input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { readApiErrorCode } from "@/lib/api-error-client"
import { LocalizedUiError, localizedUiErrorMessage } from "@/lib/localized-ui-error"
import {
  CAPTCHA_ENDPOINTS,
  CAPTCHA_FALLBACK_OFF,
  CAPTCHA_PROVIDERS,
  CAPTCHA_PROVIDER_IDS,
  CAPTCHA_SCOPES,
  CAPTCHA_SIZES,
  CAPTCHA_THEMES,
  captchaOptionFields,
  captchaProviderReady,
  validCapServerUrl,
  normalizeCaptchaConfig,
  type CaptchaConfig,
  type CaptchaFallback,
  type CaptchaOptionField,
  type CaptchaProviderId,
  type CaptchaProviderSettings,
} from "@/lib/captcha/providers"

// Icons stay here rather than in the shared registry so the server bundle never
// pulls in the icon set. A new channel fails to compile until it gets one.
const PROVIDER_ICONS: Record<CaptchaProviderId, LucideIcon> = {
  turnstile: Cloud,
  recaptcha: Bot,
  recaptchaV3: Gauge,
  hcaptcha: ShieldCheck,
  cap: Server,
}

// "Off" is an option of the channel picker rather than a separate switch, so
// the one control always spells out what is live instead of leaving the reader
// to combine a toggle with a dropdown that looks like a draft selection.
const CAPTCHA_OFF = "off"

const OPTION_CHOICES = {
  theme: CAPTCHA_THEMES,
  size: CAPTCHA_SIZES,
  endpoint: CAPTCHA_ENDPOINTS,
} as const

const OPTION_CATALOGS = {
  theme: "themes",
  size: "sizes",
  endpoint: "endpoints",
} as const

// Risk scores range over 0..1; these are the useful stops.
const THRESHOLD_PRESETS = [0.3, 0.5, 0.7, 0.9]

// Paired option selects get narrow on a phone, so the value shrinks and clips
// instead of pushing the chevron out of the control.
const COMPACT_TRIGGER = "gap-2 [&>span]:min-w-0 [&>span]:truncate"

// The two channels are the same kind of thing, so they are the same kind of row.
type ChannelRole = "primary" | "fallback"

// Which row a freshly loaded panel opens. Two channel forms stacked open run for
// a screenful on a phone — Cap alone adds two URL fields — and a channel that
// already verifies has nothing its summary row does not say, so only one that
// cannot verify yet asks for the space.
function incompleteChannel(config: CaptchaConfig): ChannelRole | null {
  if (!config.enabled) return null
  if (!captchaProviderReady(config.providers[config.provider], config.provider)) return "primary"
  const backup = config.fallback
  if (backup !== CAPTCHA_FALLBACK_OFF && !captchaProviderReady(config.providers[backup], backup)) {
    return "fallback"
  }
  return null
}

export function WebsiteConfigPanel() {
  const t = useTranslations("profile.website")
  const tCard = useTranslations("profile.card")
  const tApi = useTranslations("api")
  const [defaultRole, setDefaultRole] = useState<string>("")
  const [adminContact, setAdminContact] = useState<string>("")
  const [captcha, setCaptcha] = useState<CaptchaConfig>(() => normalizeCaptchaConfig(null))
  // What the server is actually running. The editable copy above is a draft
  // until a save lands, so the two are compared to tell the operator whether
  // the channel on screen is the one protecting the site right now.
  const [liveCaptcha, setLiveCaptcha] = useState<CaptchaConfig>(() => normalizeCaptchaConfig(null))
  // Which channel row is unfolded, or none. It only ever moves on an explicit
  // action — a click, or picking a channel — so a form cannot fold itself away
  // under the operator's hands the moment the last key makes it valid.
  const [openChannel, setOpenChannel] = useState<ChannelRole | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/config")
        if (!res.ok) throw new LocalizedUiError(tApi(await readApiErrorCode(res, "CONFIG_LOAD_FAILED") as never))

        const data = await res.json() as {
          defaultRole: Exclude<Role, typeof ROLES.EMPEROR>
          adminContact: string
          captcha?: unknown
        }
        setDefaultRole(data.defaultRole)
        setAdminContact(data.adminContact)
        const stored = normalizeCaptchaConfig(data.captcha)
        setCaptcha(stored)
        setLiveCaptcha(stored)
        setOpenChannel(incompleteChannel(stored))
        setLoaded(true)
      } catch (error) {
        console.error("website_config.load_failed", error)
        toast({
          title: t("loadFailed"),
          description: localizedUiErrorMessage(error, t("loadFailed")),
          variant: "destructive",
        })
      }
    }

    void fetchConfig()
    // Translation helpers are stable for a given locale and the panel only
    // loads once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async () => {
    setLoading(true)
    // Normalising up front means the stored row and the baseline below are the
    // same document, so a trimmed key cannot leave the panel looking unsaved.
    const submitted = normalizeCaptchaConfig(captcha)
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultRole, adminContact, captcha: submitted }),
      })

      if (!res.ok) throw new LocalizedUiError(tApi(await readApiErrorCode(res, "CONFIG_SAVE_FAILED") as never))

      setCaptcha(submitted)
      setLiveCaptcha(submitted)
      toast({
        title: t("saveSuccess"),
        description: t("saveSuccess"),
      })
    } catch (error) {
      console.error("website_config.save_failed", error)
      toast({
        title: t("saveFailed"),
        description: localizedUiErrorMessage(error, t("saveFailed")),
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const provider = captcha.provider
  const fallback = captcha.fallback
  const enabled = captcha.enabled
  const ChannelIcon = enabled ? PROVIDER_ICONS[provider] : ShieldOff
  const channelLabel = enabled ? t(`captcha.providers.${provider}.name` as never) : t("captcha.off")
  const FallbackIcon = fallback === CAPTCHA_FALLBACK_OFF ? ShieldOff : PROVIDER_ICONS[fallback]
  const fallbackLabel = fallback === CAPTCHA_FALLBACK_OFF
    ? t("captcha.fallbackOff")
    : t(`captcha.providers.${fallback}.name` as never)
  // `normalizeCaptchaConfig` builds both documents from the same constant key
  // order, so serialising is a sound deep comparison here.
  const pendingChanges = JSON.stringify(captcha) !== JSON.stringify(liveCaptcha)
  const liveChannelLabel = liveCaptcha.enabled
    ? t(`captcha.providers.${liveCaptcha.provider}.name` as never)
    : t("captcha.off")

  const patchSettings = (id: CaptchaProviderId, patch: Partial<CaptchaProviderSettings>) => {
    setCaptcha(current => ({
      ...current,
      providers: {
        ...current.providers,
        [id]: { ...current.providers[id], ...patch },
      },
    }))
  }

  const renderOptionField = (id: CaptchaProviderId, field: CaptchaOptionField) => {
    const settings = captcha.providers[id]
    const fieldId = `captcha-${id}-${field}`
    const label = (
      <Label htmlFor={fieldId} className="text-xs font-medium">
        {t(`captcha.fields.${field}` as never)}
      </Label>
    )

    if (field === "threshold") {
      // Risk scores range over 0..1; the presets are the useful stops, and any
      // hand-tuned value already in storage is folded in so it stays selectable.
      const choices = [...new Set([...THRESHOLD_PRESETS, settings.threshold])].sort((a, b) => a - b)
      return (
        <div key={field} className="min-w-0 space-y-1.5">
          {label}
          <Select
            value={settings.threshold.toFixed(2)}
            onValueChange={value => patchSettings(id, { threshold: Number(value) })}
          >
            <SelectTrigger id={fieldId} className={COMPACT_TRIGGER}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[var(--radix-select-content-available-height)]">
              {choices.map(choice => (
                <SelectItem key={choice} value={choice.toFixed(2)}>
                  {choice.toFixed(2)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    }

    const catalog = OPTION_CATALOGS[field]
    return (
      <div key={field} className="min-w-0 space-y-1.5">
        {label}
        <Select
          value={settings[field]}
          onValueChange={value => patchSettings(id, { [field]: value } as Partial<CaptchaProviderSettings>)}
        >
          <SelectTrigger id={fieldId} className={COMPACT_TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-[var(--radix-select-content-available-height)]">
            {OPTION_CHOICES[field].map(choice => (
              <SelectItem key={choice} value={choice}>
                {t(`captcha.${catalog}.${choice}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  // One form shape for both roles: the backup is a full channel with its own key
  // pair and its own options, not a switch on the primary one. The row around it
  // carries the name and the state, so this starts at the description.
  const renderChannelForm = (id: CaptchaProviderId) => {
    const settings = captcha.providers[id]
    const optionFields = captchaOptionFields(id)
    const capUrlValid = validCapServerUrl(settings.serverUrl)
      && (!settings.verificationServerUrl || validCapServerUrl(settings.verificationServerUrl))
    return (
      <>
        <div className="flex items-start gap-3 border-b pb-2.5">
          <p className="hidden min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground sm:block">
            {t(`captcha.providers.${id}.description` as never)}
          </p>
          <a
            href={id === "cap" && validCapServerUrl(settings.serverUrl) ? settings.serverUrl : CAPTCHA_PROVIDERS[id].consoleUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary hover:underline"
          >
            {id === "cap" && !validCapServerUrl(settings.serverUrl) ? t("captcha.openGuide") : t("captcha.openConsole")}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {id === "cap" && (
          <div className="space-y-1.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="captcha-cap-server-url" className="text-xs font-medium">
                  {t("captcha.fields.serverUrl")}
                </Label>
                <Input
                  id="captcha-cap-server-url"
                  type="url"
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  value={settings.serverUrl}
                  onChange={e => patchSettings(id, { serverUrl: e.target.value })}
                  placeholder={t("captcha.placeholders.serverUrl")}
                  aria-invalid={Boolean(settings.serverUrl) && !validCapServerUrl(settings.serverUrl)}
                  aria-describedby="captcha-cap-server-hint"
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="captcha-cap-verification-url" className="text-xs font-medium">
                  {t("captcha.fields.verificationServerUrl")}
                </Label>
                <Input
                  id="captcha-cap-verification-url"
                  type="url"
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  value={settings.verificationServerUrl}
                  onChange={e => patchSettings(id, { verificationServerUrl: e.target.value })}
                  placeholder={t("captcha.placeholders.verificationServerUrl")}
                  aria-invalid={Boolean(settings.verificationServerUrl) && !validCapServerUrl(settings.verificationServerUrl)}
                  aria-describedby="captcha-cap-server-hint"
                />
              </div>
            </div>
            <p id="captcha-cap-server-hint" className="text-[11px] leading-relaxed text-muted-foreground">
              {t("captcha.hints.capServer")}
            </p>
            {!capUrlValid && (
              <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                {tApi("CAPTCHA_SERVER_URL_INVALID")}
              </p>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`captcha-${id}-site-key`} className="text-xs font-medium">
              {t("captcha.fields.siteKey")}
            </Label>
            <Input
              id={`captcha-${id}-site-key`}
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              value={settings.siteKey}
              onChange={e => patchSettings(id, { siteKey: e.target.value })}
              placeholder={t("captcha.placeholders.siteKey")}
            />
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`captcha-${id}-secret-key`} className="text-xs font-medium">
              {t("captcha.fields.secretKey")}
            </Label>
            <SecretInput
              id={`captcha-${id}-secret-key`}
              autoComplete="new-password"
              showLabel={t("captcha.showSecret")}
              hideLabel={t("captcha.hideSecret")}
              value={settings.secretKey}
              onChange={e => patchSettings(id, { secretKey: e.target.value })}
              placeholder={t("captcha.placeholders.secretKey")}
            />
          </div>
        </div>

        {/* A half-filled channel verifies nothing: the primary one opens the
            gate instead of locking everyone out, and the backup is simply never
            offered. Neither is obvious from an empty box. */}
        {!captchaProviderReady(settings) && (
          <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
            {t("captcha.hints.keysMissing")}
          </p>
        )}

        {/* Only the channels whose console hands out a credential that
            needs explaining carry this note, so the catalog decides where
            it appears instead of a provider test hard-coded here. */}
        {t.has(`captcha.providers.${id}.keyHint` as never) && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t(`captcha.providers.${id}.keyHint` as never)}
          </p>
        )}

        {/* An odd number of options stretches the last cell instead of
            leaving a hole next to it. The compact selects pair up from
            380px — the common phone widths are 390-412 — so a portrait
            screen no longer gets one long column of boxes. */}
        <div className="grid gap-3 min-[380px]:grid-cols-2 min-[380px]:[&>*:nth-child(odd):last-child]:col-span-2">
          {optionFields.map(field => renderOptionField(id, field))}
        </div>

        {CAPTCHA_PROVIDERS[id].scoreBased && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("captcha.hints.threshold")}
          </p>
        )}

        {/* Only a channel that actually has a mirror explains one, which
            the option list already decides. */}
        {optionFields.includes("endpoint") && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("captcha.hints.endpoint")}
          </p>
        )}
      </>
    )
  }

  // Which provider stands in for the live one. It lives inside the backup row
  // because it is that channel's own setting, and the row header already says
  // which one is on duty when the row is folded away.
  const renderFallbackPicker = () => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span id="captcha-fallback-label" className="shrink-0 text-xs font-medium">
        {t("captcha.providerLabel")}
      </span>

      <Select
        value={fallback}
        onValueChange={value => setCaptcha(current => ({
          ...current,
          fallback: value as CaptchaFallback,
        }))}
      >
        <SelectTrigger
          aria-labelledby="captcha-fallback-label captcha-fallback-value"
          className="w-full gap-2 sm:w-64 [&>svg]:shrink-0"
        >
          <span className="flex min-w-0 items-center gap-2">
            <FallbackIcon className={`h-4 w-4 shrink-0 ${
              fallback === CAPTCHA_FALLBACK_OFF ? "text-muted-foreground" : "text-primary"
            }`} />
            <span
              id="captcha-fallback-value"
              className={`truncate ${fallback === CAPTCHA_FALLBACK_OFF ? "text-muted-foreground" : ""}`}
            >
              {fallbackLabel}
            </span>
          </span>
        </SelectTrigger>
        <SelectContent className="max-h-[var(--radix-select-content-available-height)]">
          <SelectItem
            value={CAPTCHA_FALLBACK_OFF}
            className="pr-2 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1"
          >
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <ShieldOff className="h-4 w-4 shrink-0" />
              <span className="truncate">{t("captcha.fallbackOff")}</span>
            </span>
          </SelectItem>
          {/* The live channel is not offered as its own understudy. */}
          {CAPTCHA_PROVIDER_IDS.filter(id => id !== provider).map(id => {
            const Icon = PROVIDER_ICONS[id]
            return (
              <SelectItem
                key={id}
                value={id}
                className="pr-2 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">
                    {t(`captcha.providers.${id}.name` as never)}
                  </span>
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>

      <span className="hidden min-w-0 flex-1 truncate text-[11px] text-muted-foreground md:block">
        {t("captcha.fallbackHint")}
      </span>
    </div>
  )

  // A channel is a summary line plus a form that only exists while it is open.
  // Collapsed, the pair states which providers are on duty and whether either
  // still needs keys — the two questions worth answering without scrolling.
  const renderChannelRow = (role: ChannelRole) => {
    const id = role === "primary" ? provider : fallback === CAPTCHA_FALLBACK_OFF ? null : fallback
    const open = openChannel === role
    const Icon = id ? PROVIDER_ICONS[id] : ShieldOff
    // A channel nobody asked for reports nothing; the line above already reads
    // "not used".
    const ready = id === null ? null : captchaProviderReady(captcha.providers[id], id)
    return (
      <section className="overflow-hidden rounded-md border bg-card/30">
        <h4>
          <button
            type="button"
            id={`captcha-${role}-heading`}
            aria-expanded={open}
            aria-controls={`captcha-${role}-panel`}
            onClick={() => setOpenChannel(open ? null : role)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-primary/[0.04]"
          >
            <ChevronRight
              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${
                open ? "rotate-90" : ""
              }`}
            />
            <Icon className={`h-4 w-4 shrink-0 ${id ? "text-primary" : "text-muted-foreground"}`} />
            {/* Role and provider sit side by side once there is room for both.
                On the narrowest phones the provider drops to its own line rather
                than being truncated down to two letters beside a status pill. */}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 min-[420px]:flex-row min-[420px]:items-center min-[420px]:gap-2">
              <span className="truncate text-xs font-medium">
                {t(role === "primary" ? "captcha.primaryLabel" : "captcha.fallbackLabel")}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {id ? t(`captcha.providers.${id}.name` as never) : t("captcha.fallbackOff")}
              </span>
            </span>
            {ready !== null && (
              <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                ready
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              }`}>
                {t(ready ? "captcha.channelStatus.ready" : "captcha.channelStatus.incomplete")}
              </span>
            )}
          </button>
        </h4>

        {open && (
          <div
            id={`captcha-${role}-panel`}
            role="region"
            aria-labelledby={`captcha-${role}-heading`}
            className="animate-in space-y-3 border-t p-3 fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none"
          >
            {role === "fallback" && renderFallbackPicker()}
            {id && renderChannelForm(id)}
            {role === "fallback" && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("captcha.hints.fallback")}
              </p>
            )}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="bg-background rounded-lg border-2 border-primary/20 p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6">
        <Settings className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">{t("title")}</h2>
      </div>

      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="website-default-role" className="text-xs font-medium">
              {t("defaultRole")}
            </Label>
            <Select value={defaultRole} onValueChange={setDefaultRole}>
              <SelectTrigger id="website-default-role">
                <SelectValue placeholder={t("defaultRolePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROLES.DUKE}>{tCard("roles.DUKE")}</SelectItem>
                <SelectItem value={ROLES.KNIGHT}>{tCard("roles.KNIGHT")}</SelectItem>
                <SelectItem value={ROLES.CIVILIAN}>{tCard("roles.CIVILIAN")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="website-admin-contact" className="text-xs font-medium">
              {t("adminContact")}
            </Label>
            <Input
              id="website-admin-contact"
              value={adminContact}
              onChange={(e) => setAdminContact(e.target.value)}
              placeholder={t("adminContactPlaceholder")}
            />
          </div>
        </div>

        <section className="overflow-hidden rounded-lg border border-primary/25">
          <div className="flex items-start gap-2.5 border-b bg-primary/[0.025] px-3 py-2.5 sm:px-4 sm:py-3">
            <span className="mt-0.5 shrink-0 rounded-md bg-primary/10 p-1.5 text-primary">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{t("captcha.title")}</h3>
              <p className="mt-0.5 hidden text-[11px] leading-relaxed text-muted-foreground sm:block">
                {t("captcha.description")}
              </p>
            </div>
            {/* Says whether the channel below is the one the site is running on
                right now, which a draft form cannot express on its own. */}
            {loaded && (
              <span className={`ml-auto mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                pendingChanges
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              }`}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                {pendingChanges ? t("captcha.status.unsaved") : t("captcha.status.live")}
              </span>
            )}
          </div>

          <div className="space-y-2.5 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span id="captcha-provider-label" className="shrink-0 text-xs font-medium">
                {t("captcha.providerLabel")}
              </span>

              <Select
                value={enabled ? provider : CAPTCHA_OFF}
                onValueChange={value => {
                  setCaptcha(current => value === CAPTCHA_OFF
                    ? { ...current, enabled: false }
                    : {
                        ...current,
                        enabled: true,
                        provider: value as CaptchaProviderId,
                        // Promoting the backup leaves the site without one rather
                        // than with a channel standing in for itself.
                        fallback: current.fallback === value ? CAPTCHA_FALLBACK_OFF : current.fallback,
                      })
                  // A channel that was just chosen is the one about to be filled in.
                  setOpenChannel(value === CAPTCHA_OFF ? null : "primary")
                }}
              >
                <SelectTrigger
                  aria-labelledby="captcha-provider-label captcha-provider-value"
                  className="w-full gap-2 sm:w-64 [&>svg]:shrink-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ChannelIcon className={`h-4 w-4 shrink-0 ${enabled ? "text-primary" : "text-muted-foreground"}`} />
                    <span id="captcha-provider-value" className={`truncate ${enabled ? "" : "text-muted-foreground"}`}>
                      {channelLabel}
                    </span>
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-[var(--radix-select-content-available-height)]">
                  <SelectItem
                    value={CAPTCHA_OFF}
                    className="pr-2 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                      <ShieldOff className="h-4 w-4 shrink-0" />
                      <span className="truncate">{t("captcha.off")}</span>
                    </span>
                  </SelectItem>
                  {CAPTCHA_PROVIDER_IDS.map(id => {
                    const Icon = PROVIDER_ICONS[id]
                    return (
                      <SelectItem
                        key={id}
                        value={id}
                        className="pr-2 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0 text-primary" />
                          <span className="truncate">
                            {t(`captcha.providers.${id}.name` as never)}
                          </span>
                        </span>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>

              <span className="hidden min-w-0 flex-1 truncate text-[11px] text-muted-foreground md:block">
                {t("captcha.providerHint")}
              </span>
            </div>

            {loaded && pendingChanges && (
              <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                {t("captcha.status.activeNow", { channel: liveChannelLabel })}
              </p>
            )}

            {!enabled && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("captcha.offHint")}
              </p>
            )}

            {enabled && (
              <div className="space-y-2">
                {renderChannelRow("primary")}
                {renderChannelRow("fallback")}
              </div>
            )}

            {/* Which forms are protected is a property of the gate, not of a
                channel, so it stays outside both panels. */}
            {enabled && (
              <div className="space-y-1.5 border-t pt-3">
                <span className="text-xs font-medium">{t("captcha.scopesLabel")}</span>
                <div className="grid gap-2 min-[380px]:grid-cols-2">
                  {CAPTCHA_SCOPES.map(scope => (
                    <div
                      key={scope}
                      className="flex min-h-10 items-center justify-between gap-2 rounded border bg-background px-2.5"
                    >
                      <Label htmlFor={`captcha-scope-${scope}`} className="min-w-0 truncate text-xs font-medium">
                        {t(`captcha.scopes.${scope}` as never)}
                      </Label>
                      <Switch
                        id={`captcha-scope-${scope}`}
                        className="shrink-0"
                        checked={captcha.scopes[scope]}
                        onCheckedChange={checked => setCaptcha(current => ({
                          ...current,
                          scopes: { ...current.scopes, [scope]: checked },
                        }))}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t("captcha.hints.scopes")}
                </p>
              </div>
            )}
          </div>
        </section>

        <Button
          onClick={handleSave}
          disabled={loading || !loaded}
          className="w-full"
        >
          {loading ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  )
}
