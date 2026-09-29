import { eq } from "drizzle-orm"
import { adminError, adminJson, authorizeEmperor } from "@/lib/admin-management"
import { createDb } from "@/lib/db"
import { passkeyFailure } from "@/lib/passkey-management"
import { listPasskeys } from "@/lib/passkeys"
import { users } from "@/lib/schema"

export const runtime = "nodejs"
type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Context) {
  const auth = await authorizeEmperor(request)
  if (!auth.ok) return auth.response
  const userId = (await params).id
  try {
    const user = await createDb().query.users.findFirst({ where: eq(users.id, userId), columns: { id: true } })
    if (!user) return adminError("USER_NOT_FOUND", 404)
    return adminJson({ items: await listPasskeys(userId) })
  } catch (error) {
    return passkeyFailure(error, "PASSKEYS_READ_FAILED")
  }
}
