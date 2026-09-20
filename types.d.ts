

import type { Locale } from "./app/i18n/config"
import common from "./app/i18n/messages/en/common.json"
import home from "./app/i18n/messages/en/home.json"
import auth from "./app/i18n/messages/en/auth.json"
import metadata from "./app/i18n/messages/en/metadata.json"
import emails from "./app/i18n/messages/en/emails.json"
import profile from "./app/i18n/messages/en/profile.json"
import admin from "./app/i18n/messages/en/admin.json"
import runtime from "./app/i18n/messages/en/runtime.json"
import domains from "./app/i18n/messages/en/domains.json"
import setup from "./app/i18n/messages/en/setup.json"
import api from "./app/i18n/messages/en/api.json"

type AppMessages = {
  common: typeof common
  home: typeof home
  auth: typeof auth
  metadata: typeof metadata
  emails: typeof emails
  profile: typeof profile
  admin: typeof admin
  runtime: typeof runtime
  domains: typeof domains
  setup: typeof setup
  api: typeof api
}

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale
    Messages: AppMessages
  }
}

declare global {
  // Turnstile, reCAPTCHA and hCaptcha all expose the same explicit-render
  // surface; only reCAPTCHA v3 adds the invisible `ready`/`execute` pair, and
  // reCAPTCHA has no `remove`, so callers fall back to `reset`.
  interface CaptchaVendorApi {
    render: (element: HTMLElement | string, options: Record<string, unknown>) => string | number
    reset: (widgetId?: string | number) => void
    remove?: (widgetId: string | number) => void
    ready?: (callback: () => void) => void
    execute?: (siteKey: string, options: { action: string }) => Promise<string>
  }

  interface Window {
    turnstile?: CaptchaVendorApi
    grecaptcha?: CaptchaVendorApi
    hcaptcha?: CaptchaVendorApi
  }

}

declare module "next-auth" {
  interface User {
    roles?: { name: string }[]
    username?: string | null
    providers?: string[]
    bannedAt?: Date | null
    allowRemoteResources?: boolean
    permissions?: string[]
    quotas?: Record<string, number>
    allowedDomains?: string[] | null
  }

  interface Session {
    sessionId?: string
    user: User
  }
}

export {}
