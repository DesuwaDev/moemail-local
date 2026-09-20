import { authorizeEmperor, adminError, adminJson } from "@/lib/admin-management"
import { getConfig } from "@/lib/config/runtime"
import { inspectClientIpHeaders, resolveClientIp } from "@/lib/client-ip"
import { isClientIpHeader } from "@/lib/client-ip-policy"

export async function GET(request: Request) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  const active = getConfig().server
  const query = new URL(request.url).searchParams
  const header = (query.get("header") ?? active.clientIpHeader).trim().toLowerCase()
  const hops = Number(query.get("hops") ?? active.clientIpTrustedHops)
  const enabled = query.get("enabled") ?? String(active.trustProxyHeaders)
  if (!isClientIpHeader(header) || !Number.isInteger(hops) || hops < 1 || hops > 16 || !["true", "false"].includes(enabled)) return adminError("INVALID_REQUEST", 400)
  return adminJson({
    active: resolveClientIp(request.headers, active),
    preview: resolveClientIp(request.headers, { trustProxyHeaders: enabled === "true", clientIpHeader: header, clientIpTrustedHops: hops }),
    headers: inspectClientIpHeaders(request.headers, header),
  })
}
