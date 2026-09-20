import assert from "node:assert/strict"
import { resolveClientIp, inspectClientIpHeaders } from "../../app/lib/client-ip"
import { isClientIpHeader } from "../../app/lib/client-ip-policy"
import { parseConfig } from "../../app/lib/config/schema"
const policy = { trustProxyHeaders: true, clientIpHeader: "x-forwarded-for", clientIpTrustedHops: 1 }
const headers = new Headers({ "x-forwarded-for": "1.1.1.1, 8.8.8.8, 9.9.9.9", "cf-connecting-ip": "8.8.4.4" })
assert.equal(resolveClientIp(headers, policy).address, "9.9.9.9")
assert.equal(resolveClientIp(headers, { ...policy, clientIpTrustedHops: 2 }).address, "8.8.8.8")
assert.equal(resolveClientIp(headers, { ...policy, clientIpTrustedHops: 4 }).reason, "chainTooShort")
assert.equal(resolveClientIp(headers, { ...policy, trustProxyHeaders: false }).reason, "disabled")
assert.equal(resolveClientIp(headers, { ...policy, clientIpHeader: "x-real-ip" }).reason, "missing", "explicit selection never falls back")
assert.equal(resolveClientIp(headers, { trustProxyHeaders: true }).address, "8.8.4.4")
headers.set("x-forwarded-for", "attacker, 8.8.8.8, 9.9.9.9")
assert.equal(resolveClientIp(headers, policy).reason, "invalid", "malformed elements cannot shift chain selection")
for (const [name, value, expected] of [
  ["forwarded", 'for=1.1.1.1;proto=https, for="[2001:4860:4860::8888]:443";by=proxy', "2001:4860:4860::8888"],
  ["cloudfront-viewer-address", "8.8.8.8:12345", "8.8.8.8"],
  ["x-real-ip", "::ffff:8.8.8.8", "8.8.8.8"],
  ["x-custom-ip", "1.1.1.1, 8.8.8.8", "8.8.8.8"],
]) assert.equal(resolveClientIp(new Headers({ [name]: value }), { ...policy, clientIpHeader: name }).address, expected)
for (const value of ['for=unknown', 'for=_hidden', 'for=8.8.8.8;for=1.1.1.1', 'for="[fe80::1%eth0]"']) assert.equal(resolveClientIp(new Headers({ forwarded: value }), { ...policy, clientIpHeader: "forwarded" }).address, null)
assert.equal(resolveClientIp(new Headers({ "x-real-ip": "8.8.8.8,1.1.1.1" }), { ...policy, clientIpHeader: "x-real-ip" }).reason, "invalid")
assert.equal(resolveClientIp(new Headers({ "x-forwarded-for": "1.1.1.1,".repeat(33) }), policy).address, null)
assert.equal(resolveClientIp(new Headers({ "cloudfront-viewer-address": "8.8.8.8:65536" }), { ...policy, clientIpHeader: "cloudfront-viewer-address" }).address, null)
assert.equal(resolveClientIp(new Headers({ "cf-connecting-ip": "240.0.0.1", "cf-connecting-ipv6": "2001:4860:4860::8888" }), { ...policy, clientIpHeader: "cf-connecting-ip" }).address, "2001:4860:4860::8888")
for (const name of ["cookie", "authorization", "x-api-key", "x-auth-token", "x secret", "x\r\nip", ""]) assert.equal(isClientIpHeader(name), false)
const diagnostic = inspectClientIpHeaders(new Headers({ cookie: "private-data", "x-custom-ip": "secret-value" }), "x-custom-ip")
assert.ok(!JSON.stringify(diagnostic).includes("private-data") && !JSON.stringify(diagnostic).includes("secret-value"))
assert.ok(diagnostic.find(item => item.name === "x-custom-ip")?.invalid)
const old = parseConfig({})
assert.ok(old.ok)
if (old.ok) { assert.equal(old.config.server.clientIpHeader, "auto"); assert.equal(old.config.server.clientIpTrustedHops, 1) }
for (const server of [{ clientIpHeader: "cookie" }, { clientIpTrustedHops: 0 }, { clientIpTrustedHops: 17 }]) assert.equal(parseConfig({ server }).ok, false)
console.log("Client IP validation passed: proxy chains, explicit selection, format limits, redaction and compatible defaults")
