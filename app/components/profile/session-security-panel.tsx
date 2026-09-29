"use client"
import { useState } from "react"
import { useTranslations } from "next-intl"
import { Fingerprint, MonitorSmartphone, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useAdminData } from "./admin-controls"
import { PasskeyManager } from "./passkey-manager"
import { SessionManager } from "./session-manager"

const dialogClass = "max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto rounded-lg p-3 sm:p-5"

export function SessionSecurityPanel() {
  const t = useTranslations("profile.security"), [open, setOpen] = useState(false)
  const [passkeysOpen, setPasskeysOpen] = useState(false), [revision, setRevision] = useState(0)
  const passkeys = useAdminData<{ items: unknown[] }>("/api/account/passkeys", revision)
  const passkeyCount = passkeys.data?.items.length ?? 0
  return <section className="min-w-0 rounded-lg border-2 border-primary/20 bg-background p-3 sm:p-4">
    <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" />{t("title")}</h2>
    <div className="mt-1 divide-y">
      <div className="flex items-center gap-3 py-2.5">
        <Fingerprint aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("passkeys.title")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{passkeyCount ? t("passkeys.summaryCount", { count: passkeyCount }) : t("passkeys.summaryNone")}</p>
        </div>
        <Dialog open={passkeysOpen} onOpenChange={value => { setPasskeysOpen(value); if (!value) setRevision(current => current + 1) }}>
          <DialogTrigger asChild><Button size="sm" variant={passkeyCount || passkeys.loading ? "outline" : "default"} className="shrink-0">{t(passkeyCount || passkeys.loading ? "passkeys.manage" : "passkeys.add")}</Button></DialogTrigger>
          <DialogContent className={dialogClass}>
            <DialogHeader className="pr-7 text-left"><DialogTitle>{t("passkeys.title")}</DialogTitle><DialogDescription>{t("passkeys.dialogDescription")}</DialogDescription></DialogHeader>
            {passkeysOpen && <PasskeyManager />}
          </DialogContent>
        </Dialog>
      </div>
      <div className="flex items-center gap-3 pt-2.5">
        <MonitorSmartphone aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("sessions.manage")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("sessions.summary")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline" className="shrink-0">{t("manage")}</Button></DialogTrigger>
          <DialogContent className={dialogClass}>
            <DialogHeader className="pr-7 text-left"><DialogTitle>{t("sessions.title")}</DialogTitle><DialogDescription>{t("sessions.description")}</DialogDescription></DialogHeader>
            {open && <SessionManager />}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  </section>
}
