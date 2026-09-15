"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CAPTCHA_PROVIDERS, captchaScriptUrls } from "@/lib/captcha/providers"
import type {
  CaptchaChannelConfig,
  CaptchaClientConfig,
  CaptchaProviderId,
  CaptchaScope,
  CaptchaTheme,
} from "@/lib/captcha/providers"

// The channel matters as much as the token: the visitor may have been moved to
// the backup, and the server has to verify against the key pair that minted it.
export interface CaptchaSolution {
  token: string
  provider: CaptchaProviderId
}

export interface CaptchaHandle {
  // Resolves the token to submit, or an empty one when the challenge has not
  // been solved. It never rejects, so callers branch on the value alone.
  ensureToken: (scope: CaptchaScope) => Promise<CaptchaSolution>
  reset: () => void
}

interface CaptchaProps {
  config: CaptchaClientConfig
  scope: CaptchaScope
  className?: string
}

// One in-flight promise per script URL: two mounts (or React's development
// double-effect) must not append the vendor bundle twice.
const scriptLoads = new Map<string, Promise<boolean>>()

function loadScript(src: string) {
  const cached = scriptLoads.get(src)
  if (cached) return cached

  const load = new Promise<boolean>(resolve => {
    const script = document.createElement("script")
    script.src = src
    script.async = true
    script.defer = true
    script.addEventListener("load", () => resolve(true))
    script.addEventListener("error", () => {
      // Drop the cache entry so the retry button can append a fresh tag.
      scriptLoads.delete(src)
      resolve(false)
    })
    document.head.appendChild(script)
  })

  scriptLoads.set(src, load)
  return load
}

function waitFor(ready: () => boolean, timeoutMs = 10_000) {
  if (ready()) return Promise.resolve(true)
  return new Promise<boolean>(resolve => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      if (ready()) {
        window.clearInterval(timer)
        resolve(true)
      } else if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer)
        resolve(false)
      }
    }, 50)
  })
}

function vendorApi(provider: CaptchaProviderId) {
  if (provider === "recaptcha" || provider === "recaptchaV3") return window.grecaptcha
  if (provider === "hcaptcha") return window.hcaptcha
  return window.turnstile
}

const PROBE_TIMEOUT_MS = 3_500

// One probe per URL: the answer is the same for every mount on the page.
const originProbes = new Map<string, Promise<boolean>>()

