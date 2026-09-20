import { z } from "zod"
import { adminChange, adminError, adminJson, authorizeEmperor } from "@/lib/admin-management"
export const runtime = "nodejs"
const schema = z.object({ action: z.enum(["sessions", "apiKeys", "webhooks", "shares"]) }).strict()
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  const payload = schema.safeParse(await request.json().catch(() => null))
  if (!payload.success) return adminError("INVALID_REQUEST", 400)
  const { id } = await params
  const statements = {
    sessions: [{ text: 'UPDATE "user" SET session_version = session_version + 1 WHERE id = ?', values: [id] }],
    apiKeys: [{ text: 'UPDATE api_keys SET enabled = ? WHERE user_id = ?', values: [false, id] }],
    webhooks: [{ text: 'UPDATE webhook SET enabled = ? WHERE user_id = ?', values: [false, id] }],
    shares: [
      { text: 'DELETE FROM email_share WHERE email_id IN (SELECT id FROM email WHERE "userId" = ?)', values: [id] },
      { text: 'DELETE FROM message_share WHERE message_id IN (SELECT m.id FROM message m JOIN email e ON e.id = m."emailId" WHERE e."userId" = ?)', values: [id] },
    ],
  }
  try {
    const result = await adminChange({ actorId: auth.principal.userId, userId: id, action: "user." + payload.data.action, target: id }, statements[payload.data.action], true)
    if (result === "not_found") return adminError("USER_NOT_FOUND", 404)
    if (result === "protected") return adminError("EMPEROR_POLICY_IMMUTABLE", 403)
    return adminJson({ ok: true })
  } catch (error) { console.error("admin.user_action_failed", error); return adminError("ADMIN_OPERATION_FAILED", 500) }
}
