import { randomUUID } from "node:crypto"
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm"
import { z } from "zod"
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server"
import type { ApiErrorCode } from "./api-codes"
import { getConfig } from "./config/runtime"
import { createDb } from "./db"
import { passkeyProviderName } from "./passkey-authenticators"
import { loginSessions, passkeyChallenges, passkeys, users } from "./schema"

export const PASSKEY_LIMIT = 10
export const PASSKEY_NAME_MAX = 64
/** Adding or removing a passkey requires a sign-in or re-verification this recent. */
export const REAUTH_WINDOW_MS = 10 * 60_000
const CHALLENGE_TTL_MS = 5 * 60_000
const CEREMONY_TIMEOUT_MS = 120_000
const ZERO_AAGUID = "00000000-0000-0000-0000-000000000000"
// EdDSA, ES256 and RS256 cover every shipping authenticator. Pinning them also
// skips SimpleWebAuthn's ML-DSA probe, which uses experimental Node Web Crypto.
const SUPPORTED_ALGORITHMS = [-8, -7, -257]
const TRANSPORTS = new Set(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"])

type ChallengePurpose = "authenticate" | "register" | "verify"

export class PasskeyError extends Error {
  constructor(readonly code: ApiErrorCode, readonly status = 400) {
    super(code)
    this.name = "PasskeyError"
  }
}

/**
 * The relying party is pinned to the configured public origin. Browsers refuse
 * WebAuthn on IP literals and on plain HTTP except for localhost, so such
 * deployments report passkeys as unavailable instead of failing mid-ceremony.
 */
export function relyingPartyForBaseUrl(baseUrl: string) {
  const url = new URL(baseUrl)
  const host = url.hostname.toLowerCase()
  const ipLiteral = host.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)
  const local = host === "localhost" || host.endsWith(".localhost")
  if (ipLiteral || (url.protocol !== "https:" && !local)) return null
  return { rpId: host, origin: url.origin }
}

export const passkeyRelyingParty = () => relyingPartyForBaseUrl(getConfig().server.baseUrl)

function requireRelyingParty() {
  const rp = passkeyRelyingParty()
  if (!rp) throw new PasskeyError("PASSKEY_UNAVAILABLE", 409)
  return rp
}

const base64Url = (maximum: number) => z.string().min(1).max(maximum).regex(/^[A-Za-z0-9_-]+$/u)
// Credential IDs are at most 1023 bytes; user handles at most 64 bytes.
const credentialId = base64Url(1400)
const transports = z.array(z.string().max(32)).max(8).optional()

const registrationSchema = z.object({
  id: credentialId,
  rawId: credentialId,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64Url(8192),
    attestationObject: base64Url(65536),
    transports,
  }),
  clientExtensionResults: z.record(z.unknown()).default({}),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
})

const authenticationSchema = z.object({
  id: credentialId,
  rawId: credentialId,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64Url(8192),
    authenticatorData: base64Url(8192),
    signature: base64Url(4096),
    userHandle: base64Url(128).nullish(),
  }),
  clientExtensionResults: z.record(z.unknown()).default({}),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
})

/** Accept a JSON string (Auth.js form field) or an already parsed object. */
function parseResponse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  let value = input
  if (typeof value === "string") {
    if (value.length > 100_000) throw new PasskeyError("PASSKEY_VERIFICATION_FAILED")
    try { value = JSON.parse(value) } catch { throw new PasskeyError("PASSKEY_VERIFICATION_FAILED") }
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success || parsed.data.id !== parsed.data.rawId) throw new PasskeyError("PASSKEY_VERIFICATION_FAILED")
  return parsed.data
}

export function normalizePasskeyName(value: unknown) {
  if (typeof value !== "string") return null
  const name = value.replace(/[\u0000-\u001f\u007f]/gu, "").trim()
  return name.length > 0 && [...name].length <= PASSKEY_NAME_MAX ? name : null
}

const userHandle = (userId: string) => Buffer.from(userId, "utf8").toString("base64url")
const storedTransports = (value: string | null) => {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((item): item is AuthenticatorTransport => typeof item === "string" && TRANSPORTS.has(item)) : []
  } catch { return [] }
}

async function storeChallenge(purpose: ChallengePurpose, challenge: string, userId: string | null = null, sessionId: string | null = null) {
  const db = createDb(), now = new Date(), id = randomUUID()
  // Expired rows are useless; removing them here keeps the indexed table small
  // even when the scheduled cleanup is not running.
  await db.delete(passkeyChallenges).where(lt(passkeyChallenges.expiresAt, now))
  await db.insert(passkeyChallenges).values({ id, purpose, userId, sessionId, challenge, expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS) })
  return id
}