// A regional mirror has to be chosen before a single vendor bundle is appended,
// because two copies of api.js would leave two vendor globals fighting over one
// widget. A no-cors request settles it without executing anything — a filtered
// origin rejects (reset or timeout), a reachable one resolves opaque — and it
// warms the browser cache for the script tag that follows.
function probeScript(url: string) {
  const cached = originProbes.get(url)
  if (cached) return cached

  const probe = (async () => {
    try {
      await fetch(url, { mode: "no-cors", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      return true
    } catch {
      // A filtered origin and a browser without `AbortSignal.timeout` land here
      // alike; both mean "cannot vouch for this origin", which is all the
      // caller asks.
      return false
    }
  })()

  originProbes.set(url, probe)
  return probe
}

async function resolveScript(channel: CaptchaChannelConfig, locale: string) {
  const urls = captchaScriptUrls(channel, locale)
  if (urls.length === 1) return urls[0]

  for (const url of urls) {
    if (await probeScript(url)) return url
  }

  // Nothing answered, so the probe itself is the suspect — a strict connect-src
  // or an extension blocks fetch while leaving script tags alone. Fall back to
  // the default origin and let the script speak for itself.
  return urls[0]
}

// Only Turnstile has an "auto" theme; the others need a concrete value, and
// this project drives dark mode with a class on the root element.
function resolveTheme(theme: CaptchaTheme) {
  if (theme !== "auto") return theme
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

export const Captcha = forwardRef<CaptchaHandle, CaptchaProps>(function Captcha(
  { config, scope, className },
  ref,
) {
  const t = useTranslations("auth.loginForm.captcha")
  const locale = useLocale()
  const frameRef = useRef<HTMLDivElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | number | null>(null)
  const tokenRef = useRef("")
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [usingFallback, setUsingFallback] = useState(false)
  const [scale, setScale] = useState(1)
  const [naturalHeight, setNaturalHeight] = useState(0)

  // Everything below reads the channel in play rather than the document, so the
  // switch to the backup is a change of inputs and not a second code path.
  const channel: CaptchaChannelConfig = usingFallback && config.fallback ? config.fallback : config
  const { provider, siteKey, theme, size, endpoint } = channel
  const invisible = CAPTCHA_PROVIDERS[provider].scoreBased
  const active = config.enabled && config.scopes[scope]
  const canFallBack = !usingFallback && config.fallback !== null

  useEffect(() => {
    if (!active) return

    let cancelled = false
    // Remembering the exact node that was rendered into keeps teardown honest:
    // the ref may already point elsewhere (or nowhere) by cleanup time.
    let mounted: HTMLDivElement | null = null
    const hasApi = () => {
      const api = vendorApi(provider)
      return Boolean(invisible ? api?.execute : api?.render)
    }

    // A bundle that never arrives, and a key the vendor refuses, both leave the
    // visitor with nothing to solve. The backup gets its turn before they are
    // asked to retry, because retrying the same channel repeats the same
    // request to the same origin with the same key.
    const giveUp = () => {
      if (canFallBack) setUsingFallback(true)
      else setFailed(true)
    }

    const start = async () => {
      const script = await resolveScript(channel, locale)
      if (cancelled) return

      const loaded = (await loadScript(script)) && (await waitFor(hasApi))
      if (cancelled) return
      if (!loaded) {
        giveUp()
        return
      }
      setFailed(false)
      if (invisible) return

      const api = vendorApi(provider)
      const frame = boxRef.current
      if (!api || !frame) return

      // Render into a throwaway child: reCAPTCHA refuses to reuse a container
      // it has already populated, and this keeps every remount symmetric.
      const host = document.createElement("div")
      frame.replaceChildren(host)
      mounted = frame

      const onToken = (token: string) => { tokenRef.current = token }
      const onCleared = () => { tokenRef.current = "" }

      try {
        widgetIdRef.current = api.render(host, {
          sitekey: siteKey,
          theme: provider === "turnstile" ? theme : resolveTheme(theme),
          size,
          ...(provider === "turnstile" ? { language: locale.toLowerCase() } : { hl: locale }),
          callback: onToken,
          "error-callback": onCleared,
          "expired-callback": onCleared,
        })
      } catch (error) {
        console.error("captcha.render_failed", error)
        giveUp()
      }
    }

    void start()

    return () => {
      cancelled = true
      tokenRef.current = ""
      const api = vendorApi(provider)
      const widgetId = widgetIdRef.current
      widgetIdRef.current = null
      try {
        if (widgetId !== null && api) {
          if (api.remove) api.remove(widgetId)
          else api.reset(widgetId)
        }
      } catch (error) {
        console.error("captcha.teardown_failed", error)
      }
      mounted?.replaceChildren()
    }
    // `config` is consumed through the primitives below; listing the object
    // would re-render the widget on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, provider, siteKey, theme, size, endpoint, locale, invisible, usingFallback, attempt])

  // The widgets ship fixed pixel widths (up to ~304px) that overflow a phone
  // sized card, so the rendered box is scaled down to whatever room it has and
  // the wrapper adopts the scaled height. At full size the maths is a no-op.
  useEffect(() => {
    const frame = frameRef.current
    const box = boxRef.current
    if (!frame || !box) return

    const measure = () => {
      // ResizeObserver reports untransformed boxes, so this cannot feed back.
      const available = frame.clientWidth
      const natural = box.offsetWidth
      setNaturalHeight(box.offsetHeight)
      setScale(natural > 0 && available > 0 ? Math.min(1, available / natural) : 1)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    observer.observe(box)
    measure()
    return () => observer.disconnect()
  }, [active, invisible])

  const runInvisibleChallenge = useCallback(async (tokenScope: CaptchaScope) => {
    const api = window.grecaptcha
    if (!api?.execute) return ""
    try {
      if (api.ready) await new Promise<void>(resolve => api.ready!(resolve))
      return await api.execute(siteKey, { action: tokenScope })
    } catch (error) {
      console.error("captcha.execute_failed", error)
      return ""
    }
  }, [siteKey])

  useImperativeHandle(ref, () => ({
    ensureToken: async (tokenScope: CaptchaScope) => {
      if (!active) return { token: "", provider }
      if (invisible) return { token: await runInvisibleChallenge(tokenScope), provider }
      return { token: tokenRef.current, provider }
    },
    reset: () => {
      tokenRef.current = ""
      if (invisible) return
      try {
        const api = vendorApi(provider)
        if (widgetIdRef.current !== null && api) api.reset(widgetIdRef.current)
      } catch (error) {
        console.error("captcha.reset_failed", error)
      }
    },
  }), [active, invisible, provider, runInvisibleChallenge])

  if (!active) return null

  if (failed) {
    return (
      <div className={cn("flex flex-wrap items-center justify-center gap-2 text-center", className)}>
        <p className="text-xs text-destructive">{t("loadFailed")}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => {
            setFailed(false)
            // Conditions may have changed since the origins were probed, so the
            // retry gets to pick a different mirror instead of repeating the
            // choice that just failed, and starts from the primary channel
            // again rather than settling for the backup.
            originProbes.clear()
            setUsingFallback(false)
            setAttempt(value => value + 1)
          }}
        >
          {t("retry")}
        </Button>
      </div>
    )
  }

  // Says why the challenge on screen is not the one the site normally shows, so
  // a visitor who knows the site does not read the swap as a spoof.
  const fallbackNotice = usingFallback
    ? <p className="text-center text-[11px] leading-relaxed text-muted-foreground">{t("fallbackNotice")}</p>
    : null

  // reCAPTCHA v3 has no visible widget. Its floating badge is hidden in
  // `globals.css` because it sits on top of the page's own corner button, so
  // Google's attribution has to appear here instead.
  if (invisible) {
    return (
      <div className={cn("space-y-1", className)}>
        {fallbackNotice}
        <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center text-[11px] leading-relaxed text-muted-foreground">
          <span>{t("recaptchaNotice")}</span>
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-primary"
          >
            {t("recaptchaPrivacy")}
          </a>
          <a
            href="https://policies.google.com/terms"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-primary"
          >
            {t("recaptchaTerms")}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("space-y-1", className)}>
      {fallbackNotice}
      <div
        ref={frameRef}
        className="flex w-full items-start justify-center overflow-hidden"
        style={naturalHeight > 0 ? { height: Math.ceil(naturalHeight * scale) } : undefined}
      >
        <div
          ref={boxRef}
          className="shrink-0 origin-top"
          style={scale < 1 ? { transform: `scale(${scale})` } : undefined}
        />
      </div>
    </div>
  )
})
