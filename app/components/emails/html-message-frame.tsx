"use client"

import { useEffect, useState } from "react"
import { normalizeContentId, type InlineMessageImage } from "@/lib/attachment-types"
import { useTheme } from "next-themes"

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
  "object",
  "script",
  "select",
  "textarea",
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
  const document = new DOMParser().parseFromString(html, "text/html")

  document.querySelectorAll("form").forEach(form => form.replaceWith(...form.childNodes))
  document.querySelectorAll(blockedElements.join(",")).forEach(element => element.remove())
  document.querySelectorAll("*").forEach(element => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith("on") || name === "formaction" || name === "srcdoc") {
        element.removeAttribute(attribute.name)
      }
    }
    element.removeAttribute("autoplay")
  })
  document.querySelectorAll("a").forEach(anchor => {
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

  const styles = [...document.head.querySelectorAll("style")]
    .map(style => style.outerHTML)
    .join("")
  return { body: document.body.innerHTML, styles }
}

function frameDocument(html: string, dark: boolean) {
  const { body, styles } = sanitizeMessageHtml(html)
  const foreground = dark ? "#ffffff" : "#000000"
  const background = dark ? "#1a1a1a" : "#ffffff"
  const thumb = dark ? "rgba(130,109,217,.3)" : "rgba(130,109,217,.2)"
  const thumbHover = dark ? "rgba(130,109,217,.5)" : "rgba(130,109,217,.4)"
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid: https: http:; media-src data: https: http:; font-src data: https: http:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'">${styles}<style>html,body{margin:0;padding:0;min-height:100%;font-family:system-ui,-apple-system,sans-serif;color:${foreground};background:${background};color-scheme:${dark ? "dark" : "light"}}body{padding:20px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#2563eb}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${thumb};border-radius:9999px}::-webkit-scrollbar-thumb:hover{background:${thumbHover}}*{scrollbar-width:thin;scrollbar-color:${thumb} transparent}</style></head><body>${body}</body></html>`
}

export function HtmlMessageFrame({ html, title, inlineImages }: HtmlMessageFrameProps) {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  const [frame, setFrame] = useState<{
    html: string
    dark: boolean
    images: InlineMessageImage[] | undefined
    source: string
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
    setFrame({ html, dark, images: inlineImages, source: frameDocument(resolved, dark) })
  }, [dark, html, inlineImages])

  // Mount the sandbox only after srcDoc is ready. Creating an empty frame and
  // mutating srcDoc on the next paint can leave Chromium displaying about:blank
  // until an unrelated viewport resize forces a repaint.
  if (!frame || frame.html !== html || frame.dark !== dark || frame.images !== inlineImages) {
    return <div aria-hidden="true" className="h-full w-full bg-background" />
  }

  return (
    <iframe
      title={title}
      srcDoc={frame.source}
      className="absolute inset-0 h-full w-full border-0 bg-transparent"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
    />
  )
}
