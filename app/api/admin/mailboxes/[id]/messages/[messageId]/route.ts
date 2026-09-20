import { and, eq } from "drizzle-orm"
import { createDb } from "@/lib/db"
import { messages } from "@/lib/schema"
import { attachmentResponse, messageExtras } from "@/lib/message-attachments"
import { adminChange, adminError, adminHeaders, adminJson, adminMailbox, authorizeEmperor } from "@/lib/admin-management"
export const runtime = "nodejs"
type Context = { params: Promise<{ id: string; messageId: string }> }
export async function GET(request: Request, { params }: Context) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  const { id, messageId } = await params
  const mailbox = await adminMailbox(id)
  if (!mailbox) return adminError("MAILBOX_NOT_FOUND", 404)
  const message = await createDb().query.messages.findFirst({ where: and(eq(messages.id, messageId), eq(messages.emailId, id)) })
  if (!message) return adminError("MESSAGE_NOT_FOUND", 404)
  const download = await attachmentResponse(request, message.id)
  await adminChange({ actorId: auth.principal.userId, userId: mailbox.userId, mailboxId: id, action: download ? "attachment.read" : "message.read", target: message.id })
  if (download) { for (const [key, value] of Object.entries(adminHeaders)) download.headers.set(key, value); return download }
  return adminJson({ message: { id: message.id, from_address: message.fromAddress, to_address: message.toAddress, subject: message.subject,
    ...await messageExtras(message, new URL(request.url).pathname), html: message.html, received_at: message.receivedAt.getTime(), sent_at: message.sentAt.getTime(), type: message.type } })
}
export async function DELETE(request: Request, { params }: Context) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  const { id, messageId } = await params
  const mailbox = await adminMailbox(id)
  if (!mailbox) return adminError("MAILBOX_NOT_FOUND", 404)
  const message = await createDb().query.messages.findFirst({ where: and(eq(messages.id, messageId), eq(messages.emailId, id)), columns: { id: true } })
  if (!message) return adminError("MESSAGE_NOT_FOUND", 404)
  await adminChange({ actorId: auth.principal.userId, userId: mailbox.userId, mailboxId: id, action: "message.delete", target: message.id }, [{ text: 'DELETE FROM message WHERE id = ? AND "emailId" = ?', values: [messageId, id] }])
  return adminJson({ ok: true })
}
