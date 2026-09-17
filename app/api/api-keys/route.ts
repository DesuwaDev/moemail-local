import { createDb } from "@/lib/db"
import { apiKeys, emails } from "@/lib/schema"
import { nanoid } from "nanoid"
import { NextResponse } from "next/server"
import { PERMISSIONS } from "@/lib/permissions"
import { and, desc, eq } from "drizzle-orm"
import { authorizeRequest } from "@/lib/request-auth"
import { apiError } from "@/lib/api-response"
import { digestApiKey } from "@/lib/api-key-digest"
import { createApiKeySchema } from "@/lib/api-key-policy"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const authorization = await authorizeRequest(request, {
    permission: PERMISSIONS.MANAGE_API_KEY,
  })
  if (!authorization.ok) return authorization.response

  try {
    const db = createDb()
    const keys = await db.select({
      id: apiKeys.id, name: apiKeys.name, createdAt: apiKeys.createdAt,
      expiresAt: apiKeys.expiresAt, enabled: apiKeys.enabled,
      accessLevel: apiKeys.accessLevel, mailboxId: apiKeys.mailboxId,
      mailboxAddress: emails.address,
    }).from(apiKeys)
      .leftJoin(emails, and(eq(apiKeys.mailboxId, emails.id), eq(emails.userId, apiKeys.userId)))
      .where(eq(apiKeys.userId, authorization.principal.userId))
      .orderBy(desc(apiKeys.createdAt))

    return NextResponse.json({
      apiKeys: keys
    })
  } catch (error) {
    console.error("api_key.read_failed", error)
    return apiError("API_KEYS_READ_FAILED", 500)
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeRequest(request, {
    permission: PERMISSIONS.MANAGE_API_KEY,
  })
  if (!authorization.ok) return authorization.response

  try {
    const parsed = createApiKeySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return apiError("INVALID_REQUEST", 400)
    const { name, accessLevel, mailboxAddress, expiresInDays } = parsed.data

    const key = `mk_${nanoid(32)}`
    const db = createDb()
    let mailboxId: string | null = null
    if (mailboxAddress) {
      const mailbox = await db.query.emails.findFirst({
        where: and(eq(emails.address, mailboxAddress), eq(emails.userId, authorization.principal.userId)),
        columns: { id: true },
      })
      if (!mailbox) return apiError("MAILBOX_NOT_FOUND", 404)
      mailboxId = mailbox.id
    }
    
    await db.insert(apiKeys).values({
      name,
      accessLevel,
      mailboxId,
      key: digestApiKey(key),
      userId: authorization.principal.userId,
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
    })

    return NextResponse.json({ key })
  } catch (error) {
    console.error("api_key.create_failed", error)
    return apiError("API_KEY_CREATE_FAILED", 500)
  }
}
