import type { CapFailureKind } from "./providers"

// Cap collapses HTTP refusals into network_error (including during speculative
// solving). Inspect the response before the widget loses that information.
export function capResponseFailure(status: number, body: unknown): CapFailureKind | null {
  if ([401, 403, 429, 451].includes(status)) return "blocked"
  if (status >= 500) return "unavailable"
  if (body && typeof body === "object") {
    const data = body as Record<string, unknown>
    const error = [data.code, data.error, data.message].filter(value => typeof value === "string").join(" ")
    if (/\b(blocked|forbidden|access[ _-]denied|country[ _-](blocked|restricted)|geo[ _-]blocked|rate[ _-]limit(?:ed|[ _-]exceeded)?)\b/i.test(error)) return "blocked"
  }
  if (status >= 400) return "unavailable"
  return null
}

export async function fetchCap(
  input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number,
  onFailure: (kind: CapFailureKind) => void,
): Promise<Response> {
  const controller = new AbortController()
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(abort, timeoutMs)
  let reported = false
  const report = (kind: CapFailureKind) => {
    if (!reported && !signal?.aborted) { reported = true; onFailure(kind) }
  }
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    const statusFailure = capResponseFailure(response.status, null)
    if (statusFailure === "blocked" || response.status >= 500) report(statusFailure!)
    // Read the body inside the timeout too: a server can send headers then stall.
    const text = await response.text()
    let body: unknown
    try { body = JSON.parse(text) } catch { report("network") }
    const failure = capResponseFailure(response.status, body)
    if (failure) report(failure)
    return new Response(response.status === 204 || response.status === 205 || response.status === 304 ? null : text, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    })
  } catch (error) {
    // CORS, connection resets and timeouts cannot establish whether a visitor
    // was deliberately blocked. They have their own conservative policy.
    report("network")
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", abort)
  }
}
