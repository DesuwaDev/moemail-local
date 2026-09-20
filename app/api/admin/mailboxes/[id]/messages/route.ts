import { and, desc, eq, sql } from "drizzle-orm"
import { createDb } from "@/lib/db"
import { messages } from "@/lib/schema"
import { adminError, adminJson, adminMailbox, authorizeEmperor, messageFields, pageNumber } from "@/lib/admin-management"
export const runtime = "nodejs"
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  const { id } = await params
  const mailbox = await adminMailbox(id)
  if (!mailbox) return adminError("MAILBOX_NOT_FOUND", 404)
  const query = new URL(request.url).searchParams, page = pageNumber(query.get("page")), pageSize = 10
  const sent = query.get("folder") === "sent", search = query.get("search")?.trim().slice(0, 200).toLowerCase()
  const conditions = [eq(messages.emailId, id), sent ? eq(messages.type, "sent") : sql`COALESCE(${messages.type}, 'received') <> 'sent'`]
  if (search) conditions.push(sql`LOWER(${messages.subject} || ' ' || COALESCE(${messages.fromAddress}, '') || ' ' || COALESCE(${messages.toAddress}, '')) LIKE ${"%" + search.replace(/[!%_]/g, character => "!" + character) + "%"} ESCAPE '!'`)
  const db = createDb()
  const [count, items] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)`.mapWith(Number) }).from(messages).where(and(...conditions)),
    db.select(messageFields).from(messages).where(and(...conditions)).orderBy(desc(sent ? messages.sentAt : messages.receivedAt), desc(messages.id)).limit(pageSize).offset((page - 1) * pageSize),
  ])
  return adminJson({ mailbox, items, total: count[0].count, page, pages: Math.max(1, Math.ceil(count[0].count / pageSize)) })
}
