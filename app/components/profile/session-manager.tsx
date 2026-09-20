"use client"

import type { IpLocation } from "@/lib/ip-location-types"
import { SessionLocationDetails, useIpLocationLabel } from "./session-ip-location"
import { useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { ChevronDown, ChevronUp, Loader2, Monitor, RefreshCw, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { useCurrentOriginSignOut } from "@/hooks/use-current-origin-sign-out"
import { AdminConfirm, AdminError, AdminPager, adminFailureCode, adminRequest, useAdminData } from "./admin-controls"

interface LoginSession {
  id: string; provider: string; userAgent: string; firstIp: string | null; lastIp: string | null
  loginAt: string | null; createdAt: string; lastSeenAt: string; activeSeconds: number
  current: boolean; online: boolean
}
interface SessionPage { items: LoginSession[]; page: number; pages: number; total: number }

function deviceParts(ua: string) {
  const browser = /Edg\//.test(ua) ? "Edge" : /(?:Firefox|FxiOS)\//.test(ua) ? "Firefox" : /(?:Chrome|CriOS)\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : ""
  const system = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : ""
  return [browser, system].filter(Boolean)
}

export function SessionManager({ userId }: { userId?: string }) {
  const t = useTranslations("profile.security.sessions"), security = useTranslations("profile.security"), format = useFormatter()
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0), [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [failure, setFailureCode] = useState("")
  const { toast } = useToast(), { signOutFromCurrentOrigin } = useCurrentOriginSignOut()
  const endpoint = userId ? `/api/admin/users/${encodeURIComponent(userId)}/sessions` : "/api/account/sessions"
  const { data, error, loading } = useAdminData<SessionPage>(`${endpoint}?page=${page}`, revision)
  const geo = useAdminData<{ locations: Record<string, IpLocation> }>(data ? endpoint + "?page=" + data.page + "&locations=1" : null, revision)
  const locationLabel = useIpLocationLabel()
  const location = (ip: string | null) => ip ? geo.data?.locations[ip] : undefined
  const ipLabel = (ip: string | null) => ip ? ip + " · " + locationLabel(location(ip), geo.loading) : t("unknownIp")
  const deviceName = (ua: string) => {
    const parts = deviceParts(ua)
    return parts.length > 1 ? t("deviceLabel", { browser: parts[0], system: parts[1] }) : parts[0] || ""
  }
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "short", timeStyle: "short" })
  const duration = (seconds: number) => seconds < 60 ? t("underMinute") : t("duration", { hours: Math.floor(seconds / 3600), minutes: Math.floor(seconds % 3600 / 60) })
  const revoke = async (suffix: string) => {
    setBusy(true); setFailureCode("")
    try {
      const result = await adminRequest<{ currentRevoked: boolean }>(endpoint + suffix, { method: "DELETE" })
      if (result.currentRevoked) {
        await signOutFromCurrentOrigin()
        window.location.replace(new URL("/", window.location.origin).href)
      } else { toast({ title: t("revoked") }); setRevision(value => value + 1); setExpanded(null) }
    } catch (caught) { setFailureCode(adminFailureCode(caught)) }
    finally { setBusy(false) }
  }
  return <div className="flex min-h-0 min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium">{t("count", { count: data?.total ?? 0 })}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {!userId && <AdminConfirm label={t("others")} description={t("othersConfirm")} disabled={busy || loading || (data?.total ?? 0) < 2} onConfirm={() => void revoke("?mode=others")} />}
        <AdminConfirm label={t("all")} description={userId ? t("allAdminConfirm") : security("confirm")} disabled={busy || loading || !data?.total} onConfirm={() => void revoke("")} />
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("refresh")} disabled={busy || loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
      </div>
    </div>
    <AdminError code={error || failure} />
    <div className="max-h-[55dvh] min-h-0 overflow-y-auto overscroll-contain rounded-md border">
      {loading ? <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin" /> : !data?.items.length ? <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p> : data.items.map(item => {
        const open = expanded === item.id, Device = /Android|iPhone|iPad|Mobile/.test(item.userAgent) ? Smartphone : Monitor
        return <div key={item.id} className="min-w-0 border-b p-2.5 last:border-b-0 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-2">
          <div className="flex min-w-0 items-start gap-2">
            <Device className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><span className="font-medium">{deviceName(item.userAgent) || t("unknownDevice")}</span>{item.current && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{t("current")}</span>}<span className={`text-xs ${item.online ? "text-primary" : "text-muted-foreground"}`}>{t(item.online ? "online" : "idle")}</span></div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"><span className="font-mono">{item.lastIp || t("unknownIp")}</span>{item.lastIp && <span> · {locationLabel(location(item.lastIp), geo.loading)}</span>}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("lastSeenSummary", { time: date(item.lastSeenAt) })} · {t("activeSummary", { duration: duration(item.activeSeconds) })}</p>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-end gap-2 sm:mt-0 sm:self-center">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-expanded={open} aria-controls={`session-${item.id}`} onClick={() => setExpanded(open ? null : item.id)}>{t("details")}{open ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />}</Button>
            <AdminConfirm label={t("signOut")} description={item.current ? t("currentConfirm") : t("singleConfirm", { device: deviceName(item.userAgent) || t("unknownDevice"), ip: item.lastIp || t("unknownIp") })} disabled={busy} onConfirm={() => void revoke(`/${encodeURIComponent(item.id)}`)} />
          </div>
          {open && <dl id={`session-${item.id}`} className="col-span-full mt-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-t pt-3 text-xs">
            {[[t("firstLogin"), item.loginAt ? date(item.loginAt) : t("legacyLogin")], [t("recorded"), date(item.createdAt)], [t("lastSeen"), date(item.lastSeenAt)], [t("activeTime"), duration(item.activeSeconds)], [t(item.loginAt ? "firstIp" : "firstObservedIp"), ipLabel(item.firstIp)], [t("lastIp"), ipLabel(item.lastIp)], [t("provider"), item.provider === "credentials" ? t("password") : item.provider === "legacy" ? t("legacy") : item.provider]].map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words [overflow-wrap:anywhere]">{value}</dd></div>)}
            <SessionLocationDetails location={location(item.lastIp)} title={t("lastIp")} />
            {item.firstIp !== item.lastIp && <SessionLocationDetails location={location(item.firstIp)} title={t(item.loginAt ? "firstIp" : "firstObservedIp")} />}
            <dt className="col-span-2 text-muted-foreground">{t("userAgent")}</dt><dd className="col-span-2 min-w-0 break-all rounded bg-muted/40 p-2 font-mono leading-relaxed">{item.userAgent || t("unknownDevice")}</dd>
          </dl>}
        </div>
      })}
    </div>
    {data && <AdminPager page={data.page} pages={data.pages} total={data.total} loading={busy || loading} onChange={value => { setPage(value); setExpanded(null) }} />}
    <details className="text-xs leading-relaxed text-muted-foreground"><summary className="cursor-pointer hover:text-foreground">{t("timingTitle")}</summary><p className="mt-1">{t("timingHelp")}</p><p className="mt-1">{t("geo.notice")}</p></details>
  </div>
}
