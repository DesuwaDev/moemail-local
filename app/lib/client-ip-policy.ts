/** Shared with the visual editor; contains no server-only imports. */
export const CLIENT_IP_HEADERS = ["x-moemail-client-ip", "cf-connecting-ip", "true-client-ip", "fastly-client-ip", "x-real-ip", "x-forwarded-for", "forwarded", "cloudfront-viewer-address", "x-azure-clientip"] as const
export function isClientIpHeader(value: string) {
  return value === "auto" || (/^[a-z][a-z0-9-]{0,63}$/.test(value) && !/(?:authorization|cookie|token|secret|key)/.test(value))
}
export interface ClientIpPolicy {
  trustProxyHeaders: boolean
  clientIpHeader?: string
  clientIpTrustedHops?: number
}
export interface ClientIpResult {
  address: string | null
  source: string | null
  reason: "ok" | "disabled" | "missing" | "invalid" | "chainTooShort"
}
export interface ClientIpDiagnostics {
  active: ClientIpResult
  preview: ClientIpResult
  headers: Array<{ name: string; present: boolean; addresses: Array<string | null>; invalid: boolean }>
}
