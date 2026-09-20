import { desc, eq, sql } from "drizzle-orm"
import { createDb } from "@/lib/db"
import { adminAuditLogs, users } from "@/lib/schema"
import { adminJson, authorizeEmperor, pageNumber } from "@/lib/admin-management"
export const runtime = "nodejs"
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  const { id } = await params
  const page = pageNumber(new URL(request.url).searchParams.get("page")), size = 10, db = createDb()
  const [count, items] = await Promise.all([
    db.select({ total: sql<number>`COUNT(*)`.mapWith(Number) }).from(adminAuditLogs).where(eq(adminAuditLogs.userId, id)),
    db.select({ id: adminAuditLogs.id, action: adminAuditLogs.action, target: adminAuditLogs.target, createdAt: adminAuditLogs.createdAt,
      actor: sql<string>`COALESCE(${users.name}, ${users.username}, ${adminAuditLogs.actorId})` }).from(adminAuditLogs)
      .leftJoin(users, eq(users.id, adminAuditLogs.actorId)).where(eq(adminAuditLogs.userId, id))
      .orderBy(desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id)).limit(size).offset((page - 1) * size),
  ])
  return adminJson({ items, total: count[0].total, page, pages: Math.max(1, Math.ceil(count[0].total / size)) })
}
