import { and, eq, gt, isNull } from "drizzle-orm"
import { createDb } from "./db"
import { emails } from "./schema"

/**
 * Active-use boundary for mailbox APIs. Listing already hides expired
 * mailboxes; direct ID-based routes must enforce the same invariant so an old
 * URL or API key cannot keep using a mailbox after its configured lifetime.
 */
export function findOwnedActiveMailbox(userId: string, mailboxId: string) {
  return createDb().query.emails.findFirst({
    where: and(
      eq(emails.id, mailboxId),
      eq(emails.userId, userId),
      gt(emails.expiresAt, new Date()),
      isNull(emails.disabledAt),
    ),
  })
}

export async function ownedMailboxState(userId: string, mailboxId: string) {
  const mailbox = await createDb().query.emails.findFirst({
    where: eq(emails.id, mailboxId),
    columns: { userId: true, expiresAt: true, disabledAt: true },
  })
  if (!mailbox) return "not_found" as const
  if (mailbox.userId !== userId) return "forbidden" as const
  if (mailbox.expiresAt.getTime() <= Date.now()) return "expired" as const
  if (mailbox.disabledAt) return "disabled" as const
  return "active" as const
}

/** Share tokens cannot bypass current mailbox or owner restrictions. */
export async function isMailboxShareAvailable(mailbox: { userId: string | null; expiresAt: Date; disabledAt: Date | null; shareEnabled: boolean }) {
  if (mailbox.disabledAt || !mailbox.shareEnabled || mailbox.expiresAt.getTime() <= Date.now() || !mailbox.userId) return false
  const { isUserBanned } = await import("./user-status")
  if (await isUserBanned(mailbox.userId) !== false) return false
  const { getUserAccessPolicy } = await import("./user-access")
  const { PERMISSIONS } = await import("./permissions")
  const access = await getUserAccessPolicy(mailbox.userId)
  return [PERMISSIONS.VIEW_EMAIL, PERMISSIONS.VIEW_MESSAGE_CONTENT, PERMISSIONS.DOWNLOAD_ATTACHMENT, PERMISSIONS.SHARE_EMAIL].every(permission => access.permissions[permission])
}
