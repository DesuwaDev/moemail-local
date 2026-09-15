import { PERMISSIONS, Role, ROLES } from "@/lib/permissions"
import { EMAIL_CONFIG } from "@/config"
import { CONFIG_KEYS, getConfigValues, setConfigValues } from "@/lib/config-store"
import { authorizeRequest } from "@/lib/request-auth"
import { normalizeMailboxDomain } from "@/lib/email-address"
import {
  getDomainPolicies,
  publicDomainPolicy,
  saveDomainPolicies,
} from "@/lib/domain-policies"
import { apiError } from "@/lib/api-response"
import { getCaptchaConfig, saveCaptchaConfig } from "@/lib/captcha/config"
import { CAPTCHA_SCOPES, captchaProviderReady, normalizeCaptchaConfig } from "@/lib/captcha/providers"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const authorization = await authorizeRequest(request)
  if (!authorization.ok) return authorization.response

  const canManageConfig = authorization.principal.access.permissions[PERMISSIONS.MANAGE_CONFIG]
  const [config, domainPolicies, captcha] = await Promise.all([
    getConfigValues([
    CONFIG_KEYS.DEFAULT_ROLE,
    CONFIG_KEYS.ADMIN_CONTACT,
    CONFIG_KEYS.MAX_EMAILS,
    ]),
    getDomainPolicies(),
    canManageConfig ? getCaptchaConfig() : Promise.resolve(null),
  ])
  const availableDomainPolicies = authorization.principal.access.allowedDomains === null
    ? domainPolicies
    : domainPolicies.filter(policy => (
      authorization.principal.access.allowedDomains?.includes(policy.domain)
    ))

  return Response.json({
    defaultRole: config.DEFAULT_ROLE || ROLES.CIVILIAN,
    emailDomains: availableDomainPolicies.map(policy => policy.domain).join(","),
    domains: availableDomainPolicies.map(publicDomainPolicy),
    adminContact: config.ADMIN_CONTACT || "",
    maxEmails: config.MAX_EMAILS || EMAIL_CONFIG.MAX_ACTIVE_EMAILS.toString(),
    captcha: captcha ?? undefined,
  })
}

export async function POST(request: Request) {
  const authorization = await authorizeRequest(request, {
    permission: PERMISSIONS.MANAGE_CONFIG,
  })
  if (!authorization.ok) return authorization.response

  const {
    defaultRole,
    emailDomains,
    adminContact,
    maxEmails,
    captcha
  } = await request.json() as {
    defaultRole: Exclude<Role, typeof ROLES.EMPEROR>,
    emailDomains?: string,
    adminContact: string,
    maxEmails?: string,
    captcha?: unknown
  }
  
  if (![ROLES.DUKE, ROLES.KNIGHT, ROLES.CIVILIAN].includes(defaultRole)) {
    return apiError("INVALID_ROLE", 400)
  }

  let configuredDomains: string[] | null = null
  if (emailDomains !== undefined) {
    const normalizedDomains = typeof emailDomains === "string"
      ? emailDomains.split(",").map(domain => normalizeMailboxDomain(domain))
      : []
    if (
      normalizedDomains.length === 0
      || normalizedDomains.some(domain => !domain)
      || new Set(normalizedDomains).size !== normalizedDomains.length
    ) {
      return apiError("INVALID_MAIL_DOMAINS", 400)
    }
    configuredDomains = normalizedDomains as string[]
  }

  let parsedMaxEmails: number | null = null
  if (maxEmails !== undefined) {
    parsedMaxEmails = Number(maxEmails)
    if (!Number.isSafeInteger(parsedMaxEmails) || parsedMaxEmails < 1 || parsedMaxEmails > 100_000) {
      return apiError("INVALID_MAX_EMAILS", 400)
    }
  }

  // Absent means "leave the stored captcha alone", matching how the optional
  // domain and quota fields behave.
  const captchaConfig = captcha === undefined ? null : normalizeCaptchaConfig(captcha)

  if (captchaConfig?.enabled) {
    if (!captchaProviderReady(captchaConfig.providers[captchaConfig.provider])) {
      return apiError("CAPTCHA_KEYS_REQUIRED", 400)
    }
    if (!CAPTCHA_SCOPES.some(scope => captchaConfig.scopes[scope])) {
      return apiError("CAPTCHA_SCOPE_REQUIRED", 400)
    }
  }

  await setConfigValues({
    DEFAULT_ROLE: defaultRole,
    ADMIN_CONTACT: adminContact,
    ...(parsedMaxEmails === null ? {} : { MAX_EMAILS: parsedMaxEmails.toString() }),
  })
  if (captchaConfig) await saveCaptchaConfig(captchaConfig)

  if (configuredDomains) {
    const currentPolicies = await getDomainPolicies()
    await saveDomainPolicies(configuredDomains.map(domain => (
      currentPolicies.find(policy => policy.domain === domain) ?? {
        domain,
        usageWarning: false,
        inbound: { mode: "worker" as const },
        outbound: { mode: "disabled" as const },
      }
    )))
  }

  return Response.json({ success: true })
} 
