import { createHash } from "node:crypto"

/** Random API credentials need a one-way lookup digest, not password hashing. */
export function digestApiKey(key: string) {
  return `sha256:${createHash("sha256").update(key, "utf8").digest("hex")}`
}

/** Only for stored/imported values. Never use this to normalize a request key. */
export function storedApiKeyDigest(value: string) {
  return /^sha256:[a-f0-9]{64}$/u.test(value) ? value : digestApiKey(value)
}
