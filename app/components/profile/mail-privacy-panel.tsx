"use client"

import { useEffect, useState } from "react"
import { getSession, useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Eye, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog"
import { useToast } from "@/components/ui/use-toast"
import { LocalizedUiError } from "@/lib/localized-ui-error"

export function MailPrivacyPanel() {
  const t = useTranslations("profile.mailPrivacy")
  const actions = useTranslations("common.actions")
  const { data: session, status } = useSession()
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saved, setSaved] = useState<{ userId: string; enabled: boolean } | null>(null)
  const { toast } = useToast()
  const enabled = saved && saved.userId === session?.user?.id ? saved.enabled : session?.user?.allowRemoteResources === true
  useEffect(() => { setSaved(null) }, [session?.user?.id, session?.user?.allowRemoteResources])

  const save = async (allowRemoteResources: boolean) => {
    if (!session?.user?.id || saving) return
    setSaving(true)
    try {
      const response = await fetch("/api/account/preferences", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowRemoteResources }),
      })
      if (!response.ok) throw new LocalizedUiError(t("failed"))
      setSaved({ userId: session.user.id, enabled: allowRemoteResources })
      setConfirming(false)
      // Refresh through the public broadcast path without update() switching the
      // global session to loading and unmounting protected panels and their drafts.
      // Each tab re-reads server-owned preferences; no client JWT data is trusted.
      const refreshed = await getSession({ broadcast: true })
      if (!refreshed) throw new LocalizedUiError(t("failed"))
    } catch {
      toast({ title: t("failed"), variant: "destructive" })
    } finally { setSaving(false) }
  }

  return <section className="min-w-0 rounded-lg border-2 border-primary/20 bg-background p-3 sm:p-4">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Eye aria-hidden="true" className="size-4 shrink-0 text-primary" />{t("title")}</h2>
        <Label htmlFor="allow-remote-resources" className="block text-sm leading-relaxed">{t("alwaysAllow")}</Label>
        <p id="mail-privacy-help" className="text-xs leading-relaxed text-muted-foreground">{t(enabled ? "enabledHelp" : "disabledHelp")}</p>
      </div>
      <Switch id="allow-remote-resources" aria-describedby="mail-privacy-help" className="mt-1 shrink-0" checked={enabled} disabled={saving || status !== "authenticated"} onCheckedChange={value => value ? setConfirming(true) : void save(false)} />
    </div>
    <AlertDialog open={confirming} onOpenChange={value => { if (!saving) setConfirming(value) }}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg p-4 sm:p-6">
        <AlertDialogHeader><AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle><AlertDialogDescription>{t("confirmHelp")}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={saving}>{actions("cancel")}</AlertDialogCancel><Button disabled={saving} className="gap-2" onClick={() => void save(true)}>{saving && <Loader2 className="size-4 animate-spin" />}{t("enable")}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
}
