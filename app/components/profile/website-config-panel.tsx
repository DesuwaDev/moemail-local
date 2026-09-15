"use client"

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Bot,
  Cloud,
  ExternalLink,
  Settings,
  ShieldCheck,
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
  CAPTCHA_PROVIDERS,
  CAPTCHA_PROVIDER_IDS,
  CAPTCHA_SCOPES,
  CAPTCHA_SIZES,
  CAPTCHA_THEMES,
  RECAPTCHA_MODES,
  captchaOptionFields,
  normalizeCaptchaConfig,
  type CaptchaConfig,
  type CaptchaOptionField,
  type CaptchaProviderId,
  type CaptchaProviderSettings,
} from "@/lib/captcha/providers"

// Icons stay here rather than in the shared registry so the server bundle never
// pulls in the icon set. A new channel fails to compile until it gets one.
const PROVIDER_ICONS: Record<CaptchaProviderId, LucideIcon> = {
  turnstile: Cloud,
  recaptcha: Bot,
  hcaptcha: ShieldCheck,
}

// "Off" is an option of the channel picker rather than a separate switch, so
// the one control always spells out what is live instead of leaving the reader
// to combine a toggle with a dropdown that looks like a draft selection.
const CAPTCHA_OFF = "off"

const OPTION_CHOICES = {
  mode: RECAPTCHA_MODES,
  theme: CAPTCHA_THEMES,
  size: CAPTCHA_SIZES,
} as const

const OPTION_CATALOGS = {
  mode: "modes",
  theme: "themes",
  size: "sizes",
} as const

// reCAPTCHA v3 scores range over 0..1; these are the useful stops, and any
// hand-tuned value already in storage is folded in so it stays selectable.
const THRESHOLD_PRESETS = [0.3, 0.5, 0.7, 0.9]

// Paired option selects get narrow on a phone, so the value shrinks and clips
// instead of pushing the chevron out of the control.
const COMPACT_TRIGGER = "gap-2 [&>span]:min-w-0 [&>span]:truncate"

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
  const settings = captcha.providers[provider]
  const enabled = captcha.enabled
  const ChannelIcon = enabled ? PROVIDER_ICONS[provider] : ShieldOff
  const channelLabel = enabled ? t(`captcha.providers.${provider}.name` as never) : t("captcha.off")
  const optionFields = captchaOptionFields(provider, settings.mode)
  // `normalizeCaptchaConfig` builds both documents from the same constant key
  // order, so serialising is a sound deep comparison here.
  const pendingChanges = JSON.stringify(captcha) !== JSON.stringify(liveCaptcha)
  const liveChannelLabel = liveCaptcha.enabled
    ? t(`captcha.providers.${liveCaptcha.provider}.name` as never)
    : t("captcha.off")
  const thresholdChoices = [...new Set([...THRESHOLD_PRESETS, settings.threshold])].sort((a, b) => a - b)

  const patchSettings = (patch: Partial<CaptchaProviderSettings>) => {
    setCaptcha(current => ({
      ...current,
      providers: {
        ...current.providers,
        [current.provider]: { ...current.providers[current.provider], ...patch },
      },
    }))
  }

  const renderOptionField = (field: CaptchaOptionField) => {
    const fieldId = `captcha-${field}`
    const label = (
      <Label htmlFor={fieldId} className="text-xs font-medium">
        {t(`captcha.fields.${field}` as never)}
      </Label>
    )

    if (field === "threshold") {
      return (
        <div key={field} className="min-w-0 space-y-1.5">
          {label}
          <Select
            value={settings.threshold.toFixed(2)}
            onValueChange={value => patchSettings({ threshold: Number(value) })}
          >
            <SelectTrigger id={fieldId} className={COMPACT_TRIGGER}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[var(--radix-select-content-available-height)]">
              {thresholdChoices.map(choice => (
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
          onValueChange={value => patchSettings({ [field]: value } as Partial<CaptchaProviderSettings>)}
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
                onValueChange={value => setCaptcha(current => value === CAPTCHA_OFF
                  ? { ...current, enabled: false }
                  : { ...current, enabled: true, provider: value as CaptchaProviderId })}
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
            <section
              key={provider}
              id="captcha-provider-panel"
              role="region"
              aria-labelledby="captcha-provider-value"
              className="animate-in space-y-3 fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none sm:rounded-md sm:border sm:bg-card/30 sm:p-4"
            >
              <div className="flex items-center gap-3 border-b pb-2.5">
                <p className="hidden min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground sm:block">
                  {t(`captcha.providers.${provider}.description` as never)}
                </p>
                <a
                  href={CAPTCHA_PROVIDERS[provider].consoleUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  {t("captcha.openConsole")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="captcha-site-key" className="text-xs font-medium">
                    {t("captcha.fields.siteKey")}
                  </Label>
                  <Input
                    id="captcha-site-key"
                    className="font-mono"
                    autoComplete="off"
                    spellCheck={false}
                    value={settings.siteKey}
                    onChange={e => patchSettings({ siteKey: e.target.value })}
                    placeholder={t("captcha.placeholders.siteKey")}
                  />
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="captcha-secret-key" className="text-xs font-medium">
                    {t("captcha.fields.secretKey")}
                  </Label>
                  <SecretInput
                    id="captcha-secret-key"
                    autoComplete="new-password"
                    showLabel={t("captcha.showSecret")}
                    hideLabel={t("captcha.hideSecret")}
                    value={settings.secretKey}
                    onChange={e => patchSettings({ secretKey: e.target.value })}
                    placeholder={t("captcha.placeholders.secretKey")}
                  />
                </div>
              </div>

              {/* An odd number of options stretches the last cell instead of
                  leaving a hole next to it. The compact selects pair up from
                  380px — the common phone widths are 390-412 — so a portrait
                  screen no longer gets one long column of boxes. */}
              <div className="grid gap-3 min-[380px]:grid-cols-2 min-[380px]:[&>*:nth-child(odd):last-child]:col-span-2">
                {optionFields.map(renderOptionField)}
              </div>

              {provider === "recaptcha" && settings.mode === "v3" && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t("captcha.hints.threshold")}
                </p>
              )}

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
            </section>
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
