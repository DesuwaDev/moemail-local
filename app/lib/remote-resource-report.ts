export type RemoteResourceKind = "image" | "media" | "font" | "style" | "other"
export interface RemoteResource { kind: RemoteResourceKind; source: string; path: string; count: number; csp: string }
export interface RemoteResourceReport { items: RemoteResource[]; limited: boolean }

/** Kinds a reader may opt into; each maps to its own CSP fetch directive. */
export const selectableRemoteKinds = ["image", "media", "font"] as const
export type SelectableRemoteKind = typeof selectableRemoteKinds[number]
export const isSelectableRemoteKind = (kind: RemoteResourceKind): kind is SelectableRemoteKind =>
  (selectableRemoteKinds as readonly string[]).includes(kind)
export const remoteResourceKey = (item: Pick<RemoteResource, "kind" | "csp">) => `${item.kind} ${item.csp}`

/**
 * CSP host-source for one exact resource. Browsers ignore the query when
 * matching, and a path ending in "/" matches as a directory prefix. Percent-encode
 * everything outside a conservative pchar subset so the value can neither split
 * the policy nor be decoded as an HTML character reference in the meta attribute.
 */
function cspSource(url: URL) {
  const path = url.pathname.replace(/[^A-Za-z0-9\-._~!$()+=:@/%]/g, char =>
    [...new TextEncoder().encode(char)].map(byte => "%" + byte.toString(16).toUpperCase().padStart(2, "0")).join(""))
  return `${url.protocol}//${url.host}${path}`
}

/** Whether a selected CSP source would permit this item, mirroring CSP path matching. */
export function remoteResourceAllowed(item: RemoteResource, selected: ReadonlySet<string>) {
  if (!isSelectableRemoteKind(item.kind)) return false
  if (selected.has(remoteResourceKey(item))) return true
  for (const key of selected) {
    const [kind, source] = key.split(" ", 2)
    if (kind === item.kind && source.endsWith("/") && item.csp.startsWith(source)) return true
  }
  return false
}

/** Inspect an inert, sanitized template. Never attach nodes or fetch resource URLs. */
export function inspectRemoteResources(content: DocumentFragment): RemoteResourceReport {
  const entries = new Map<string, RemoteResource>()
  let limited = false
  const add = (value: string | null, kind: RemoteResourceKind) => {
    if (!value) return
    const raw = value.trim()
    if (!raw || /^(?:data:|cid:|blob:|#)/i.test(raw)) return
    let url: URL
    try { url = new URL(raw, window.location.href) } catch { return }
    if (!["https:", "http:"].includes(url.protocol)) return
    // CSP cannot distinguish query strings, so they are neither kept nor shown.
    const csp = cspSource(url)
    const key = remoteResourceKey({ kind, csp })
    const existing = entries.get(key)
    if (existing) { existing.count++; return }
    if (entries.size >= 200) { limited = true; return }
    entries.set(key, { kind, source: url.origin, path: url.pathname.slice(0, 240), count: 1, csp })
  }
  const css = (text: string, kind: RemoteResourceKind = "image") => {
    // Decode CSS escapes before reading URL tokens (including escaped url names).
    const decoded = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi, (_, hex: string, char: string) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : char)
    const withoutFonts = decoded.replace(/@font-face\s*\{([^{}]*)\}/gi, (_, body: string) => { cssUrls(body, "font"); return "" })
    const withoutImports = withoutFonts.replace(/@import\s+(?:url\(\s*)?["']?([^\s"');]+)["']?\s*\)?[^;]*;/gi, (_, value: string) => { add(value, "style"); return "" })
    cssUrls(withoutImports, kind)
  }
  const cssUrls = (text: string, kind: RemoteResourceKind) => {
    for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi)) add(match[1] ?? match[2] ?? match[3], kind)
    // CSS image-set also permits bare quoted URL candidates.
    for (const match of text.matchAll(/(?:-webkit-)?image-set\(([^)]*)\)/gi)) {
      if (!/url\(/i.test(match[1])) for (const candidate of match[1].matchAll(/["']([^"']+)["']/g)) add(candidate[1], kind)
    }
  }
  for (const element of content.querySelectorAll("*")) {
    const name = element.localName.toLowerCase()
    if (name === "img") add(element.getAttribute("src"), "image")
    if (["img", "source"].includes(name)) {
      // A data URL can contain commas; consume its URL token before descriptors.
      const srcset = element.getAttribute("srcset") ?? ""
      for (const match of srcset.matchAll(/(?:^|,\s*)(data:[^\s]+|[^\s,]+)(?:\s+[^,]*)?/gi)) add(match[1].replace(/,+$/, ""), "image")
    }
    if (["video", "audio", "source", "track"].includes(name) && !element.closest("picture")) add(element.getAttribute("src"), "media")
    if (name === "video") add(element.getAttribute("poster"), "image")
    if (["body", "table", "td", "th"].includes(name)) add(element.getAttribute("background"), "image")
    if (["image", "feimage", "use"].includes(name)) add(element.getAttribute("href") ?? element.getAttribute("xlink:href"), name === "use" ? "other" : "image")
    const style = element.getAttribute("style")
    if (style) css(style)
    if (name === "style") css(element.textContent ?? "")
  }
  return { items: [...entries.values()], limited }
}
