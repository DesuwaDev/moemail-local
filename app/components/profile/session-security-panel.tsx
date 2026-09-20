"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog"
import { useToast } from "@/components/ui/use-toast"
import { useCurrentOriginSignOut } from "@/hooks/use-current-origin-sign-out"
import { LocalizedUiError } from "@/lib/localized-ui-error"

export function SessionSecurityPanel() {
  const t = useTranslations("profile.security")
  const actions = useTranslations("common.actions")
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const { toast } = useToast()
  const { signOutFromCurrentOrigin } = useCurrentOriginSignOut()

  const revoke = async () => {
    setBusy(true)
    try {
      const response = await fetch("/api/account/sessions", { method: "DELETE" })
      if (!response.ok) throw new LocalizedUiError(t("failed"))
      await signOutFromCurrentOrigin()
      // Revocation already succeeded even if clearing the local cookie failed.
      window.location.replace(new URL("/", window.location.origin).href)
    } catch {
      toast({ title: t("failed"), variant: "destructive" })
      setBusy(false)
    }
  }

  return <section className="rounded-lg border-2 border-primary/20 bg-background p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" />{t("title")}</h2>
      </div>
      <AlertDialog open={open} onOpenChange={value => { if (!busy) setOpen(value) }}>
        <AlertDialogTrigger asChild><Button variant="outline" className="shrink-0">{t("revoke")}</Button></AlertDialogTrigger>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg p-4 sm:p-6">
          <AlertDialogHeader><AlertDialogTitle>{t("revoke")}</AlertDialogTitle><AlertDialogDescription>{t("confirm")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{actions("cancel")}</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={() => void revoke()} className="gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t("revoke")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("description")}</p>
  </section>
}
