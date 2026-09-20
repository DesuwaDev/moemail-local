"use client"
import { useState } from "react"
import { useTranslations } from "next-intl"
import { ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { SessionManager } from "./session-manager"

export function SessionSecurityPanel() {
  const t = useTranslations("profile.security"), [open, setOpen] = useState(false)
  return <section className="rounded-lg border-2 border-primary/20 bg-background p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" />{t("title")}</h2>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><Button size="sm" variant="outline">{t("sessions.manage")}</Button></DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto rounded-lg p-3 sm:p-5">
          <DialogHeader className="pr-7 text-left"><DialogTitle>{t("sessions.title")}</DialogTitle><DialogDescription>{t("sessions.description")}</DialogDescription></DialogHeader>
          {open && <SessionManager />}
        </DialogContent>
      </Dialog>
    </div>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("sessions.summary")}</p>
  </section>
}
