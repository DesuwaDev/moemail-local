import { isIP } from "node:net"
import { CLIENT_IP_HEADERS, isClientIpHeader, type ClientIpPolicy, type ClientIpResult } from "./client-ip-policy"

function normalizeAddress(value: string): string | null {
  let address = value.trim()
  if (address.startsWith('"') && address.endsWith('"')) address = address.slice(1, -1)
  if (address.includes("%") || address.includes("\\")) return null
  // Some CDNs (including CloudFront) include a source port.
  if (!isIP(address)) {
    const bracket = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(address)
    const v4Port = /^(\d+\.\d+\.\d+\.\d+):(\d{1,5})$/.exec(address)
    const match = bracket || v4Port
    if (!match || (match[2] && Number(match[2]) > 65535)) return null
    address = match[1]
  }
  if (isIP(address) === 4) return address
  if (isIP(address) !== 6) return null
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1)
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(normalized)
  if (!mapped) return normalized
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16)
  return [high >> 8, high & 255, low >> 8, low & 255].join(".")
}

function readHeader(headers: Headers, name: string) {
  const raw = headers.get(name)
  if (!raw) return { name, present: false, addresses: [], invalid: false }
  // Do not echo raw request headers (which could contain credentials or markup).
  if (raw.length > 2048 || raw.split(",").length > 32) return { name, present: true, addresses: [], invalid: true }
  const values = raw.split(",")
  const addresses = values.map(value => {
    if (name !== "forwarded") return normalizeAddress(value)
    const parameters = value.split(";").map(part => part.trim()).filter(part => /^for\s*=/i.test(part))
    if (parameters.length !== 1) return null
    return normalizeAddress(parameters[0].slice(parameters[0].indexOf("=") + 1))
  })
  return { name, present: true, addresses, invalid: addresses.some(address => !address) }
}

export function resolveClientIp(headers: Headers, policy: ClientIpPolicy): ClientIpResult {
  if (!policy.trustProxyHeaders) return { address: null, source: null, reason: "disabled" }
  const header = policy.clientIpHeader ?? "auto", hops = policy.clientIpTrustedHops ?? 1
  if (!isClientIpHeader(header) || !Number.isInteger(hops) || hops < 1 || hops > 16) return { address: null, source: null, reason: "invalid" }
  const candidates = header === "auto" ? ["x-moemail-client-ip", "cf-connecting-ip", "x-real-ip", "x-forwarded-for"] : [header]
  let reason: ClientIpResult["reason"] = "missing"
  for (const name of candidates) {
    const entry = readHeader(headers, name)
    if (!entry.present) continue
    const chain = name === "x-forwarded-for" || name === "forwarded" || !CLIENT_IP_HEADERS.some(known => known === name)
    // Never discard malformed elements before indexing: that could select an attacker-controlled left-hand value.
    const index = chain ? entry.addresses.length - hops : 0
    if (index < 0) { reason = "chainTooShort"; continue }
    let address = entry.addresses[index]
    if (entry.invalid || (!chain && entry.addresses.length !== 1) || !address) { reason = "invalid"; continue }
    if (name === "cf-connecting-ip" && isIP(address) === 4 && Number(address.split(".")[0]) >= 240) {
      const v6 = readHeader(headers, "cf-connecting-ipv6")
      if (v6.addresses.length === 1 && v6.addresses[0] && isIP(v6.addresses[0]) === 6) address = v6.addresses[0]
    }
    return { address, source: name, reason: "ok" }
  }
  return { address: null, source: null, reason }
}

export function inspectClientIpHeaders(headers: Headers, customHeader = "auto") {
  const names = new Set<string>([...CLIENT_IP_HEADERS, "cf-connecting-ipv6"])
  if (customHeader !== "auto" && isClientIpHeader(customHeader)) names.add(customHeader)
  return [...names].map(name => readHeader(headers, name))
}