/** Challenges are single use: deleting with RETURNING makes concurrent replays lose. */
async function consumeChallenge(id: unknown, purpose: ChallengePurpose, userId: string | null = null, sessionId: string | null = null) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/u.test(id)) throw new PasskeyError("PASSKEY_CHALLENGE_EXPIRED")
  const [row] = await createDb().delete(passkeyChallenges).where(and(
    eq(passkeyChallenges.id, id),
    eq(passkeyChallenges.purpose, purpose),
    userId ? eq(passkeyChallenges.userId, userId) : isNull(passkeyChallenges.userId),
    sessionId ? eq(passkeyChallenges.sessionId, sessionId) : isNull(passkeyChallenges.sessionId),
  )).returning()
  if (!row || row.expiresAt.getTime() <= Date.now()) throw new PasskeyError("PASSKEY_CHALLENGE_EXPIRED")
  return row.challenge
}

export async function listPasskeys(userId: string) {
  const rows = await createDb().select().from(passkeys).where(eq(passkeys.userId, userId)).orderBy(asc(passkeys.createdAt), asc(passkeys.id))
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    credentialId: row.credentialId,
    provider: passkeyProviderName(row.aaguid),
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    transports: storedTransports(row.transports),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }))
}

export async function countPasskeys(userId: string) {
  const [row] = await createDb().select({ total: sql<number>`COUNT(*)`.mapWith(Number) }).from(passkeys).where(eq(passkeys.userId, userId))
  return row?.total ?? 0
}

export async function createRegistrationOptions(userId: string, sessionId: string) {
  const rp = requireRelyingParty(), db = createDb()
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true, username: true, name: true, email: true } })
  if (!user) throw new PasskeyError("UNAUTHORIZED", 401)
  const existing = await db.select({ id: passkeys.credentialId, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, userId))
  if (existing.length >= PASSKEY_LIMIT) throw new PasskeyError("PASSKEY_LIMIT_REACHED", 409)
  const userName = user.username || user.email || user.name || user.id
  const options = await generateRegistrationOptions({
    rpName: "MoeMail",
    rpID: rp.rpId,
    userName,
    userDisplayName: user.name || userName,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    // Each authenticator may hold only one passkey for this account.
    excludeCredentials: existing.map(item => ({ id: item.id, transports: storedTransports(item.transports) })),
    // Discoverable credentials enable username-less sign-in; UV means the
    // device checked a fingerprint, face, PIN or pattern, not just a tap.
    authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
    supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
    timeout: CEREMONY_TIMEOUT_MS,
  })
  return { challengeId: await storeChallenge("register", options.challenge, userId, sessionId), options }
}

/** Verify a registration ceremony and return the row to persist (see passkey-management). */
export async function verifyRegistration(userId: string, sessionId: string, challengeId: unknown, input: unknown, requestedName: unknown) {
  const rp = requireRelyingParty()
  const response = parseResponse(registrationSchema, input) as RegistrationResponseJSON
  const challenge = await consumeChallenge(challengeId, "register", userId, sessionId)
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
      supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
    })
  } catch {
    throw new PasskeyError("PASSKEY_VERIFICATION_FAILED")
  }
  if (!verification.verified) throw new PasskeyError("PASSKEY_VERIFICATION_FAILED")
  if (await countPasskeys(userId) >= PASSKEY_LIMIT) throw new PasskeyError("PASSKEY_LIMIT_REACHED", 409)

  const info = verification.registrationInfo
  const aaguid = info.aaguid && info.aaguid !== ZERO_AAGUID ? info.aaguid.toLowerCase() : null
  const now = new Date()
  const row = {
    id: randomUUID(),
    userId,
    credentialId: info.credential.id,
    publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
    counter: info.credential.counter,
    transports: JSON.stringify((info.credential.transports ?? []).filter(item => TRANSPORTS.has(item))),
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    aaguid,
    name: normalizePasskeyName(requestedName) ?? passkeyProviderName(aaguid) ?? "",
    createdAt: now,
    lastUsedAt: null,
  }
  const existing = await createDb().query.passkeys.findFirst({ where: eq(passkeys.credentialId, row.credentialId), columns: { id: true } })
  if (existing) throw new PasskeyError("PASSKEY_ALREADY_REGISTERED", 409)
  return row
}

export async function createAuthenticationOptions() {
  const rp = requireRelyingParty()
  const options = await generateAuthenticationOptions({ rpID: rp.rpId, userVerification: "required", timeout: CEREMONY_TIMEOUT_MS })
  return { challengeId: await storeChallenge("authenticate", options.challenge), options }
}

