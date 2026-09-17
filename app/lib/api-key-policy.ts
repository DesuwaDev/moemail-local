import { z } from "zod"

export const apiKeyLevels = ["read", "mail", "full"] as const
export type ApiKeyLevel = typeof apiKeyLevels[number]

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  // Older clients only send a name; keep their existing automation working.
  accessLevel: z.enum(apiKeyLevels).default("full"),
  mailboxAddress: z.string().trim().max(320).default(""),
  expiresInDays: z.number().int().min(1).max(365).default(365),
}).strict()

export interface ApiKeyPolicy {
  accessLevel: string
  mailboxId: string | null
}

/** Deny unknown routes for restricted keys, even if a future handler omits a check. */
export function apiKeyAllowsRequest(policy: ApiKeyPolicy, request: Request) {
  let path: string
  try { path = decodeURIComponent(new URL(request.url).pathname).replace(/\/$/u, "") }
  catch { return false }
  const read = request.method === "GET" || request.method === "HEAD"
  if (!apiKeyLevels.includes(policy.accessLevel as ApiKeyLevel)) return false
  if (path === "/api/config") return read || (policy.accessLevel === "full" && !policy.mailboxId)
  if (path.startsWith("/api/config/")) return policy.accessLevel === "full" && !policy.mailboxId
  if (path === "/api/emails") return read
  if (path === "/api/emails/send-permission") {
    return read && (!policy.mailboxId || new URL(request.url).searchParams.get("emailId") === policy.mailboxId)
  }
  if (path === "/api/emails/generate") return !policy.mailboxId && policy.accessLevel !== "read" && request.method === "POST"
  const match = /^\/api\/emails\/([^/]+)(.*)$/u.exec(path)
  if (!match || (policy.mailboxId && match[1] !== policy.mailboxId)) return false
  if (policy.accessLevel === "full") return true
  const suffix = match[2]
  if (policy.accessLevel === "read") {
    // Share links grant access beyond this credential: listing them also requires mail management.
    return read && (suffix === "" || suffix === "/quota" || /^\/[^/]+$/u.test(suffix) && !["/share", "/send"].includes(suffix))
  }
  return suffix === "" || /^\/(?:quota|send|share(?:\/[^/]+)?|messages\/[^/]+\/share(?:\/[^/]+)?|[^/]+)$/u.test(suffix)
}
