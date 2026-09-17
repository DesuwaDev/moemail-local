import { randomUUID } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import type { Attachment } from "postal-mime"
import { createDb } from "./db"
import { messageAttachments } from "./schema"
import { apiError } from "./api-response"
import { emailText } from "./email-content"
import { normalizeContentId as cid, type MessageAttachment, type InlineMessageImage } from "./attachment-types"

export function prepareAttachments(attachments: Attachment[]) {
  return attachments.map((attachment, index) => {
    const data = typeof attachment.content === "string"
      ? Buffer.from(attachment.content, attachment.encoding === "base64" ? "base64" : "utf8")
      : Buffer.from(attachment.content instanceof ArrayBuffer ? new Uint8Array(attachment.content) : attachment.content)
    return {
      id: randomUUID(),
      filename: Buffer.from((attachment.filename || `attachment-${index + 1}`).replace(/[\x00-\x1f\x7f/\\]/gu, "_").slice(0, 240)).toString("utf8"),
      contentType: attachment.mimeType || "application/octet-stream",
      contentId: attachment.contentId || null,
      size: data.byteLength,
      data,
    }
  })
}

/** Call only after mailbox ownership or the public share has been authorized. */
export async function messageExtras(message: { id: string; content: string | null; html: string | null }, path: string) {
  const db = createDb()
  const rows = await db.select({
    id: messageAttachments.id, filename: messageAttachments.filename,
    contentType: messageAttachments.contentType, contentId: messageAttachments.contentId,
    size: messageAttachments.size,
  }).from(messageAttachments).where(eq(messageAttachments.messageId, message.id))
  const attachments: MessageAttachment[] = rows.map(row => ({ ...row, download_url: `${path}?attachment=${encodeURIComponent(row.id)}` }))
  const references = new Set([... (message.html || "").matchAll(/cid:([^\s"'<>\)]+)/giu)].map(match => cid(match[1])))
  const inline = rows.filter(row => row.contentId && references.has(cid(row.contentId)) && /^image\/(png|jpeg|gif|webp|avif|bmp)$/iu.test(row.contentType))
  let inlineImages: InlineMessageImage[] = []
  if (inline.length) {
    const bodies = await db.select().from(messageAttachments).where(and(
      eq(messageAttachments.messageId, message.id), inArray(messageAttachments.id, inline.map(row => row.id)),
    ))
    inlineImages = bodies.map(row => ({ contentId: cid(row.contentId!), contentType: row.contentType, data: row.data.toString("base64") }))
  }
  return { content: emailText(message.content, message.html), attachments, inline_images: inlineImages }
}

/** The caller must authorize the message before reaching this function. */
export async function attachmentResponse(request: Request, messageId: string): Promise<Response | null> {
  const id = new URL(request.url).searchParams.get("attachment")
  if (id === null) return null
  const attachment = await createDb().query.messageAttachments.findFirst({ where: and(
    eq(messageAttachments.messageId, messageId), eq(messageAttachments.id, id),
  ) })
  if (!attachment) return apiError("MESSAGE_NOT_FOUND", 404)
  const filename = encodeURIComponent(attachment.filename).replace(/['()*]/gu, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return new Response(new Uint8Array(attachment.data), { headers: {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="attachment"; filename*=UTF-8''${filename}`,
    "Content-Length": String(attachment.size),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  } })
}
