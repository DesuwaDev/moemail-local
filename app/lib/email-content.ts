import { Parser } from "htmlparser2"

/** Decode entities and retain readable block boundaries without rendering HTML. */
export function htmlToPlainText(html: string): string {
  const parts: string[] = []
  let skipped = 0
  const hidden = new Set(["script", "style", "head", "template"])
  const blocks = new Set(["p", "div", "br", "hr", "li", "tr", "table", "section", "article", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"])
  const parser = new Parser({
    onopentag(name) {
      if (hidden.has(name)) skipped++
      if (!skipped && blocks.has(name)) parts.push("\n")
    },
    ontext(text) { if (!skipped) parts.push(text.replace(/\s+/gu, " ")) },
    onclosetag(name) {
      if (hidden.has(name)) skipped = Math.max(0, skipped - 1)
      if (!skipped && blocks.has(name) && name !== "br" && name !== "hr") parts.push("\n")
      if (!skipped && (name === "td" || name === "th")) parts.push(" ")
    },
  }, { decodeEntities: true })
  parser.end(html)
  return parts.join("").replace(/[ \t]*\n[ \t]*/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim()
}

export function emailText(content: string | null | undefined, html: string | null | undefined) {
  return content?.trim() ? content : html ? htmlToPlainText(html) : content || ""
}
