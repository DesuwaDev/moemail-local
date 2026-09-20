"use client"

import { useEffect, useState } from "react"
import { normalizeContentId, type InlineMessageImage } from "@/lib/attachment-types"
import { useTheme } from "next-themes"
import { useTranslations } from "next-intl"
import { ShieldCheck, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSession } from "next-auth/react"

interface HtmlMessageFrameProps {
  html: string
  title: string
  inlineImages?: InlineMessageImage[]
}

const blockedElements = [
  "base",
  "button",
  "embed",
  "iframe",
  "input",
  "link",
  "meta",
  "noscript",
  "object",
  "script",
  "select",
  "textarea",
  "template",
]

function safeLink(value: string) {
  const normalized = value.trim()
  if (normalized.startsWith("#")) return true
  try {
    return ["http:", "https:", "mailto:", "tel:"].includes(new URL(normalized).protocol)
  } catch {
    return false
  }
}

function sanitizeMessageHtml(html: string) {
  // Parsing in a template is inert: even the parsing step must not fetch a
  // tracking image before the sandbox's CSP is installed.
  const template = document.createElement("template")
  template.innerHTML = html
  const content = template.content

  content.querySelectorAll("form").forEach(form => form.replaceWith(...form.childNodes))
  content.querySelectorAll(blockedElements.join(",")).forEach(element => element.remove())
  content.querySelectorAll("*").forEach(element => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith("on") || ["formaction", "srcdoc", "ping", "attributionsrc"].includes(name)) {
        element.removeAttribute(attribute.name)
      }
    }
    element.removeAttribute("autoplay")
  })
  content.querySelectorAll("a").forEach(anchor => {
    const href = anchor.getAttribute("href")
    if (!href || !safeLink(href)) anchor.removeAttribute("href")
    if (href?.trim().startsWith("#")) {
      anchor.removeAttribute("target")
      anchor.removeAttribute("rel")
    } else {
      anchor.setAttribute("target", "_blank")
      anchor.setAttribute("rel", "noopener noreferrer")
    }
  })

  return template.innerHTML
}

function frameDocument(html: string, dark: boolean, allowRemote: boolean) {
  const body = sanitizeMessageHtml(html)
  const resourceSources = allowRemote ? "data: https: http:" : "data:"
  const foreground = dark ? "#ffffff" : "#000000"
  const background = dark ? "#1a1a1a" : "#ffffff"
  const thumb = dark ? "rgba(130,109,217,.3)" : "rgba(130,109,217,.2)"
  const thumbHover = dark ? "rgba(130,109,217,.5)" : "rgba(130,109,217,.4)"
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${resourceSources}; media-src ${resourceSources}; font-src ${resourceSources}; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"><style>html,body{margin:0;padding:0;min-height:100%;font-family:system-ui,-apple-system,sans-serif;color:${foreground};background:${background};color-scheme:${dark ? "dark" : "light"}}body{padding:20px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#2563eb}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${thumb};border-radius:9999px}::-webkit-scrollbar-thumb:hover{background:${thumbHover}}*{scrollbar-width:thin;scrollbar-color:${thumb} transparent}</style></head><body>${body}</body></html>`
}

export function HtmlMessageFrame({ html, title, inlineImages }: HtmlMessageFrameProps) {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  const t = useTranslations("emails.messageView")
  const { data: session, status } = useSession()
  const userId = status === "authenticated" ? session?.user?.id : undefined
  const alwaysAllow = Boolean(userId && !session?.user?.bannedAt && session?.user?.allowRemoteResources)
  const [override, setOverride] = useState<{ userId: string | undefined; value: boolean } | null>(null)
  const allowRemote = override && override.userId === userId ? override.value : alwaysAllow
  const [frame, setFrame] = useState<{
    html: string
    dark: boolean
    images: InlineMessageImage[] | undefined
    source: string
    allowRemote: boolean
  } | null>(null)

  useEffect(() => {
    const sources = new Map<string, string>()
    for (const image of inlineImages || []) {
      if (!/^image\/(png|jpeg|gif|webp|avif|bmp)$/iu.test(image.contentType)) continue
      if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(image.data)) continue
      sources.set(normalizeContentId(image.contentId), "data:" + image.contentType + ";base64," + image.data)
    }
    // Opaque sandbox origins cannot load parent-owned blob URLs. Keep the
    // sandbox and use data images, bounding repeated CID expansion in hostile HTML.
    let remaining = 64 * 1024 * 1024
    const resolved = html.replace(/cid:([^\s"'<>\)]+)/giu, (match, reference: string) => {
      const source = sources.get(normalizeContentId(reference))
      if (!source || source.length > remaining) return match
      remaining -= source.length
      return source
    })
    setFrame({ html, dark, images: inlineImages, allowRemote, source: frameDocument(resolved, dark, allowRemote) })
  }, [dark, html, inlineImages, allowRemote])

  // Mount the sandbox only after srcDoc is ready. Creating an empty frame and
  // mutating srcDoc on the next paint can leave Chromium displaying about:blank
  // until an unrelated viewport resize forces a repaint.
  const frameReady = frame && frame.html === html && frame.dark === dark
    && frame.images === inlineImages && frame.allowRemote === allowRemote

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-primary/20 bg-primary/5 px-3 py-1.5">
        <div className="flex min-w-0 flex-1 basis-32 items-center gap-1.5">
          {allowRemote
            ? <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            : <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />}
          <p className="min-w-0 text-xs leading-relaxed text-muted-foreground" role="status">
            {t(allowRemote ? alwaysAllow && override?.value !== true ? "remoteAlwaysAllowed" : "remoteAllowed" : "remoteBlocked")}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="ml-auto h-auto min-h-8 shrink-0 whitespace-normal px-2 py-1 text-xs" onClick={() => setOverride({ userId, value: !allowRemote })}>
          {t(allowRemote ? "blockRemote" : "loadRemote")}
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {frameReady && <iframe
          title={title}
          srcDoc={frame.source}
          className="absolute inset-0 h-full w-full border-0 bg-transparent"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
        />}
      </div>
    </div>
  )
}
