import assert from "node:assert/strict"
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, unwatchFile } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { and, eq } from "drizzle-orm"

/*
 * Exercises passkey registration, sign-in, step-up verification and removal
 * against a real database with a software authenticator: genuine P-256 keys,
 * CBOR attestation objects and ECDSA assertions, plus the attacks the server
 * must reject (replay, wrong origin/RP, missing UV, counter regression, foreign
 * credentials and cross-session challenges).
 */

const root = process.cwd()
const scratch = resolve(root, "node_modules/.cache/passkeys")
mkdirSync(scratch, { recursive: true })
const temporaryRoot = mkdtempSync(join(scratch, "run-"))
const postgresUrl = process.argv.find(arg => arg.startsWith("--postgres-url="))?.slice(15)
const load = (file: string) => import(pathToFileURL(resolve(root, file)).href)
const origin = "https://mail.passkey.test"
const rpId = "mail.passkey.test"
const GOOGLE_PASSWORD_MANAGER = "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4"
let closeDatabase: (() => Promise<void>) | undefined

const b64 = (value: Uint8Array | string) => Buffer.from(value).toString("base64url")
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest()

function cbor(value: unknown): Buffer {
  const head = (major: number, length: number) => {
    if (length < 24) return Buffer.from([(major << 5) | length])
    if (length < 256) return Buffer.from([(major << 5) | 24, length])
    const bytes = Buffer.alloc(3)
    bytes[0] = (major << 5) | 25
    bytes.writeUInt16BE(length, 1)
    return bytes
  }
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value)
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8")
    return Buffer.concat([head(3, bytes.length), bytes])
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)])
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)])])
  throw new Error("CBOR_UNSUPPORTED")
}

const FLAG_UP = 0x01, FLAG_UV = 0x04, FLAG_BE = 0x08, FLAG_BS = 0x10, FLAG_AT = 0x40

/** A minimal platform authenticator producing "none" attestation. */
class SoftAuthenticator {
  readonly credentialId = randomBytes(32)
  readonly keys: { publicKey: KeyObject; privateKey: KeyObject } = generateKeyPairSync("ec", { namedCurve: "P-256" })
  counter = 0
  userHandle = ""
  constructor(readonly settings: { counter?: boolean; synced?: boolean; aaguid?: string } = {}) {}

  private flags(extra: number) {
    return FLAG_UP | FLAG_UV | (this.settings.synced ? FLAG_BE | FLAG_BS : 0) | extra
  }

  register(options: { challenge: string; rp: { id?: string }; user: { id: string } }, overrides: { origin?: string; flags?: number } = {}) {
    this.userHandle = options.user.id
    const jwk = this.keys.publicKey.export({ format: "jwk" })
    const coseKey = new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]])
    const aaguid = Buffer.from((this.settings.aaguid ?? "00000000-0000-0000-0000-000000000000").replaceAll("-", ""), "hex")
    const idLength = Buffer.alloc(2)
    idLength.writeUInt16BE(this.credentialId.length)
    const authData = Buffer.concat([
      sha256(options.rp.id ?? rpId),
      Buffer.from([overrides.flags ?? this.flags(FLAG_AT)]),
      Buffer.alloc(4),
      aaguid, idLength, this.credentialId, cbor(coseKey),
    ])
    const clientData = JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: overrides.origin ?? origin, crossOrigin: false })
    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64(clientData),
        attestationObject: b64(cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))),
        transports: ["internal", "hybrid"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    }
  }

  assert(options: { challenge: string; rpId?: string }, overrides: { origin?: string; flags?: number; counter?: number; userHandle?: string; rpId?: string; tamper?: boolean } = {}) {
    if (this.settings.counter) this.counter = overrides.counter ?? this.counter + 1
    const counter = Buffer.alloc(4)
    counter.writeUInt32BE(this.settings.counter ? this.counter : 0)
    const authData = Buffer.concat([sha256(overrides.rpId ?? options.rpId ?? rpId), Buffer.from([overrides.flags ?? this.flags(0)]), counter])
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: overrides.origin ?? origin, crossOrigin: false }))
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientData)]), this.keys.privateKey)
    if (overrides.tamper) signature[signature.length - 1] ^= 0xff
    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64(clientData),
        authenticatorData: b64(authData),
        signature: b64(signature),
        userHandle: overrides.userHandle ?? this.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    }
  }
}

