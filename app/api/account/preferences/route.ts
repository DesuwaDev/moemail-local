import { eq } from "drizzle-orm"
import { z } from "zod"
import { authorizeRequest } from "@/lib/request-auth"
import { createDb } from "@/lib/db"
import { users } from "@/lib/schema"
import { apiError } from "@/lib/api-response"

export const runtime = "nodejs"
const preferencesSchema = z.object({ allowRemoteResources: z.boolean() }).strict()

export async function PATCH(request: Request) {
  const authorization = await authorizeRequest(request)
  if (!authorization.ok) return authorization.response
  let input: unknown
  try { input = await request.json() } catch { return apiError("INVALID_JSON", 400) }
  const parsed = preferencesSchema.safeParse(input)
  if (!parsed.success) return apiError("INVALID_REQUEST", 400)
  try {
    const [updated] = await createDb().update(users).set(parsed.data)
      .where(eq(users.id, authorization.principal.userId))
      .returning({ allowRemoteResources: users.allowRemoteResources })
    if (!updated) return apiError("UNAUTHORIZED", 401)
    return Response.json(updated, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    console.error("account.preferences_save_failed", { name: error instanceof Error ? error.name : "UnknownError" })
    return apiError("ACCOUNT_PREFERENCES_SAVE_FAILED", 500)
  }
}
