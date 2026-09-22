"use client"

import { useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import type { RemoteResourceReport } from "@/lib/remote-resource-report"

export function RemoteResourceDetails({ report, allowed }: { report: RemoteResourceReport; allowed: boolean }) {
  const t = useTranslations("emails.messageView.resourceDetails")
  const format = useFormatter()
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(report.items.length / 6))
  const current = Math.min(page, pages)
  return <Dialog onOpenChange={open => { if (open) setPage(1) }}>
    <DialogTrigger asChild><Button type="button" variant="ghost" size="sm" className="h-auto min-h-8 shrink-0 px-2 py-1 text-xs">{t("button", { count: report.items.length })}</Button></DialogTrigger>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl flex-col gap-3 overflow-hidden rounded-lg p-4 sm:p-5">
      <DialogHeader className="shrink-0 pr-6 text-left"><DialogTitle className="text-base">{t("title")}</DialogTitle><DialogDescription className="text-xs leading-5">{t(allowed ? "allowed" : "blocked")}</DialogDescription></DialogHeader>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {report.items.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t("empty")}</p> : <ul className="divide-y rounded-md border px-3">{report.items.slice((current - 1) * 6, current * 6).map((item, index) => <li key={`${current}-${index}`} className="min-w-0 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><span className="rounded bg-muted px-1.5 py-0.5">{t(`kinds.${item.kind}`)}</span><span className="text-muted-foreground">{t(item.kind === "style" || item.kind === "other" ? "alwaysBlocked" : allowed ? "permitted" : "denied")}</span>{item.count > 1 && <span className="ml-auto text-muted-foreground">{t("references", { count: item.count })}</span>}</div>
          <p className="mt-1 break-all text-sm font-medium" dir="ltr">{item.source}</p><p className="mt-0.5 break-all font-mono text-xs leading-4 text-muted-foreground" dir="ltr">{item.path}</p>
        </li>)}</ul>}
      </div>
      {pages > 1 && <div className="flex shrink-0 items-center justify-between gap-2"><Button variant="outline" size="sm" disabled={current === 1} onClick={() => setPage(current - 1)}>{t("previous")}</Button><span className="text-xs tabular-nums text-muted-foreground">{t("page", { current: format.number(current), total: format.number(pages) })}</span><Button variant="outline" size="sm" disabled={current === pages} onClick={() => setPage(current + 1)}>{t("next")}</Button></div>}
      <p className="shrink-0 text-xs leading-5 text-muted-foreground">{t("note")}{report.limited && <> {t("limited")}</>}</p>
    </DialogContent>
  </Dialog>
}
