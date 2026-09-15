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
import { CAPTCHA_PROVIDERS } from "@/lib/captcha/providers"
import type {
  CaptchaClientConfig,
  CaptchaProviderId,
  CaptchaScope,
  CaptchaTheme,
} from "@/lib/captcha/providers"

export interface CaptchaHandle {
  // Resolves the token to submit, or an empty string when the challenge has not
  // been solved. It never rejects, so callers branch on the value alone.
  ensureToken: (scope: CaptchaScope) => Promise<string>
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

function vendorScript(config: CaptchaClientConfig, locale: string) {
  // reCAPTCHA takes its language from the script URL, and the score-based
  // generation binds the site key there instead of at render time.
  if (config.provider === "recaptchaV3") {
    const key = encodeURIComponent(config.siteKey)
    return `https://www.google.com/recaptcha/api.js?render=${key}&hl=${encodeURIComponent(locale)}`
  }
  if (config.provider === "recaptcha") {
    return `https://www.google.com/recaptcha/api.js?render=explicit&hl=${encodeURIComponent(locale)}`
  }
  if (config.provider === "hcaptcha") return "https://js.hcaptcha.com/1/api.js?render=explicit"
  return "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
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
  const [scale, setScale] = useState(1)
  const [naturalHeight, setNaturalHeight] = useState(0)

  const { provider, siteKey, theme, size } = config
  const invisible = CAPTCHA_PROVIDERS[provider].scoreBased
  const active = config.enabled && config.scopes[scope]

  useEffect(() => {
    if (!active) return

    let cancelled = false
    // Remembering the exact node that was rendered into keeps teardown honest:
    // the ref may already point elsewhere (or nowhere) by cleanup time.
    let mounted: HTMLDivElement | null = null
    const script = vendorScript(config, locale)
    const hasApi = () => {
      const api = vendorApi(provider)
      return Boolean(invisible ? api?.execute : api?.render)
    }

    const start = async () => {
      const loaded = (await loadScript(script)) && (await waitFor(hasApi))
      if (cancelled) return
      setFailed(!loaded)
      if (!loaded || invisible) return

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
        setFailed(true)
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
  }, [active, provider, siteKey, theme, size, locale, invisible, attempt])

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
      if (!active) return ""
      if (invisible) return runInvisibleChallenge(tokenScope)
      return tokenRef.current
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
            setAttempt(value => value + 1)
          }}
        >
          {t("retry")}
        </Button>
      </div>
    )
  }

  // reCAPTCHA v3 has no visible widget. Its floating badge is hidden in
  // `globals.css` because it sits on top of the page's own corner button, so
  // Google's attribution has to appear here instead.
  if (invisible) {
    return (
      <div className={cn(
        "flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center text-[11px] leading-relaxed text-muted-foreground",
        className,
      )}>
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
    )
  }

  return (
    <div
      ref={frameRef}
      className={cn("flex w-full items-start justify-center overflow-hidden", className)}
      style={naturalHeight > 0 ? { height: Math.ceil(naturalHeight * scale) } : undefined}
    >
      <div
        ref={boxRef}
        className="shrink-0 origin-top"
        style={scale < 1 ? { transform: `scale(${scale})` } : undefined}
      />
    </div>
  )
})
