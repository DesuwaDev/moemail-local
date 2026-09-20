import assert from "node:assert/strict"
import { lookupIpLocation, normalizeGeoIp } from "../../app/lib/ip-location"
import { getAuthClientAddress } from "../../app/lib/auth-abuse-guard"

const originalFetch = globalThis.fetch
let calls: string[] = []
const response = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers })
try {
  globalThis.fetch = async input => { calls.push(String(input)); throw new Error("unexpected external lookup") }
  for (const ip of ["127.0.0.1", "10.0.0.1", "100.64.1.1", "192.0.2.1", "::1", "fc00::1", "fe80::1", "2001:db8::1", "::ffff:127.0.0.1", "3fff::1"]) assert.equal((await lookupIpLocation(ip)).status, "private")
  for (const ip of [null, "example.com", "https://127.0.0.1", "8.8.8.8/evil", "fe80::1%eth0"]) assert.equal((await lookupIpLocation(ip)).status, "unavailable")
  assert.equal(calls.length, 0)
  assert.equal(normalizeGeoIp("::ffff:8.8.8.8"), "8.8.8.8")
  assert.equal(normalizeGeoIp("2001:4860:4860:0:0:0:0:8888"), "2001:4860:4860::8888")
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(url)
    assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store")
    if (url.includes("geojs")) return response({ ip: "8.8.8.8", country_code: "US" })
    return response({ ip: "8.8.8.8", success: true, country_code: "US", region: "California", city: "San Jose", postal: "95113", connection: { isp: "Google" }, timezone: { id: "America/Los_Angeles" }, latitude: 37.3, longitude: -121.9 })
  }
  const [a, b] = await Promise.all([lookupIpLocation("8.8.8.8"), lookupIpLocation("::ffff:8.8.8.8")])
  assert.deepEqual(a, b); assert.equal(a.city, "San Jose"); assert.equal(a.postal, "95113"); assert.equal(a.organization, "Google")
  assert.equal(calls.length, 2)
  await lookupIpLocation("8.8.8.8"); assert.equal(calls.length, 2)
  calls = []
  globalThis.fetch = async input => {
    const url = String(input); calls.push(url)
    if (url.includes("geojs")) throw new Error("network down")
    if (url.includes("ipwho.is")) return response({ success: false })
    return response({ ip: "1.1.1.1", country: "AU" })
  }
  const country = await lookupIpLocation("1.1.1.1")
  assert.equal(country.countryCode, "AU"); assert.equal(country.city, undefined); assert.equal(calls.length, 3)
  calls = []
  globalThis.fetch = async input => {
    calls.push(String(input))
    return response({ ip: "8.8.8.8", country_code: "US", country: "US", city: "wrong IP" })
  }
  assert.equal((await lookupIpLocation("9.9.9.9")).status, "unavailable")
  await lookupIpLocation("9.9.9.9"); assert.equal(calls.length, 3)
  calls = []
  globalThis.fetch = async input => { calls.push(String(input)); return response({}, 429, { "Retry-After": "60" }) }
  assert.equal((await lookupIpLocation("8.8.4.4")).status, "unavailable")
  assert.equal((await lookupIpLocation("1.0.0.1")).status, "unavailable")
  assert.equal(calls.length, 3, "rate-limited providers cool down across IPs")
} finally { globalThis.fetch = originalFetch }

const cf = new Headers({ "CF-Connecting-IP": "8.8.8.8", "X-Forwarded-For": "9.9.9.9" })
assert.equal(getAuthClientAddress(cf, false), "untrusted-proxy-headers")
assert.equal(getAuthClientAddress(cf, true), "8.8.8.8")
cf.set("CF-Connecting-IP", "240.1.2.3"); cf.set("CF-Connecting-IPv6", "2001:4860:4860::8888")
assert.equal(getAuthClientAddress(cf, true), "2001:4860:4860::8888")
cf.set("X-MoeMail-Client-IP", "1.1.1.1")
assert.equal(getAuthClientAddress(cf, true), "1.1.1.1", "trusted ingress canonical IP wins")
cf.delete("X-MoeMail-Client-IP"); cf.set("CF-Connecting-IP", "8.8.8.8")
assert.equal(getAuthClientAddress(cf, true), "8.8.8.8", "extra IPv6 header cannot replace a real IPv4")
console.log("IP location: reserved addresses, fallback, response binding, cache, deduplication, rate-limit cooldown and CF trust checks passed")
