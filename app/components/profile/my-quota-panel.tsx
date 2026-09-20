"use client"

import { useEffect, useState } from "react"
import { BarChart3, CircleHelp } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import type { MailQuotaAssignment, MailQuotaUsage } from "./mail-quota-editor"

type SelfQuotaResponse = {
  access?: {
    quotas: { maxActiveMailboxes: number; maxMailboxLifetimeDays: number; maxMessageBytes: number }
    mailQuotaRules: MailQuotaAssignment[]
  }
  usage?: { activeMailboxes: number; activeApiKeys: number; send: MailQuotaUsage; receive: MailQuotaUsage }
}

function MailUsage({ direction, usage }: { direction: "send" | "receive"; usage: MailQuotaUsage }) {
  const format = useFormatter()
  const t = useTranslations("profile.myQuotas")
  const amount = (value: number | null) => value === null || value < 0 ? t("unlimited") : format.number(value)
  const target = (rule: MailQuotaAssignment) => rule.target.type === "all"
    ? t("targets.all")
    : rule.target.type === "domain" ? t("targets.domain", { domain: rule.target.domain }) : t("targets.mailbox", { address: rule.target.address })
  return (
    <section className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">{t(direction)}</h3>
        <span className="text-xs text-muted-foreground">{t("allTime", { count: format.number(usage.allTimeCompleted) })}</span>
      </div>
      {usage.rules.length === 0 ? <p className="text-sm text-muted-foreground">{t("noRulesCompact")}</p> : (
        <ul className="divide-y">
          {usage.rules.map(item => <li key={item.assignment.id} className="min-w-0 py-2 first:pt-0 last:pb-0">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
              <span className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]">{target(item.assignment)}</span>
              <span className="text-xs text-muted-foreground">{t(item.assignment.subject.type === "all" ? "pools.global" : item.assignment.subject.type === "role" && item.assignment.shareWithinRole ? "pools.role" : "pools.user")}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
              <span className="text-xs text-muted-foreground">{t("window", { value: format.number(item.rolling.rule.windowValue), unit: t(`units.${item.rolling.rule.windowUnit}` as never) })}</span>
              <span className="font-medium tabular-nums [overflow-wrap:anywhere]">{t("ruleUsage", { used: format.number(item.rolling.used), limit: amount(item.rolling.rule.limit), pending: format.number(item.rolling.pending) })}</span>
            </div>
            {item.assignment.target.type === "mailbox" && item.assignment.lifetimeLimit >= 0 && <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">{t("lifetimeUsage", { used: format.number(item.lifetimeUsed), limit: amount(item.assignment.lifetimeLimit) })}</p>}
          </li>)}
        </ul>
      )}
    </section>
  )
}

export function MyQuotaPanel() {
  const format = useFormatter()
  const t = useTranslations("profile.myQuotas")
  const [data, setData] = useState<SelfQuotaResponse | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/access-policies/me", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) return setFailed(true)
      setData(await response.json() as SelfQuotaResponse)
    }).catch(error => { if (!(error instanceof Error && error.name === "AbortError")) setFailed(true) })
    return () => controller.abort()
  }, [])
  if (failed) return <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{t("loadFailed")}</div>
  if (!data?.access || !data.usage) return <div className="rounded border p-4 text-sm text-muted-foreground">{t("loading")}</div>
  const { access, usage } = data
  const amount = (value: number) => value <= 0 ? t("unlimited") : format.number(value)
  const general = [
    { key: "activeMailboxes", value: t("usageCompact", { used: format.number(usage.activeMailboxes), limit: amount(access.quotas.maxActiveMailboxes) }) },
    { key: "mailboxLifetime", value: access.quotas.maxMailboxLifetimeDays === 0 ? t("unlimited") : t("days", { count: format.number(access.quotas.maxMailboxLifetimeDays) }) },
    { key: "messageBytes", value: access.quotas.maxMessageBytes === 0 ? t("systemMaximum") : t("bytes", { count: format.number(access.quotas.maxMessageBytes) }) },
    { key: "activeApiKeys", value: format.number(usage.activeApiKeys) },
  ] as const
  const hasRules = usage.send.rules.length > 0 || usage.receive.rules.length > 0
  return <section className="min-w-0 space-y-3 rounded-lg border-2 border-primary/20 bg-background p-3 sm:p-4">
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><BarChart3 aria-hidden="true" className="size-4 shrink-0 text-primary" />{t("title")}</h2>
      <Dialog>
        <DialogTrigger asChild><Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs"><CircleHelp aria-hidden="true" className="size-3.5" />{t("helpTitle")}</Button></DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg p-4 sm:p-6">
          <DialogHeader className="pr-5"><DialogTitle>{t("helpTitle")}</DialogTitle><DialogDescription>{t("description")}</DialogDescription></DialogHeader>
          <dl className="space-y-3 text-sm leading-relaxed">{general.map(({key}) => <div key={key}><dt className="font-medium">{t(`${key}.label` as never)}</dt><dd className="text-muted-foreground">{t(`${key}.help` as never)}</dd></div>)}</dl>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("precedenceHelp")}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("noRules")}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("mailboxUsageHint")}</p>
        </DialogContent>
      </Dialog>
    </div>
    <dl className="grid min-w-0 gap-x-6 sm:grid-cols-2">
      {general.map(({ key, value }) => <div key={key} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b py-1.5 text-sm">
        <dt className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{t(`${key}.label` as never)}</dt>
        <dd className="ml-auto max-w-full text-right font-medium tabular-nums [overflow-wrap:anywhere]">{value}</dd>
      </div>)}
    </dl>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-6"><MailUsage direction="send" usage={usage.send} /><MailUsage direction="receive" usage={usage.receive} /></div>
    {hasRules && <p className="text-xs leading-relaxed text-muted-foreground">{t("sharedHint")}</p>}
  </section>
}