async function rejects(work: () => Promise<unknown>, code: string, message: string) {
  await assert.rejects(work, (error: { code?: string }) => {
    assert.equal(error.code, code, message)
    return true
  })
}

try {
  for (const folder of ["drizzle-local", "drizzle-postgres"]) cpSync(resolve(root, folder), join(temporaryRoot, folder), { recursive: true })
  process.chdir(temporaryRoot)
  const setup = await load("app/lib/setup-service.ts")
  assert.equal((await setup.completeSetup({
    config: { server: { baseUrl: origin }, database: postgresUrl
      ? { driver: "postgres", postgres: { url: postgresUrl } }
      : { driver: "sqlite", sqlite: { path: "data/passkeys.db" } } },
    admin: { username: "passkey-owner", password: "passkey-test-password-123" },
  })).ok, true)
  if (postgresUrl) (globalThis as typeof globalThis & { __moemailBoundDriver?: string }).__moemailBoundDriver = "postgres"
  const database = await load("app/lib/db.ts")
  closeDatabase = database.closeDatabase
  const schema = await load("app/lib/schema.ts")
  const db = database.createDb()
  const passkeys = await load("app/lib/passkeys.ts")
  const management = await load("app/lib/passkey-management.ts")
  const { validateSessionToken } = await load("app/lib/session-security.ts")
  const [owner] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, "passkey-owner"))
  const [other] = await db.insert(schema.users).values({ username: "passkey-other" }).returning()

  // Relying party rules: HTTPS domains or localhost only, never IP literals.
  assert.deepEqual(passkeys.passkeyRelyingParty(), { rpId, origin })
  assert.deepEqual(passkeys.relyingPartyForBaseUrl("https://Mail.Example.test:8443/app"), { rpId: "mail.example.test", origin: "https://mail.example.test:8443" })
  assert.deepEqual(passkeys.relyingPartyForBaseUrl("http://localhost:3000"), { rpId: "localhost", origin: "http://localhost:3000" })
  for (const unavailable of ["http://mail.example.test", "http://127.0.0.1:3000", "https://203.0.113.9", "https://[::1]:8443"]) {
    assert.equal(passkeys.relyingPartyForBaseUrl(unavailable), null, unavailable)
  }

  const sessionA = (await validateSessionToken({ id: owner.id }, true, { provider: "credentials" }))!.loginSessionId as string
  const sessionB = (await validateSessionToken({ id: owner.id }, true, { provider: "credentials" }))!.loginSessionId as string
  const otherSession = (await validateSessionToken({ id: other.id }, true, { provider: "credentials" }))!.loginSessionId as string

  // Step-up freshness follows the latest sign-in or verification.
  assert.equal((await passkeys.reauthenticationState(owner.id, sessionA)).fresh, true, "a fresh sign-in may change passkeys")
  await db.update(schema.loginSessions).set({ loginAt: new Date(Date.now() - 11 * 60_000) }).where(eq(schema.loginSessions.id, sessionA))
  const stale = await passkeys.reauthenticationState(owner.id, sessionA)
  assert.deepEqual({ fresh: stale.fresh, password: stale.password, passkey: stale.passkey }, { fresh: false, password: true, passkey: false })
  await rejects(() => passkeys.requireRecentAuthentication(owner.id, sessionA), "REAUTH_REQUIRED", "stale sessions must re-verify")
  await rejects(() => passkeys.requireRecentAuthentication(owner.id, undefined), "REAUTH_REQUIRED", "API keys have no session")
  await passkeys.markSessionVerified(owner.id, sessionA)
  assert.equal((await passkeys.reauthenticationState(owner.id, sessionA)).fresh, true)
  await rejects(() => passkeys.markSessionVerified(other.id, sessionA), "UNAUTHORIZED", "another user's session cannot be verified")

  // Registration options demand discoverable, user-verified, unattested credentials.
  const phone = new SoftAuthenticator({ synced: true, aaguid: GOOGLE_PASSWORD_MANAGER })
  const first = await passkeys.createRegistrationOptions(owner.id, sessionA)
  assert.equal(first.options.rp.id, rpId)
  assert.equal(first.options.user.id, b64(owner.id))
  assert.equal(first.options.attestation, "none")
  assert.equal(first.options.authenticatorSelection.residentKey, "required")
  assert.equal(first.options.authenticatorSelection.userVerification, "required")
  assert.deepEqual(first.options.excludeCredentials, [])
  assert.deepEqual(first.options.pubKeyCredParams.map((item: { alg: number }) => item.alg), [-8, -7, -257])
  const firstResponse = phone.register(first.options)
  await rejects(() => passkeys.verifyRegistration(owner.id, sessionB, first.challengeId, firstResponse, "Phone"), "PASSKEY_CHALLENGE_EXPIRED", "challenges are bound to their login session")
  await rejects(() => passkeys.verifyRegistration(other.id, otherSession, first.challengeId, firstResponse, "Phone"), "PASSKEY_CHALLENGE_EXPIRED", "challenges are bound to their user")
  const row = await passkeys.verifyRegistration(owner.id, sessionA, first.challengeId, firstResponse, "  Phone\u0007  ")
  assert.equal(row.name, "Phone", "names are trimmed and stripped of control characters")
  assert.equal(row.backedUp, true)
  assert.equal(row.deviceType, "multiDevice")
  assert.equal(row.aaguid, GOOGLE_PASSWORD_MANAGER)
  await management.savePasskey(owner.id, row)
  await rejects(() => passkeys.verifyRegistration(owner.id, sessionA, first.challengeId, firstResponse, "Phone"), "PASSKEY_CHALLENGE_EXPIRED", "registration challenges are single use")

  const [listed] = await passkeys.listPasskeys(owner.id)
  assert.equal(listed.provider, "Google Password Manager")
  assert.deepEqual(listed.transports, ["internal", "hybrid"])
  assert.equal(listed.lastUsedAt, null)

  const duplicate = await passkeys.createRegistrationOptions(owner.id, sessionA)
  assert.deepEqual(duplicate.options.excludeCredentials?.map((item: { id: string }) => item.id), [listed.credentialId], "authenticators are told which credentials exist")
  await rejects(() => passkeys.verifyRegistration(owner.id, sessionA, duplicate.challengeId, phone.register(duplicate.options), "Again"), "PASSKEY_ALREADY_REGISTERED", "a credential registers once")

  const laptop = new SoftAuthenticator({ counter: true })
  const phished = await passkeys.createRegistrationOptions(owner.id, sessionA)
  await rejects(() => passkeys.verifyRegistration(owner.id, sessionA, phished.challengeId, laptop.register(phished.options, { origin: "https://mail.passkey.test.evil" }), "Evil"), "PASSKEY_VERIFICATION_FAILED", "foreign origins are rejected")
  const noUv = await passkeys.createRegistrationOptions(owner.id, sessionA)
  await rejects(() => passkeys.verifyRegistration(owner.id, sessionA, noUv.challengeId, laptop.register(noUv.options, { flags: FLAG_UP | FLAG_AT }), "Tap only"), "PASSKEY_VERIFICATION_FAILED", "user verification is required")
  const expired = await passkeys.createRegistrationOptions(owner.id, sessionA)
  await db.update(schema.passkeyChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.passkeyChallenges.id, expired.challengeId))
  await rejects(() => passkeys.verifyRegistration(owner.id, sessionA, expired.challengeId, laptop.register(expired.options), "Late"), "PASSKEY_CHALLENGE_EXPIRED", "expired challenges fail")
  const laptopOptions = await passkeys.createRegistrationOptions(owner.id, sessionA)
  const laptopRow = await passkeys.verifyRegistration(owner.id, sessionA, laptopOptions.challengeId, laptop.register(laptopOptions.options), "x".repeat(65))
  assert.equal(laptopRow.name, "", "over-long names fall back to the provider name or an unnamed passkey")
  assert.equal(laptopRow.backedUp, false)
  await management.savePasskey(owner.id, laptopRow)

  // Username-less sign-in.
  const login = await passkeys.createAuthenticationOptions()
  assert.equal(login.options.userVerification, "required")
  assert.equal(login.options.allowCredentials, undefined, "sign-in lets the browser discover the account")
  const loginAssertion = phone.assert(login.options)
  assert.deepEqual(await passkeys.verifyPasskeyAssertion(login.challengeId, JSON.stringify(loginAssertion)), { userId: owner.id, passkeyId: row.id })
  await rejects(() => passkeys.verifyPasskeyAssertion(login.challengeId, loginAssertion), "PASSKEY_CHALLENGE_EXPIRED", "an assertion cannot be replayed")
  assert.ok((await passkeys.listPasskeys(owner.id)).find((item: { id: string }) => item.id === row.id).lastUsedAt)

  const unknown = await passkeys.createAuthenticationOptions()
  const stranger = new SoftAuthenticator()
  stranger.userHandle = b64(owner.id)
  await rejects(() => passkeys.verifyPasskeyAssertion(unknown.challengeId, stranger.assert(unknown.options)), "PASSKEY_NOT_RECOGNIZED", "unregistered credentials are unknown")
  for (const [overrides, message] of [
    [{ tamper: true }, "signatures are checked"],
    [{ origin: "https://evil.test" }, "the origin is checked"],
    [{ rpId: "evil.test" }, "the RP ID hash is checked"],
    [{ flags: FLAG_UP }, "user verification is required at sign-in"],
    [{ userHandle: b64(other.id) }, "the user handle must match the credential owner"],
  ] as const) {
    const attempt = await passkeys.createAuthenticationOptions()
    await rejects(() => passkeys.verifyPasskeyAssertion(attempt.challengeId, phone.assert(attempt.options, overrides)), "PASSKEY_VERIFICATION_FAILED", message)
  }
  await rejects(() => passkeys.verifyPasskeyAssertion("not-a-challenge", phone.assert(login.options)), "PASSKEY_CHALLENGE_EXPIRED", "malformed challenge IDs fail closed")
  await rejects(() => passkeys.verifyPasskeyAssertion(login.challengeId, "{"), "PASSKEY_VERIFICATION_FAILED", "malformed JSON fails closed")

  // Signature counters must increase for authenticators that keep one.
  const counted = await passkeys.createAuthenticationOptions()
  await passkeys.verifyPasskeyAssertion(counted.challengeId, laptop.assert(counted.options, { counter: 5 }))
  const cloned = await passkeys.createAuthenticationOptions()
  await rejects(() => passkeys.verifyPasskeyAssertion(cloned.challengeId, laptop.assert(cloned.options, { counter: 3 })), "PASSKEY_VERIFICATION_FAILED", "a counter regression indicates a cloned authenticator")
  const [storedLaptop] = await db.select().from(schema.passkeys).where(eq(schema.passkeys.id, laptopRow.id))
  assert.equal(storedLaptop.counter, 5)

  // Step-up verification accepts only the signed-in user's own passkeys.
  const otherKey = new SoftAuthenticator()
  await rejects(() => passkeys.createVerificationOptions(other.id, otherSession), "REAUTH_METHOD_UNAVAILABLE", "users without passkeys verify another way")
  const otherRegistration = await passkeys.createRegistrationOptions(other.id, otherSession)
  await management.savePasskey(other.id, await passkeys.verifyRegistration(other.id, otherSession, otherRegistration.challengeId, otherKey.register(otherRegistration.options), "Other"))
  const verify = await passkeys.createVerificationOptions(owner.id, sessionB)
  assert.deepEqual(new Set(verify.options.allowCredentials.map((item: { id: string }) => item.id)), new Set([b64(phone.credentialId), b64(laptop.credentialId)]))
  await rejects(() => passkeys.verifyPasskeyAssertion(verify.challengeId, otherKey.assert(verify.options), { userId: owner.id, sessionId: sessionB }), "PASSKEY_NOT_RECOGNIZED", "another user's passkey cannot verify this account")
  const signInWithStepUp = await passkeys.createVerificationOptions(owner.id, sessionB)
  await rejects(() => passkeys.verifyPasskeyAssertion(signInWithStepUp.challengeId, phone.assert(signInWithStepUp.options)), "PASSKEY_CHALLENGE_EXPIRED", "step-up challenges cannot sign in")
  const stepUp = await passkeys.createVerificationOptions(owner.id, sessionB)
  await passkeys.verifyPasskeyAssertion(stepUp.challengeId, phone.assert(stepUp.options), { userId: owner.id, sessionId: sessionB })

  // Rename and remove are scoped to the owner and audited.
  assert.equal(await passkeys.renamePasskey(owner.id, laptopRow.id, "  Work laptop "), "Work laptop")
  await rejects(() => passkeys.renamePasskey(other.id, laptopRow.id, "Mine"), "PASSKEY_NOT_FOUND", "rename is owner scoped")
  await rejects(() => passkeys.renamePasskey(owner.id, laptopRow.id, " \u0001 "), "PASSKEY_NAME_INVALID", "blank names are rejected")
  await rejects(() => management.removePasskey(other.id, other.id, laptopRow.id), "PASSKEY_NOT_FOUND", "removal is owner scoped")
  await management.removePasskey(owner.id, owner.id, laptopRow.id)
  assert.equal((await passkeys.listPasskeys(owner.id)).length, 1)
  const audit = await db.select().from(schema.adminAuditLogs).where(eq(schema.adminAuditLogs.userId, owner.id))
  assert.deepEqual(audit.map((entry: { action: string; target: string }) => [entry.action, entry.target]).sort(), [
    ["passkey.create", "Phone"], ["passkey.create", laptopRow.id], ["passkey.delete", "Work laptop"],
  ].sort())
  const removedLogin = await passkeys.createAuthenticationOptions()
  await rejects(() => passkeys.verifyPasskeyAssertion(removedLogin.challengeId, laptop.assert(removedLogin.options)), "PASSKEY_NOT_RECOGNIZED", "removed passkeys stop working")

  // Administrators can pause passkeys: every ceremony stops, including challenges
  // issued before the switch, while stored passkeys remain listable and removable.
  const runtime = await load("app/lib/config/runtime.ts")
  assert.equal(runtime.getPublicRuntimeConfig().passkeys, true, "passkeys default to enabled")
  const issuedBeforePause = await passkeys.createAuthenticationOptions()
  assert.equal((await runtime.saveConfigPatch({ auth: { passkeys: { enabled: false } } })).ok, true)
  assert.equal(runtime.getPublicRuntimeConfig().passkeys, false, "the browser learns passkeys are paused")
  await rejects(() => passkeys.verifyPasskeyAssertion(issuedBeforePause.challengeId, phone.assert(issuedBeforePause.options)), "PASSKEY_DISABLED", "pending sign-ins stop when paused")
  await rejects(() => passkeys.createAuthenticationOptions(), "PASSKEY_DISABLED", "sign-in is paused")
  await rejects(() => passkeys.createRegistrationOptions(owner.id, sessionA), "PASSKEY_DISABLED", "registration is paused")
  await rejects(() => passkeys.createVerificationOptions(owner.id, sessionA), "PASSKEY_DISABLED", "passkey step-up is paused")
  assert.equal((await passkeys.reauthenticationState(owner.id, sessionA)).passkey, false, "paused passkeys are not offered for step-up")
  assert.equal((await passkeys.listPasskeys(owner.id)).length, 1, "stored passkeys are kept")
  assert.equal(await passkeys.renamePasskey(owner.id, row.id, "Phone"), "Phone", "paused passkeys can still be renamed")
  assert.equal((await runtime.saveConfigPatch({ auth: { passkeys: { enabled: true } } })).ok, true)
  const resumed = await passkeys.createAuthenticationOptions()
  assert.equal((await passkeys.verifyPasskeyAssertion(resumed.challengeId, phone.assert(resumed.options))).userId, owner.id, "re-enabling restores stored passkeys")

  // The per-account limit applies to new registrations.
  for (let index = (await passkeys.countPasskeys(owner.id)); index < passkeys.PASSKEY_LIMIT; index++) {
    const extra = new SoftAuthenticator()
    const options = await passkeys.createRegistrationOptions(owner.id, sessionA)
    await management.savePasskey(owner.id, await passkeys.verifyRegistration(owner.id, sessionA, options.challengeId, extra.register(options.options), "Key " + index))
  }
  await rejects(() => passkeys.createRegistrationOptions(owner.id, sessionA), "PASSKEY_LIMIT_REACHED", "the account limit is enforced")

  // Deleting an account removes its passkeys and pending challenges.
  await passkeys.createVerificationOptions(other.id, otherSession)
  await db.delete(schema.users).where(eq(schema.users.id, other.id))
  assert.equal((await db.select().from(schema.passkeys).where(eq(schema.passkeys.userId, other.id))).length, 0)
  assert.equal((await db.select().from(schema.passkeyChallenges).where(and(eq(schema.passkeyChallenges.userId, other.id)))).length, 0)

  console.log(JSON.stringify({ ok: true, driver: postgresUrl ? "postgres" : "sqlite" }))
} finally {
  await closeDatabase?.()
  unwatchFile(join(temporaryRoot, "data/config.yaml"))
}
