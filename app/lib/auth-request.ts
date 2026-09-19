import { NextRequest } from "next/server"
import { getConfig } from "./config/runtime"

/** Auth.js must see the public origin, not Next's internal Docker listener. */
export function normalizeAuthRequest(request: NextRequest): NextRequest {
  const origin = new URL(getConfig().server.baseUrl)
  const url = new URL(request.url)
  url.protocol = origin.protocol
  url.hostname = origin.hostname
  url.port = origin.port
  const normalized = new NextRequest(url, request)
  normalized.headers.set("host", origin.host)
  normalized.headers.set("x-forwarded-host", origin.host)
  normalized.headers.set("x-forwarded-proto", origin.protocol.slice(0, -1))
  return normalized
}
