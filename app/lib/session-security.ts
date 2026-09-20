import type { JWT } from "next-auth/jwt"
import { eq, sql } from "drizzle-orm"
import { createDb } from "./db"
import { users } from "./schema"

export async function validateSessionToken(token: JWT, signingIn = false): Promise<JWT | null> {
  if (typeof token.id !== "string") return null
  const user = await createDb().query.users.findFirst({
    where: eq(users.id, token.id),
    columns: { sessionVersion: true, bannedAt: true, allowRemoteResources: true },
  })
  if (!user || (signingIn && user.bannedAt)) return null
  if (signingIn) token.sessionVersion = user.sessionVersion
  // Pre-upgrade JWTs stay valid until the first explicit revocation.
  if ((token.sessionVersion ?? 0) !== user.sessionVersion) return null
  // Preserve the existing client-side ban notice and forced sign-out behavior.
  token.bannedAt = user.bannedAt?.toISOString() ?? null
  token.allowRemoteResources = !user.bannedAt && user.allowRemoteResources
  return token
}

export async function revokeUserSessions(userId: string) {
  await createDb().update(users).set({
    sessionVersion: sql`${users.sessionVersion} + 1`,
  }).where(eq(users.id, userId))
}
