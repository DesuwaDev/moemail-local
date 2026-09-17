import type { CapWidget, CapSolveEvent, CapErrorEvent } from "cap-widget"
import { capEndpoint, validCapLinkUrl, type CaptchaChannelConfig, type CapFailureKind } from "@/lib/captcha/providers"
import { fetchCap } from "@/lib/captcha/cap-transport"

const transports = new Map<string, Set<{ timeout: number; failed: (kind: CapFailureKind) => void }>>()

export function prepareCapAssets() {
  window.CAP_CUSTOM_WASM_URL = "/vendor/cap/cap-0.0.7.wasm"
  window.CAP_PAKO_URL = "/vendor/cap/pako-inflate-2.2.0.min.js"
  window.CAP_CUSTOM_FETCH = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const listeners = [...(transports.get(url) ?? [])]
    if (!listeners.length) return fetch(input, init)
    return fetchCap(input, init, Math.min(...listeners.map(item => item.timeout)), kind => {
      for (const item of listeners) if (transports.get(url)?.has(item)) item.failed(kind)
    })
  }
}

export function mountCap(
  container: HTMLElement,
  channel: CaptchaChannelConfig,
  locale: string,
  labels: Record<string, string>,
  onToken: (token: string) => void,
  onUnavailable: (kind: CapFailureKind) => void,
) {
  const endpoint = capEndpoint(channel.serverUrl, channel.siteKey)
  if (!endpoint) { onUnavailable("unavailable"); return null }
  const widget = document.createElement("cap-widget") as CapWidget
  widget.className = "moemail-cap"
  widget.dataset.theme = channel.theme
  widget.dataset.size = channel.size
  widget.setAttribute("data-cap-api-endpoint", endpoint)
  widget.setAttribute("data-cap-lang", locale.toLowerCase())
  widget.setAttribute("data-cap-hidden-field-name", "captchaToken")
  // Left unset, the widget claims every core the browser reports; a number caps
  // it. Difficulty stays a Cap server setting either way.
  if (channel.workerCount !== "auto") widget.setAttribute("data-cap-worker-count", channel.workerCount)
  if (!channel.haptics) widget.setAttribute("data-cap-disable-haptics", "")
  // Only shown once instrumentation is already blocked, and only worth pointing
  // somewhere else when the vendor's own page is unreachable from here.
  if (validCapLinkUrl(channel.troubleshootingUrl)) {
    widget.setAttribute("data-cap-troubleshooting-url", channel.troubleshootingUrl)
  }
  for (const [key, label] of Object.entries(labels)) widget.setAttribute(`data-cap-i18n-${key}`, label)
  const solved = (event: CapSolveEvent) => onToken(event.detail.token)
  const cleared = () => onToken("")
  // 0.1.57's click/keyboard handlers discard solve()'s promise. The error event
  // already handles failure; consume this instance's rejection as well so a
  // refused request does not become an unhandled page error.
  const solve = widget.solve.bind(widget)
  widget.solve = () => solve().catch(() => {
    cleared()
    return { success: false, token: "" }
  })
  const failed = (event: CapErrorEvent) => {
    cleared()
    // A rejected solution or blocked instrumentation is not an outage.
    // A 200 HTML block page is indistinguishable from a broken JSON response.
    if (["network_error", "challenge_parse_error"].includes(event.detail.code)) onUnavailable("network")
    else if (["missing_endpoint", "challenge_unsupported",
      "wasm_load_failed", "worker_spawn_failed"].includes(event.detail.code)) onUnavailable("unavailable")
  }
  const transport = { timeout: Number(channel.timeout) * 1000, failed: onUnavailable }
  const urls = ["challenge", "redeem"].map(path => `${endpoint}${path}`)
  for (const url of urls) {
    const listeners = transports.get(url) ?? new Set()
    listeners.add(transport)
    transports.set(url, listeners)
  }
  widget.addEventListener("solve", solved)
  widget.addEventListener("reset", cleared)
  widget.addEventListener("error", failed)
  container.replaceChildren(widget)
  return {
    reset: () => widget.reset(),
    dispose: () => {
      for (const url of urls) {
        const listeners = transports.get(url)
        listeners?.delete(transport)
        if (!listeners?.size) transports.delete(url)
      }
      widget.removeEventListener("solve", solved)
      widget.removeEventListener("reset", cleared)
      widget.removeEventListener("error", failed)
      widget.remove()
    },
  }
}
