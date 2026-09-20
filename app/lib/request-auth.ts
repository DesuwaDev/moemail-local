import { NextResponse } from "next/server"
import { PERMISSIONS, ROLES, type Permission, type Role } from "./permissions"
import { isSetupCompleted } from "./config/runtime"
import {
  getEffectiveAccessPolicy,
  type EffectiveAccessPolicy,
} from "./access-policies"
import { apiError } from "./api-response"
import { isSameOriginMutation } from "./request-origin"
import { apiKeyAllowsRequest } from "./api-key-policy"

export interface RequestPrincipal {
  userId: string
  roles: Role[]
  kind: "session" | "apiKey"
  access: EffectiveAccessPolicy
  mailboxId?: string | null
  apiKeyAccessLevel?: string
}

export type AuthorizationResult =
  | { ok: true; principal: RequestPrincipal }
  | { ok: false; response: NextResponse }

interface AuthorizationOptions {
  permission?: Permission
}

const validRoles = new Set<Role>(Object.values(ROLES))

export function setupRequiredResponse() {
  if (isSetupCompleted()) return null

  return apiError("SETUP_REQUIRED", 503, {
    headers: { "Cache-Control": "no-store" },
  })
}

function supportsApiKey(pathname: string) {
  return pathname === "/api/emails"
    || pathname.startsWith("/api/emails/")
    || pathname === "/api/config"
    || pathname.startsWith("/api/config/")
}

function normalizeRoles(roleNames: Array<string | null | undefined>): Role[] {
  return roleNames.flatMap(roleName => (
    roleName && validRoles.has(roleName as Role) ? [roleName as Role] : []
  ))
}

export async function authorizeRequest(
  request: Request,
  options: AuthorizationOptions = {}
): Promise<AuthorizationResult> {
  const setupRequired = setupRequiredResponse()
  if (setupRequired) {
    return {
      ok: false,
      response: setupRequired,
    }
  }

  const apiKey = request.headers.get("X-API-Key")
  let unresolvedPrincipal: Omit<RequestPrincipal, "access">

  if (apiKey !== null) {
    if (!supportsApiKey(new URL(request.url).pathname)) {
      return {
        ok: false,
        response: apiError("API_KEY_ROUTE_FORBIDDEN", 403),
      }
    }

    const { getApiKeyPrincipal } = await import("./apiKey")
    const apiKeyPrincipal = await getApiKeyPrincipal(apiKey)
    if (!apiKeyPrincipal) {
      return {
        ok: false,
        response: apiError("API_KEY_INVALID", 401),
      }
    }

    if (!apiKeyAllowsRequest(apiKeyPrincipal, request)) {
      return { ok: false, response: apiError("API_KEY_ROUTE_FORBIDDEN", 403) }
    }

    unresolvedPrincipal = {
      ...apiKeyPrincipal,
      apiKeyAccessLevel: apiKeyPrincipal.accessLevel,
      kind: "apiKey",
    }
  } else {
    const { auth } = await import("./auth")
    const session = await auth()
    if (!session?.user?.id) {
      return {
        ok: false,
        response: apiError("UNAUTHORIZED", 401),
      }
    }

    // Auth.js protects its own authentication endpoints, not business APIs.
    // SameSite cookies still accompany requests from sibling origins.
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !isSameOriginMutation(request)) {
      return { ok: false, response: apiError("CROSS_ORIGIN_FORBIDDEN", 403) }
    }

    unresolvedPrincipal = {
      userId: session.user.id,
      roles: normalizeRoles(session.user.roles?.map(role => role.name) ?? []),
      kind: "session",
    }
  }

  // Do not trust the session/API-key snapshot: an Emperor may have disabled
  // this account after the credential was issued.
  const { isUserBanned } = await import("./user-status")
  const banned = await isUserBanned(unresolvedPrincipal.userId)
  if (banned === null) {
    return {
      ok: false,
      response: apiError("UNAUTHORIZED", 401),
    }
  }
  if (banned) {
    return {
      ok: false,
      response: apiError("USER_BANNED", 403),
    }
  }

  const principal: RequestPrincipal = {
    ...unresolvedPrincipal,
    access: await getEffectiveAccessPolicy(unresolvedPrincipal.userId, unresolvedPrincipal.roles),
  }

  if (principal.kind === "apiKey" && (principal.apiKeyAccessLevel !== "full" || principal.mailboxId)) {
    const allowed = new Set<Permission>([PERMISSIONS.VIEW_EMAIL, PERMISSIONS.VIEW_MESSAGE_CONTENT, PERMISSIONS.DOWNLOAD_ATTACHMENT, PERMISSIONS.RECEIVE_EMAIL])
    if (principal.apiKeyAccessLevel !== "read") {
      if (!principal.mailboxId) allowed.add(PERMISSIONS.CREATE_EMAIL)
      for (const permission of [PERMISSIONS.DELETE_EMAIL, PERMISSIONS.DELETE_MESSAGE, PERMISSIONS.SEND_EMAIL,
        PERMISSIONS.SHARE_EMAIL, PERMISSIONS.PRIVATE_RECIPIENT_DELIVERY]) allowed.add(permission)
    }
    principal.access = {
      ...principal.access,
      permissions: Object.fromEntries(Object.entries(principal.access.permissions).map(([permission, enabled]) =>
        [permission, enabled && allowed.has(permission as Permission)])) as EffectiveAccessPolicy["permissions"],
    }
  }

  if (options.permission && !principal.access.permissions[options.permission]) {
    return {
      ok: false,
      response: apiError("PERMISSION_DENIED", 403),
    }
  }

  if (
    principal.kind === "session"
    && ["POST", "PUT", "PATCH"].includes(request.method)
    && request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json"
  ) {
    return { ok: false, response: apiError("JSON_CONTENT_TYPE_REQUIRED", 415) }
  }

  return { ok: true, principal }
}
