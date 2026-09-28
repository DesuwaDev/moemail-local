"use client"

import { useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { isSelectableRemoteKind, remoteResourceAllowed, remoteResourceKey, type RemoteResourceReport } from "@/lib/remote-resource-report"

interface RemoteResourceDetailsProps {
  report: RemoteResourceReport
  allowed: boolean
  selected: string[]
  onApply: (keys: string[]) => void
}

export function RemoteResourceDetails({ report, allowed, selected, onApply }: RemoteResourceDetailsProps) {
  const t = useTranslations("emails.messageView.resourceDetails")
  const format = useFormatter()
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const pages = Math.max(1, Math.ceil(report.items.length / 6))
  const current = Math.min(page, pages)
  const applied = new Set(selected)
  const selectable = allowed ? [] : report.items.filter(item => isSelectableRemoteKind(item.kind)).map(remoteResourceKey)
  const allDrafted = selectable.length > 0 && selectable.every(key => draft.has(key))
  const unchanged = draft.size === applied.size && [...draft].every(key => applied.has(key))
  const toggle = (key: string, checked: boolean) => setDraft(previous => {
    const next = new Set(previous)
    if (checked) next.add(key)
    else next.delete(key)
    return next
  })
  const status = (item: RemoteResourceReport["items"][number]) => !isSelectableRemoteKind(item.kind)
    ? "alwaysBlocked"
    : allowed || remoteResourceAllowed(item, applied) ? "permitted" : "denied"

  return <Dialog open={open} onOpenChange={next => {
    if (next) {
      setPage(1)
      setDraft(new Set(selected))
    }
    setOpen(next)
  }}>
    <DialogTrigger asChild><Button type="button" variant="ghost" size="sm" className="h-auto min-h-8 shrink-0 px-2 py-1 text-xs">{t("button", { count: report.items.length })}</Button></DialogTrigger>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl flex-col gap-3 overflow-hidden rounded-lg p-4 sm:p-5">
      <DialogHeader className="shrink-0 pr-6 text-left"><DialogTitle className="text-base">{t("title")}</DialogTitle><DialogDescription className="text-xs leading-5">{t(allowed ? "allowed" : selectable.length > 0 ? "selectable" : "blocked")}</DialogDescription></DialogHeader>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {report.items.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t("empty")}</p> : <ul className="divide-y rounded-md border px-3">{report.items.slice((current - 1) * 6, current * 6).map(item => {
          const key = remoteResourceKey(item)
          const canSelect = !allowed && isSelectableRemoteKind(item.kind)
          const body = <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><span className="rounded bg-muted px-1.5 py-0.5">{t(`kinds.${item.kind}`)}</span><span className="text-muted-foreground">{t(status(item))}</span>{item.count > 1 && <span className="ml-auto text-muted-foreground">{t("references", { count: item.count })}</span>}</div>
            <p className="mt-1 break-all text-sm font-medium" dir="ltr">{item.source}</p><p className="mt-0.5 break-all font-mono text-xs leading-4 text-muted-foreground" dir="ltr">{item.path}</p>
          </>
          return <li key={key} className="min-w-0 py-2.5">
            {canSelect
              ? <label className="flex cursor-pointer items-start gap-3"><Checkbox className="mt-0.5" checked={draft.has(key)} onChange={checked => toggle(key, checked)} aria-label={t("selectItem", { source: item.source })} /><div className="min-w-0 flex-1">{body}</div></label>
              : body}
          </li>
        })}</ul>}
      </div>
      {pages > 1 && <div className="flex shrink-0 items-center justify-between gap-2"><Button variant="outline" size="sm" disabled={current === 1} onClick={() => setPage(current - 1)}>{t("previous")}</Button><span className="text-xs tabular-nums text-muted-foreground">{t("page", { current: format.number(current), total: format.number(pages) })}</span><Button variant="outline" size="sm" disabled={current === pages} onClick={() => setPage(current + 1)}>{t("next")}</Button></div>}
      {selectable.length > 0 && <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t pt-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(allDrafted ? new Set() : new Set(selectable))}>{t(allDrafted ? "clearSelection" : "selectAll")}</Button>
        <Button type="button" size="sm" disabled={unchanged} onClick={() => { onApply([...draft]); setOpen(false) }}>
          {draft.size > 0 ? t("loadSelected", { count: draft.size }) : t("blockSelected")}
        </Button>
      </div>}
      <p className="shrink-0 text-xs leading-5 text-muted-foreground">{t("note")}{report.limited && <> {t("limited")}</>}</p>
    </DialogContent>
  </Dialog>
}
