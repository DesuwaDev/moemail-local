"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { EmailList } from "./email-list"
import { MessageListContainer } from "./message-list-container"
import { MessageView } from "./message-view"
import { SendDialog } from "./send-dialog"
import { cn } from "@/lib/utils"
import { useCopy } from "@/hooks/use-copy"
import { useSendPermission } from "@/hooks/use-send-permission"
import { Copy } from "lucide-react"

interface Email {
  id: string
  address: string
}

export function ThreeColumnLayout() {
  const t = useTranslations("emails.layout")
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [selectedMessageType, setSelectedMessageType] = useState<'received' | 'sent'>('received')
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const { copyToClipboard } = useCopy()
  const {
    canSend: canSendEmails,
    canUsePrivateRecipientDelivery,
    checkPermission: refreshSendPermission,
  } = useSendPermission(selectedEmail?.id)

  const columnClass = "min-w-0 min-h-0 border-2 border-primary/20 bg-background rounded-lg overflow-hidden flex flex-col"
  const headerClass = "p-2 border-b-2 border-primary/20 flex items-center justify-between shrink-0"
  const titleClass = "text-sm font-bold px-2 w-full overflow-hidden"

  // 移动端视图逻辑
  const getMobileView = () => {
    if (selectedMessageId) return "message"
    if (selectedEmail) return "emails"
    return "list"
  }

  const mobileView = getMobileView()

  const copyEmailAddress = () => {
    copyToClipboard(selectedEmail?.address || "")
  }

  const handleMessageSelect = (messageId: string | null, messageType: 'received' | 'sent' = 'received') => {
    setSelectedMessageId(messageId)
    setSelectedMessageType(messageType)
  }

  const handleSendSuccess = () => {
    setRefreshTrigger(prev => prev + 1)
    void refreshSendPermission()
  }

  return (
    <div className="flex h-full min-h-0 flex-col pb-5 pt-20">
      {/* Keep one preview mounted across breakpoints so hidden copies cannot load trackers. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full min-h-0">
        <div className={cn("lg:col-span-3", columnClass, mobileView !== "list" && "hidden lg:flex")}>
          <div className={headerClass}>
            <h2 className={titleClass}>{t("myEmails")}</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <EmailList
              onEmailSelect={(email) => {
                setSelectedEmail(email)
                setSelectedMessageId(null)
              }}
              selectedEmailId={selectedEmail?.id}
            />
          </div>
        </div>

        <div className={cn("lg:col-span-4", columnClass, mobileView !== "emails" && "hidden lg:flex")}>
          <div className={cn(headerClass, "gap-2")}>
            <button onClick={() => setSelectedEmail(null)} className="shrink-0 text-sm text-primary lg:hidden">{t("backToEmailList")}</button>
            <h2 className={cn(titleClass, "min-w-0")}>
              {selectedEmail ? (
                <div className="w-full flex justify-between items-center gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate min-w-0">{selectedEmail.address}</span>
                    <div className="shrink-0 cursor-pointer text-primary" onClick={copyEmailAddress}>
                      <Copy className="size-4" />
                    </div>
                  </div>
                  {selectedEmail && canSendEmails && (
                    <SendDialog 
                      emailId={selectedEmail.id} 
                      fromAddress={selectedEmail.address}
                      canUsePrivateDelivery={canUsePrivateRecipientDelivery}
                      onSendSuccess={handleSendSuccess}
                    />
                  )}
                </div>
              ) : (
                t("selectEmail")
              )}
            </h2>
          </div>
          {selectedEmail && (
            <div className="min-h-0 flex-1 overflow-auto">
              <MessageListContainer
                email={selectedEmail}
                onMessageSelect={handleMessageSelect}
                selectedMessageId={selectedMessageId}
                refreshTrigger={refreshTrigger}
              />
            </div>
          )}
        </div>

        <div className={cn("lg:col-span-5", columnClass, mobileView !== "message" && "hidden lg:flex")}>
          <div className={cn(headerClass, "gap-2")}>
            <button onClick={() => setSelectedMessageId(null)} className="shrink-0 text-sm text-primary lg:hidden">{t("backToMessageList")}</button>
            <h2 className={cn(titleClass, "text-right lg:text-left")}>
              {selectedMessageId ? t("messageContent") : t("selectMessage")}
            </h2>
          </div>
          {selectedEmail && selectedMessageId && (
            <div className="min-h-0 flex-1 overflow-auto">
              <MessageView
                emailId={selectedEmail.id}
                messageId={selectedMessageId}
                messageType={selectedMessageType}
                onClose={() => setSelectedMessageId(null)}
              />
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