/** Step-up verification offers only the signed-in account's own passkeys. */
export async function createVerificationOptions(userId: string, sessionId: string) {
  const rp = requireRelyingParty()
  const own = await createDb().select({ id: passkeys.credentialId, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, userId))
  if (!own.length) throw new PasskeyError("REAUTH_METHOD_UNAVAILABLE", 409)
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    userVerification: "required",
    timeout: CEREMONY_TIMEOUT_MS,
    allowCredentials: own.map(item => ({ id: item.id, transports: storedTransports(item.transports) })),
  })
  return { challengeId: await storeChallenge("verify", options.challenge, userId, sessionId), options }
}

/**
 * Verify an assertion. Sign-in challenges are anonymous; step-up challenges are
 * bound to the signed-in user and login session, and accept only that user's
 * credentials.
 */
export async function verifyPasskeyAssertion(challengeId: unknown, input: unknown, owner?: { userId: string; sessionId: string }) {
  const rp = requireRelyingParty()
  const response = parseResponse(authenticationSchema, input) as AuthenticationResponseJSON
  const challenge = await consumeChallenge(challengeId, owner ? "verify" : "authenticate", owner?.userId, owner?.sessionId)
  const db = createDb()
  const stored = await db.query.passkeys.findFirst({ where: eq(passkeys.credentialId, response.id) })
  if (!stored || (owner && stored.userId !== owner.userId)) throw new PasskeyError("PASSKEY_NOT_RECOGNIZED", 401)
  // Discoverable credentials return the user handle chosen at registration.
  if (response.response.userHandle && response.response.userHandle !== userHandle(stored.userId)) {
    throw new PasskeyError("PASSKEY_VERIFICATION_FAILED", 401)
  }
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
        counter: stored.counter,
        transports: storedTransports(stored.transports),
      },
    })
  } catch {
    throw new PasskeyError("PASSKEY_VERIFICATION_FAILED", 401)
  }
  if (!verification.verified) throw new PasskeyError("PASSKEY_VERIFICATION_FAILED", 401)
  const info = verification.authenticationInfo
  // Compare-and-set on the signature counter so two racing assertions from a
  // cloned authenticator cannot both succeed.
  const updated = await db.update(passkeys).set({
    counter: info.newCounter,
    backedUp: info.credentialBackedUp,
    deviceType: info.credentialDeviceType,
    lastUsedAt: new Date(),
  }).where(and(eq(passkeys.id, stored.id), eq(passkeys.counter, stored.counter))).returning({ id: passkeys.id })
  if (!updated.length) throw new PasskeyError("PASSKEY_VERIFICATION_FAILED", 401)
  return { userId: stored.userId, passkeyId: stored.id }
}

export async function renamePasskey(userId: string, passkeyId: string, value: unknown) {
  const name = normalizePasskeyName(value)
  if (!name) throw new PasskeyError("PASSKEY_NAME_INVALID")
  const updated = await createDb().update(passkeys).set({ name })
    .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId))).returning({ id: passkeys.id })
  if (!updated.length) throw new PasskeyError("PASSKEY_NOT_FOUND", 404)
  return name
}

/** Freshness of the current login session for sensitive account changes. */
export async function reauthenticationState(userId: string, sessionId: string | undefined) {
  const db = createDb()
  const [session, user, total] = await Promise.all([
    sessionId ? db.query.loginSessions.findFirst({
      where: and(eq(loginSessions.id, sessionId), eq(loginSessions.userId, userId), isNull(loginSessions.revokedAt)),
      columns: { loginAt: true, verifiedAt: true },
    }) : undefined,
    db.query.users.findFirst({ where: eq(users.id, userId), columns: { password: true } }),
    countPasskeys(userId),
  ])
  const latest = Math.max(session?.loginAt?.getTime() ?? 0, session?.verifiedAt?.getTime() ?? 0)
  const until = latest ? latest + REAUTH_WINDOW_MS : 0
  return {
    fresh: until > Date.now(),
    until: until > Date.now() ? new Date(until) : null,
    password: Boolean(user?.password),
    passkey: total > 0,
  }
}

export async function requireRecentAuthentication(userId: string, sessionId: string | undefined) {
  if (!sessionId || !(await reauthenticationState(userId, sessionId)).fresh) throw new PasskeyError("REAUTH_REQUIRED", 403)
}

export async function markSessionVerified(userId: string, sessionId: string) {
  const now = new Date()
  const updated = await createDb().update(loginSessions).set({ verifiedAt: now })
    .where(and(eq(loginSessions.id, sessionId), eq(loginSessions.userId, userId), isNull(loginSessions.revokedAt)))
    .returning({ id: loginSessions.id })
  if (!updated.length) throw new PasskeyError("UNAUTHORIZED", 401)
  return new Date(now.getTime() + REAUTH_WINDOW_MS)
}

export const passkeyUserHandle = userHandle
