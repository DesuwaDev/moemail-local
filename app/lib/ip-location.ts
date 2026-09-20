import { BlockList, isIP } from "node:net"
import type { IpLocation } from "./ip-location-types"

const reserved = new BlockList(), globalV6 = new BlockList()
for (const [ip, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) reserved.addSubnet(ip, prefix, "ipv4")
for (const [ip, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) reserved.addSubnet(ip, prefix, "ipv6")
globalV6.addSubnet("2000::", 3, "ipv6")

export function normalizeGeoIp(value: unknown): string | null {
  if (typeof value !== "string" || value.includes("%") || !isIP(value)) return null
  if (isIP(value) === 4) return value
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1)
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(normalized)
  if (!mapped) return normalized
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16)
  return [high >> 8, high & 255, low >> 8, low & 255].join(".")
}
export function isPublicGeoIp(ip: string) {
  const family = isIP(ip)
  return family === 4 ? !reserved.check(ip, "ipv4") : family === 6 && globalV6.check(ip, "ipv6") && !reserved.check(ip, "ipv6")
}
const unavailable: IpLocation = { status: "unavailable" }
const cache = new Map<string, { until: number; value: IpLocation }>()
const pending = new Map<string, Promise<IpLocation>>()
const cooldown = new Map<string, number>()
const queue: Array<() => void> = []
let active = 0

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160)
  return clean && !/^(unknown|n\/a|null|undefined|-)$/i.test(clean) ? clean : undefined
}
function number(value: unknown, min: number, max: number): number | undefined {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
const providers = [
  { name: "GeoJS", url: (ip: string) => `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json` },
  { name: "ipwho.is", url: (ip: string) => `https://ipwho.is/${encodeURIComponent(ip)}` },
  { name: "country.is", url: (ip: string) => `https://api.country.is/${encodeURIComponent(ip)}` },
] as const

async function query(provider: typeof providers[number], ip: string): Promise<IpLocation | null> {
  if ((cooldown.get(provider.name) ?? 0) > Date.now()) return null
  try {
    // Only fixed HTTPS services, no redirects, cookies, forwarded headers or arbitrary lookup targets.
    const response = await fetch(provider.url(ip), { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(2500), headers: { Accept: "application/json" } })
    if (!response.ok) {
      if (response.status === 429) {
        const retry = response.headers.get("retry-after") ?? ""
        const milliseconds = /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()
        cooldown.set(provider.name, Date.now() + Math.min(86400_000, Math.max(60_000, Number.isFinite(milliseconds) ? milliseconds : 900_000)))
      }
      await response.body?.cancel()
      return null
    }
    const reader = response.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 32_768) { await reader.cancel(); return null }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const raw = object(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    if (normalizeGeoIp(raw.ip) !== ip || raw.success === false) return null
    const code = text(provider.name === "country.is" ? raw.country : raw.country_code)?.toUpperCase()
    if (!code || !/^[A-Z]{2}$/.test(code) || ["XX", "ZZ", "T1"].includes(code)) return null
    if (provider.name === "country.is") return { status: "success", countryCode: code, source: provider.name }
    return {
      status: "success", countryCode: code, country: text(raw.country), region: text(raw.region), city: text(raw.city),
      postal: text(raw.postal), organization: text(raw.organization_name) || text(raw.organization) || text(object(raw.connection).isp) || text(object(raw.connection).org),
      timezone: text(raw.timezone) || text(object(raw.timezone).id),
      latitude: number(raw.latitude, -90, 90), longitude: number(raw.longitude, -180, 180),
      accuracyKm: number(raw.accuracy, 0, 20_000), source: provider.name,
    }
  } catch { return null }
}
async function resolveLocation(ip: string): Promise<IpLocation> {
  let best: IpLocation | null = null
  for (const provider of providers) {
    const result = await query(provider, ip)
    if (!result) continue
    // Keep one source's geography intact instead of stitching conflicting cities together.
    if (!best || (Number(Boolean(result.city)) * 2 + Number(Boolean(result.region))) > (Number(Boolean(best.city)) * 2 + Number(Boolean(best.region)))) best = result
    if (best.city) break
  }
  return best ?? unavailable
}
async function limitedLookup(ip: string) {
  if (active >= 4) await new Promise<void>(resolve => queue.push(resolve))
  else active++
  try { return await resolveLocation(ip) }
  finally { const next = queue.shift(); if (next) next(); else active-- }
}

/** Only call for IPs selected from an already-authorized session page. Never from login validation. */
export async function lookupIpLocation(value: string | null): Promise<IpLocation> {
  const ip = normalizeGeoIp(value)
  if (!ip) return unavailable
  if (!isPublicGeoIp(ip)) return { status: "private" }
  const entry = cache.get(ip)
  if (entry && entry.until > Date.now()) { cache.delete(ip); cache.set(ip, entry); return entry.value }
  const running = pending.get(ip)
  if (running) return running
  if (pending.size >= 16) return unavailable
  const work = limitedLookup(ip).then(result => {
    cache.delete(ip)
    if (cache.size >= 1024) cache.delete(cache.keys().next().value!)
    cache.set(ip, { until: Date.now() + (result.status === "success" ? 86400_000 : 300_000), value: result })
    return result
  }).finally(() => pending.delete(ip))
  pending.set(ip, work)
  return work
}
