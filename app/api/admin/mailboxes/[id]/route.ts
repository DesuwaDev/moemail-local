import { z } from "zod"
import { adminChange, adminError, adminJson, adminMailbox, authorizeEmperor, reconcileMailboxes } from "@/lib/admin-management"
export const runtime = "nodejs"
type Context = { params: Promise<{ id: string }> }
const updateSchema = z.object({
  disabled: z.boolean().optional(), receiveEnabled: z.boolean().optional(), sendEnabled: z.boolean().optional(), shareEnabled: z.boolean().optional(),
  expiresAt: z.string().datetime({ offset: true }).refine(value => { const time = Date.parse(value); return time > Date.now() && time <= Date.parse("9999-12-31T23:59:59.999Z") }).optional(),
}).strict().refine(value => Object.keys(value).length > 0)
export async function GET(request: Request, { params }: Context) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  const mailbox = await adminMailbox((await params).id)
  return mailbox ? adminJson({ mailbox }) : adminError("MAILBOX_NOT_FOUND", 404)
}
export async function PATCH(request: Request, { params }: Context) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  const payload = updateSchema.safeParse(await request.json().catch(() => null))
  if (!payload.success) return adminError("INVALID_REQUEST", 400)
  const mailbox = await adminMailbox((await params).id)
  if (!mailbox) return adminError("MAILBOX_NOT_FOUND", 404)
  const columns = { disabled: "disabled_at", receiveEnabled: "receive_enabled", sendEnabled: "send_enabled", shareEnabled: "share_enabled", expiresAt: "expires_at" }
  const entries = Object.entries(payload.data) as Array<[keyof typeof columns, boolean | string]>
  try {
    await adminChange({ actorId: auth.principal.userId, userId: mailbox.userId, mailboxId: mailbox.id, action: "mailbox.update", target: mailbox.address }, [{
      text: "UPDATE email SET " + entries.map(([key]) => columns[key] + " = ?").join(", ") + " WHERE id = ?",
      values: [...entries.map(([key, value]) => key === "disabled" ? (value ? new Date() : null) : key === "expiresAt" ? new Date(value as string) : value), mailbox.id],
    }])
    reconcileMailboxes()
    return adminJson({ mailbox: await adminMailbox(mailbox.id) })
  } catch (error) { console.error("admin.mailbox_update_failed", error); return adminError("ADMIN_OPERATION_FAILED", 500) }
}
export async function DELETE(request: Request, { params }: Context) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  const mailbox = await adminMailbox((await params).id)
  if (!mailbox) return adminError("MAILBOX_NOT_FOUND", 404)
  try {
    await adminChange({ actorId: auth.principal.userId, userId: mailbox.userId, mailboxId: mailbox.id, action: "mailbox.delete", target: mailbox.address }, [{ text: "DELETE FROM email WHERE id = ?", values: [mailbox.id] }])
    reconcileMailboxes()
    return adminJson({ ok: true })
  } catch (error) { console.error("admin.mailbox_delete_failed", error); return adminError("MAILBOX_DELETE_FAILED", 500) }
}
