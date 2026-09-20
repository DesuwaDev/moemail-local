"use client"

import { useEffect, useRef, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { CLIENT_IP_HEADERS, isClientIpHeader, type ClientIpDiagnostics, type ClientIpPolicy, type ClientIpResult } from "@/lib/client-ip-policy"

export function ClientIpSettings({ value, disabled, revision, onChange }: {
  value: Required<ClientIpPolicy>
  disabled: boolean
  revision: number | null
  onChange: (value: Required<ClientIpPolicy>) => void
}) {
  const t = useTranslations("runtime.clientIp")
  const format = useFormatter()
  const [result, setResult] = useState<{ key: string; body?: ClientIpDiagnostics; failed?: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const header = value.clientIpHeader
  const preset = header === "auto" || CLIENT_IP_HEADERS.some(name => name === header) ? header : "custom"
  const chain = preset === "custom" || ["auto", "x-forwarded-for", "forwarded"].includes(header)
  const key = JSON.stringify([value, revision])
  const valid = isClientIpHeader(header) && Number.isInteger(value.clientIpTrustedHops) && value.clientIpTrustedHops >= 1 && value.clientIpTrustedHops <= 16
  const current = result?.key === key ? result : null
  const describe = (item: ClientIpResult) => item.address ?? t(`reasons.${item.reason}`)
  const detect = async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), 10000)
    setLoading(true); setResult(null)
    try {
      const query = new URLSearchParams({ header, hops: String(value.clientIpTrustedHops), enabled: String(value.trustProxyHeaders) })
      const response = await fetch(`/api/runtime-config/client-ip?${query}`, { cache: "no-store", signal: controller.signal })
      if (!response.ok) {
        if (request.current === controller) setResult({ key, failed: true })
        return
      }
      const body = await response.json() as ClientIpDiagnostics
      if (request.current === controller) setResult({ key, body })
    } catch {
      if (request.current === controller) setResult({ key, failed: true })
    } finally {
      clearTimeout(timeout)
      if (request.current === controller) setLoading(false)
    }
  }
  return (
    <div className="min-w-0 space-y-3 rounded-md border bg-background/60 p-3 md:col-span-2 xl:col-span-3">
      <div className="flex items-start justify-between gap-3">
        <div><Label htmlFor="client-ip-enabled" className="text-sm font-semibold">{t("title")}</Label><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("summary")}</p></div>
        <Switch id="client-ip-enabled" checked={value.trustProxyHeaders} onCheckedChange={trustProxyHeaders => onChange({ ...value, trustProxyHeaders })} disabled={disabled} />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="client-ip-header" className="text-xs">{t("header")}</Label>
          <Select value={preset} onValueChange={next => onChange({ ...value, clientIpHeader: next === "custom" ? "x-client-ip" : next })} disabled={disabled}>
            <SelectTrigger id="client-ip-header" className="w-full min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
            <SelectContent>{["auto", ...CLIENT_IP_HEADERS, "custom"].map(name => <SelectItem key={name} value={name}>{name === "auto" || name === "custom" ? t(name) : name}</SelectItem>)}</SelectContent>
          </Select>
          {preset === "custom" && <Input aria-label={t("custom")} value={header} maxLength={64} onChange={event => onChange({ ...value, clientIpHeader: event.target.value.trim().toLowerCase() })} disabled={disabled} spellCheck={false} className="font-mono text-xs" aria-invalid={!isClientIpHeader(header)} />}
        </div>
        {chain && <div className="space-y-1.5"><Label htmlFor="client-ip-hops" className="text-xs">{t("hops")}</Label><Input id="client-ip-hops" type="number" min={1} max={16} value={value.clientIpTrustedHops} onChange={event => onChange({ ...value, clientIpTrustedHops: Number(event.target.value) })} disabled={disabled} /><p className="text-xs leading-5 text-muted-foreground">{t("hopsHelp")}</p></div>}
      </div>
      {!valid && <p className="text-xs text-destructive">{t("invalid")}</p>}
      <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={disabled || loading || !valid} onClick={() => void detect()}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />{t(loading ? "detecting" : "detect")}</Button><p className="text-xs text-muted-foreground">{t("draftHint")}</p></div>
      <div aria-live="polite">
        {current?.failed && <p className="text-xs text-destructive">{t("failed")}</p>}
        {current?.body && <div className="space-y-2 rounded border bg-muted/30 p-2.5 text-xs">
          <dl className="grid gap-2 sm:grid-cols-2">{(["active", "preview"] as const).map(kind => <div key={kind} className="min-w-0"><dt className="text-muted-foreground">{t(kind)}</dt><dd className="mt-1 break-all font-mono">{describe(current.body![kind])}</dd>{current.body![kind].source && <dd className="mt-0.5 break-all text-muted-foreground">{current.body![kind].source}</dd>}</div>)}</dl>
          <details><summary className="cursor-pointer py-1">{t("received")}</summary><div className="mt-1 max-h-40 space-y-1 overflow-y-auto">{current.body.headers.filter(item => item.present).map(item => <div key={item.name} className="break-all"><code>{item.name}</code><span className="ml-2">{item.invalid ? t("reasons.invalid") : format.list(item.addresses.filter((address): address is string => address !== null), { type: "unit" })}</span></div>)}{!current.body.headers.some(item => item.present) && <p>{t("reasons.missing")}</p>}</div></details>
        </div>}
      </div>
      <details className="text-xs leading-5 text-muted-foreground"><summary className="cursor-pointer text-foreground">{t("helpTitle")}</summary><div className="mt-2 space-y-2"><p>{t("helpTrust")}</p><p>{t("helpSelection")}</p><p>{t("helpLimit")}</p></div></details>
    </div>
  )
}
