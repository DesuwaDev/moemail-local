"use client"
import { useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ROLES, type Role } from "@/lib/permissions"
import { SessionManager } from "./session-manager"
import { ManagedMailboxes } from "./managed-mailboxes"
import { AccessEditor } from "./access-editor"
import { AdminConfirm, AdminError, AdminPager, adminRequest, adminFailureCode, useAdminData } from "./admin-controls"
import { useToast } from "@/components/ui/use-toast"

export interface ManagedUser { id: string; name: string | null; username: string | null; email: string | null; image: string | null; role: string | null; bannedAt: string | Date | null; mailboxCount: number }
interface Details {
  user: ManagedUser & { roles: string[]; passwordConfigured: boolean; providers: string[] }
  summary: Record<string, number>
  access: { permissions: Record<string, boolean>; quotas: Record<string, number> }
  resources: {
    apiKeys: Array<{ id: string; name: string; enabled: boolean; expiresAt: string | null }>
    webhooks: Array<{ id: string; url: string; enabled: boolean }>
    mailboxNameBlocks: Array<{ id: string; localPart: string; domain: string }>
    mailboxNameBlockCount: number; mailboxNameBlocksTruncated: boolean
  }
}
export function UserDetailsDialog({ user, open, onOpenChange, canAdmin = false, onChange }: { user: ManagedUser | null; open: boolean; onOpenChange: (value: boolean) => void; canAdmin?: boolean; onChange?: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex h-[min(48rem,calc(100dvh-1rem))] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:h-[min(48rem,90dvh)]">
    <DialogHeader className="shrink-0 border-b p-3 pr-12 sm:px-4"><DialogTitle className="truncate text-left">{user?.name || user?.username || user?.email || user?.id}</DialogTitle><DialogDescription className="truncate text-left">{user?.email || user?.username || user?.id}</DialogDescription></DialogHeader>
    {open && user && <UserDetails key={user.id} user={user} canAdmin={canAdmin} onChange={onChange} />}
  </DialogContent></Dialog>
}
function UserDetails({ user, canAdmin, onChange }: { user: ManagedUser; canAdmin: boolean; onChange?: () => void }) {
  const t = useTranslations("profile.promote.details"), m = useTranslations("admin.management"), roles = useTranslations("profile.card.roles")
  const [revision, setRevision] = useState(0), [tab, setTab] = useState("overview")
  const result = useAdminData<Details>(`/api/users/${encodeURIComponent(user.id)}?mailboxPageSize=8`, revision)
  // Keep the active drill-down mounted while refreshing its summary.
  const [previous, setPrevious] = useState<Details | null>(null)
  if (result.data && result.data !== previous) setPrevious(result.data)
  const details = result.error ? null : result.data || previous
  const changed = () => { setRevision(value => value + 1); onChange?.() }
  return <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
    <TabsList className="mx-3 my-2 grid h-9 shrink-0 grid-cols-6">{["overview", "mailboxes", "access", "sessions", "resources", "audit"].map(value => <TabsTrigger key={value} value={value} className="min-w-0 px-1 text-xs sm:text-sm" disabled={!canAdmin && ["mailboxes", "sessions", "audit"].includes(value)} title={m(`userTabs.${value}` as never)}><span className="truncate">{m(`userTabs.${value}` as never)}</span></TabsTrigger>)}</TabsList>
    <div key={tab} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pt-1 sm:p-4 sm:pt-1">
      <AdminError code={result.error} />{!details && result.loading && <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin" />}
      {details && <>
        <TabsContent value="overview" className="m-0 space-y-3"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["mailboxes", "mailboxes"], ["receivedMessages", "received"], ["sentMessages", "sent"], ["messages", "totalMessages"]].map(([key, label]) => <div key={key} className="rounded-md border bg-muted/20 p-2.5"><p className="text-xs text-muted-foreground">{m(label as never)}</p><p className="mt-1 text-xl font-semibold tabular-nums">{details.summary[key] ?? 0}</p></div>)}</div>
          <p className="text-xs leading-relaxed text-muted-foreground">{m("countsHelp")}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-md border p-3 text-sm">
            <dt className="text-muted-foreground">{m("role")}</dt><dd>{roles((details.user.roles[0] || "civilian").toUpperCase() as never)}</dd>
            <dt className="text-muted-foreground">{m("status")}</dt><dd>{details.user.bannedAt ? t("status.banned") : t("status.active")}</dd>
            <dt className="text-muted-foreground">{m("username")}</dt><dd className="break-all">{details.user.username || "—"}</dd>
            <dt className="text-muted-foreground">{m("loginEmail")}</dt><dd className="break-all">{details.user.email || "—"}</dd>
            <dt className="text-muted-foreground">{t("identity.id")}</dt><dd className="break-all font-mono text-xs">{user.id}</dd>
            <dt className="text-muted-foreground">{m("providers")}</dt><dd className="break-words">{[...(details.user.passwordConfigured ? [m("password")] : []), ...details.user.providers].join(" / ") || "—"}</dd>
          </dl><p className="text-xs text-muted-foreground">{m("resourceCounts", { keys: details.summary.apiKeys, hooks: details.summary.webhooks, shares: details.summary.emailShares + details.summary.messageShares })}</p>
        </TabsContent>
        <TabsContent value="mailboxes" className="m-0">{canAdmin && <ManagedMailboxes userId={user.id} onChange={changed} />}</TabsContent>
        <TabsContent value="access" className="m-0">{canAdmin ? <AccessEditor userId={user.id} role={(details.user.roles[0] || ROLES.CIVILIAN) as Role} onSaved={changed} /> : <div className="grid gap-2 sm:grid-cols-2">{Object.entries(details.access.permissions).map(([permission, enabled]) => <p key={permission} className="text-sm">{t(`permissions.${permission}` as never)} · {enabled ? "✓" : "—"}</p>)}</div>}</TabsContent>
        <TabsContent value="sessions" className="m-0">{canAdmin && <SessionManager userId={user.id} />}</TabsContent>
        <TabsContent value="resources" className="m-0"><UserResources details={details} canManage={canAdmin && !details.user.roles.includes(ROLES.EMPEROR)} onChange={changed} /></TabsContent>
        <TabsContent value="audit" className="m-0">{canAdmin && <UserAudit userId={user.id} />}</TabsContent>
      </>}
    </div>
  </Tabs>
}
function UserResources({ details, canManage, onChange }: { details: Details; canManage: boolean; onChange: () => void }) {
  const t = useTranslations("admin.management"), r = useTranslations("profile.promote.details.resources"), format = useFormatter(), { toast } = useToast()
  const [kind, setKind] = useState("apiKeys"), [page, setPage] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState("")
  const items = kind === "apiKeys" ? details.resources.apiKeys : kind === "webhooks" ? details.resources.webhooks : details.resources.mailboxNameBlocks
  const pages = Math.max(1, Math.ceil(items.length / 8)), current = Math.min(page, pages)
  const act = async (action: string) => { setBusy(true); setError(""); try { await adminRequest(`/api/admin/users/${encodeURIComponent(details.user.id)}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }); toast({ title: t("saved") }); onChange() } catch (caught) { setError(adminFailureCode(caught)) } finally { setBusy(false) } }
  return <div className="space-y-3"><AdminError code={error} />
    {canManage && <div className="flex flex-wrap gap-2">{["apiKeys", "webhooks", "shares"].map(action => <AdminConfirm key={action} disabled={busy} label={t(`actions.${action}` as never)} description={t(`actionHelp.${action}` as never)} onConfirm={() => void act(action)} />)}</div>}
    <Select value={kind} onValueChange={value => { setKind(value); setPage(1) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["apiKeys", "webhooks", "blocks"].map(value => <SelectItem key={value} value={value}>{r(value as never)}</SelectItem>)}</SelectContent></Select>
    <div className="divide-y rounded-md border">{items.length === 0 ? <p className="p-5 text-center text-sm text-muted-foreground">{t("empty")}</p> : items.slice((current - 1) * 8, current * 8).map(item => <div key={item.id} className="min-w-0 p-2.5"><p className="truncate text-sm">{"name" in item ? item.name : "url" in item ? item.url : `${item.localPart}@${item.domain}`}</p>{"enabled" in item && <p className="mt-1 text-xs text-muted-foreground">{r(item.enabled ? "enabled" : "disabled")}{"expiresAt" in item ? ` · ${item.expiresAt ? format.dateTime(new Date(item.expiresAt)) : r("neverExpires")}` : ""}</p>}</div>)}</div>
    <AdminPager page={current} pages={pages} total={items.length} onChange={setPage} />{kind === "blocks" && details.resources.mailboxNameBlocksTruncated && <p className="text-xs text-muted-foreground">{r("truncated", { shown: items.length, total: details.resources.mailboxNameBlockCount })}</p>}
  </div>
}
function UserAudit({ userId }: { userId: string }) {
  const t = useTranslations("admin.management"), format = useFormatter(), [page, setPage] = useState(1)
  const { data, error, loading } = useAdminData<{ items: Array<{ id: string; action: string; target: string; actor: string; createdAt: string }>; total: number; pages: number }>(`/api/admin/users/${encodeURIComponent(userId)}/audit?page=${page}`)
  return <div className="space-y-3"><p className="text-xs text-muted-foreground">{t("auditHelp")}</p><AdminError code={error} />{loading ? <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin" /> : !data?.items.length ? <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p> : <div className="divide-y rounded-md border">{data.items.map(item => <div key={item.id} className="p-2.5"><div className="flex flex-wrap justify-between gap-1 text-sm"><span>{t(`auditActions.${item.action.replaceAll(".", "_")}` as never)}</span><time className="text-xs text-muted-foreground">{format.dateTime(new Date(item.createdAt), { dateStyle: "short", timeStyle: "short" })}</time></div><p className="mt-1 truncate text-xs text-muted-foreground" title={item.target}>{item.actor} · {item.target}</p></div>)}</div>}{data && <AdminPager page={page} pages={data.pages} total={data.total} onChange={setPage} />}</div>
}
