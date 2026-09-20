import { and, desc, eq, gt, isNotNull, isNull, lte, sql } from "drizzle-orm"
import { createDb } from "@/lib/db"
import { emails, users } from "@/lib/schema"
import { adminJson, adminError, authorizeEmperor, mailboxCounts, pageNumber } from "@/lib/admin-management"
export const runtime = "nodejs"
export async function GET(request: Request) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  try {
    const params = new URL(request.url).searchParams
    const page = pageNumber(params.get("page")), pageSize = pageNumber(params.get("pageSize"), 8, 50)
    const search = params.get("search")?.trim().slice(0, 200).toLowerCase()
    const conditions = []
    if (params.get("userId")) conditions.push(eq(emails.userId, params.get("userId")!))
    if (search) conditions.push(sql`LOWER(${emails.address}) LIKE ${"%" + search.replace(/[!%_]/g, character => "!" + character) + "%"} ESCAPE '!'`)
    if (params.get("status") === "disabled") conditions.push(isNotNull(emails.disabledAt))
    if (params.get("status") === "expired") conditions.push(lte(emails.expiresAt, new Date()))
    if (params.get("status") === "active") conditions.push(isNull(emails.disabledAt), gt(emails.expiresAt, new Date()))
    const db = createDb()
    const [count, items] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)`.mapWith(Number) }).from(emails).where(and(...conditions)),
      db.select({ id: emails.id, address: emails.address, userId: emails.userId,
        owner: sql<string | null>`COALESCE(${users.name}, ${users.username}, ${users.email})`,
        createdAt: emails.createdAt, expiresAt: emails.expiresAt, disabledAt: emails.disabledAt,
        receiveEnabled: emails.receiveEnabled, sendEnabled: emails.sendEnabled, shareEnabled: emails.shareEnabled,
        ...mailboxCounts,
      }).from(emails).leftJoin(users, eq(users.id, emails.userId)).where(and(...conditions))
        .orderBy(desc(emails.createdAt), desc(emails.id)).limit(pageSize).offset((page - 1) * pageSize),
    ])
    return adminJson({ items, total: count[0].count, page, pageSize, pages: Math.max(1, Math.ceil(count[0].count / pageSize)) })
  } catch (error) { console.error("admin.mailboxes_read_failed", error); return adminError("MAILBOXES_READ_FAILED", 500) }
}
