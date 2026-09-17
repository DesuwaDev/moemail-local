import type { CapWidget, CapSolveEvent, CapErrorEvent } from "cap-widget"
import { capEndpoint, validCapLinkUrl, type CaptchaChannelConfig } from "@/lib/captcha/providers"

export function prepareCapAssets(timeoutMs: number) {
  window.CAP_CUSTOM_WASM_URL = "/vendor/cap/cap-0.0.7.wasm"
  window.CAP_PAKO_URL = "/vendor/cap/pako-inflate-2.2.0.min.js"
  // An unreachable challenge/redeem endpoint must reach the fallback UI.
  window.CAP_CUSTOM_FETCH = async (input, init) => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    const signal = init?.signal
    if (signal?.aborted) abort()
    else signal?.addEventListener("abort", abort, { once: true })
    const timer = window.setTimeout(abort, timeoutMs)
    try {
      return await fetch(input, { ...init, signal: controller.signal })
    } finally {
      window.clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
    }
  }
}

export function mountCap(
  container: HTMLElement,
  channel: CaptchaChannelConfig,
  locale: string,
  labels: Record<string, string>,
  onToken: (token: string) => void,
  onUnavailable: () => void,
) {
  const endpoint = capEndpoint(channel.serverUrl, channel.siteKey)
  if (!endpoint) { onUnavailable(); return null }
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
  const failed = (event: CapErrorEvent) => {
    cleared()
    // A rejected solution or blocked instrumentation is not an outage.
    if (["network_error", "missing_endpoint", "challenge_parse_error", "challenge_unsupported",
      "wasm_load_failed", "worker_spawn_failed"].includes(event.detail.code)) onUnavailable()
  }
  widget.addEventListener("solve", solved)
  widget.addEventListener("reset", cleared)
  widget.addEventListener("error", failed)
  container.replaceChildren(widget)
  return {
    reset: () => widget.reset(),
    dispose: () => {
      widget.removeEventListener("solve", solved)
      widget.removeEventListener("reset", cleared)
      widget.removeEventListener("error", failed)
      widget.remove()
    },
  }
}
