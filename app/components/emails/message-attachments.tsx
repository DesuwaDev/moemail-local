"use client"

import { Paperclip } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import type { MessageAttachment } from "@/lib/attachment-types"

export function MessageAttachments({ attachments }: { attachments?: MessageAttachment[] }) {
  const format = useFormatter()
  const t = useTranslations("emails.messageView")
  if (!attachments?.length) return null
  return <div className="max-h-32 shrink-0 overflow-y-auto border-b border-primary/20 p-3">
    <p className="mb-1 text-xs font-medium">{t("attachments")}</p>
    <ul className="space-y-1">
      {attachments.map(attachment => <li key={attachment.id}>
        <a href={attachment.download_url} download className="flex min-w-0 items-center gap-2 text-xs text-primary hover:underline">
          <Paperclip aria-hidden="true" className="h-3 w-3 shrink-0" />
          <span className="min-w-0 truncate" title={attachment.filename}>{attachment.filename}</span>
          <span className="shrink-0 text-muted-foreground">{format.number(attachment.size, { style: "unit", unit: "byte", notation: "compact", maximumFractionDigits: 1 })}</span>
        </a>
      </li>)}
    </ul>
  </div>
}
