"use client"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AdminError, AdminPager, adminRequest, adminFailureCode, useAdminData } from "./admin-controls"
import { ROLES, type Permission, type Role } from "@/lib/permissions"
import type { AccessPolicies, UserAccessOverride } from "@/lib/access-policies"
import { useToast } from "@/components/ui/use-toast"

type Policy = AccessPolicies["roles"][Role]
interface PolicyData { policies: AccessPolicies; defaults: AccessPolicies; permissions: Permission[]; domains: string[] }
const quotaKeys = ["maxActiveMailboxes", "maxMailboxLifetimeDays", "maxMessageBytes"] as const
const maximums = { maxActiveMailboxes: 100000, maxMailboxLifetimeDays: 36500, maxMessageBytes: 25 * 1024 * 1024 }
const roleKeys = { emperor: "EMPEROR", duke: "DUKE", knight: "KNIGHT", civilian: "CIVILIAN" } as const
export function RoleAccessEditor({ onSaved }: { onSaved?: () => void }) {
  const t = useTranslations("profile.card.roles")
  const [role, setRole] = useState<Role>(ROLES.DUKE)
  return <div className="space-y-3"><Select value={role} onValueChange={value => setRole(value as Role)}><SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent>{Object.values(ROLES).map(value => <SelectItem key={value} value={value}>{t(roleKeys[value])}</SelectItem>)}</SelectContent></Select><AccessEditor key={role} role={role} onSaved={onSaved} /></div>
}
export function AccessEditor({ userId, role, onSaved }: { userId?: string; role: Role; onSaved?: () => void }) {
  const t = useTranslations("admin.access"), m = useTranslations("admin.management"), { toast } = useToast()
  const { data, error, loading } = useAdminData<PolicyData>("/api/access-policies")
  const [draft, setDraft] = useState<UserAccessOverride>({ permissions: {}, quotas: {} }), [tab, setTab] = useState("permissions"), [search, setSearch] = useState(""), [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("")
  useEffect(() => { if (data) setDraft(structuredClone(userId ? data.policies.users[userId] ?? { permissions: {}, quotas: {} } : data.policies.roles[role])) }, [data, role, userId])
  if (loading) return <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin" />
  if (!data) return <AdminError code={error} />
  if (role === ROLES.EMPEROR) return <p className="rounded-md border bg-muted/30 p-3 text-sm">{t("emperorLocked")} {t("emperorQuotaEditableHint")}</p>
  const inherited = data.policies.roles[role]
  const entries = tab === "permissions" ? data.permissions.filter(key => t(`permissions.${key}` as never).toLowerCase().includes(search.toLowerCase())) : data.domains.filter(domain => domain.includes(search.toLowerCase()))
  const pages = Math.max(1, Math.ceil(entries.length / 6)), currentPage = Math.min(page, pages), visible = entries.slice((currentPage - 1) * 6, currentPage * 6)
  const save = async (reset = false) => {
    setBusy(true); setFailure("")
    try {
      const next = reset ? (userId ? { permissions: {}, quotas: {} } : data.defaults.roles[role]) : draft
      await adminRequest(userId ? `/api/access-policies/users/${encodeURIComponent(userId)}` : "/api/access-policies", {
        method: userId ? (reset ? "DELETE" : "PUT") : "PATCH", headers: { "Content-Type": "application/json" },
        ...(userId && reset ? {} : { body: JSON.stringify(userId ? next : { role, policy: next }) }),
      })
      setDraft(structuredClone(next)); toast({ title: m("saved") }); onSaved?.()
    } catch (caught) { setFailure(adminFailureCode(caught)) }
    finally { setBusy(false) }
  }
  const domainValue = (domain: string) => domain === "default" ? draft.domainAccess?.default : draft.domainAccess?.domains?.[domain]
  const domainSelect = (domain: string) => <Select disabled={busy} value={domainValue(domain) ?? "inherit"} onValueChange={value => setDraft(previous => {
    const domainAccess = { ...previous.domainAccess, domains: { ...previous.domainAccess?.domains } }
    if (domain === "default") { if (value === "inherit") delete domainAccess.default; else domainAccess.default = value as Policy["domainAccess"]["default"] }
    else if (value === "inherit") delete domainAccess.domains[domain]
    else domainAccess.domains[domain] = value as Policy["domainAccess"]["default"]
    return { ...previous, domainAccess }
  })}><SelectTrigger aria-label={domain === "default" ? t("domains.default") : domain} className="h-8 w-28 shrink-0"><SelectValue /></SelectTrigger><SelectContent>{(userId || domain !== "default") && <SelectItem value="inherit">{t("inherit")}</SelectItem>}{["allow", "receive", "send", "deny"].map(value => <SelectItem key={value} value={value}>{t(`domains.modes.${value}` as never)}</SelectItem>)}</SelectContent></Select>
  return <div className="min-w-0 space-y-3">
    <Tabs value={tab} onValueChange={value => { setTab(value); setSearch(""); setPage(1) }}><TabsList className="grid w-full grid-cols-3">{["permissions", "quotas", "domains"].map(value => <TabsTrigger key={value} value={value}>{m(`policyTabs.${value}` as never)}</TabsTrigger>)}</TabsList></Tabs>
    <AdminError code={error || failure} />
    <p className="text-xs leading-relaxed text-muted-foreground">{userId ? m("overrideHelp") : m("roleHelp")}</p>
    {tab !== "quotas" && <Input aria-label={m("filterSettings")} placeholder={m("filterSettings")} value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />}
    {tab === "permissions" && <div className="grid gap-x-4 sm:grid-cols-2">{visible.map(value => { const key = value as Permission; return <div key={key} className="flex min-w-0 items-center justify-between gap-2 border-b py-2"><div className="min-w-0 text-sm"><p>{t(`permissions.${key}` as never)}</p>{userId && <p className="text-xs text-muted-foreground">{m("roleValue", { value: t(inherited.permissions[key] ? "allow" : "deny") })}</p>}</div><Select disabled={busy} value={draft.permissions[key] === undefined ? "inherit" : draft.permissions[key] ? "allow" : "deny"} onValueChange={value => setDraft(previous => { const permissions = { ...previous.permissions }; if (value === "inherit") delete permissions[key]; else permissions[key] = value === "allow"; return { ...previous, permissions } })}><SelectTrigger aria-label={t(`permissions.${key}` as never)} className="h-8 w-24 shrink-0"><SelectValue /></SelectTrigger><SelectContent>{userId && <SelectItem value="inherit">{t("inherit")}</SelectItem>}<SelectItem value="allow">{t("allow")}</SelectItem><SelectItem value="deny">{t("deny")}</SelectItem></SelectContent></Select></div> })}</div>}
    {tab === "quotas" && <div className="space-y-3">{quotaKeys.map(key => <div key={key} className="space-y-1 rounded-md border p-2.5"><div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor={`quota-${userId || role}-${key}`} className="text-sm">{t(`quotas.${key}.label`)}</label>{userId && <Button variant="ghost" size="sm" disabled={busy || draft.quotas[key] === undefined} onClick={() => setDraft(previous => { const quotas = { ...previous.quotas }; delete quotas[key]; return { ...previous, quotas } })}>{t("inherit")}</Button>}</div><Input id={`quota-${userId || role}-${key}`} disabled={busy} type="number" min={0} max={maximums[key]} value={draft.quotas[key] ?? ""} placeholder={String(inherited.quotas[key])} onChange={event => setDraft(previous => { const quotas = { ...previous.quotas }; if (event.target.value === "" && userId) delete quotas[key]; else quotas[key] = Number(event.target.value); return { ...previous, quotas } })} /><p className="text-xs leading-relaxed text-muted-foreground">{t(`quotas.${key}.help`)}</p></div>)}</div>}
    {tab === "domains" && <div className="space-y-2"><p className="text-xs text-muted-foreground">{t(userId ? "domains.userHelp" : "domains.roleHelp")}</p><div className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"><span>{t("domains.default")}</span>{domainSelect("default")}</div><div className="grid gap-x-4 sm:grid-cols-2">{visible.map(domain => <div key={domain} className="flex min-w-0 items-center justify-between gap-2 border-b py-2"><span className="min-w-0 truncate font-mono text-xs" title={domain}>{domain}</span>{domainSelect(domain)}</div>)}</div></div>}
    {tab !== "quotas" && <AdminPager page={currentPage} pages={pages} total={entries.length} onChange={setPage} />}
    <div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Button variant="outline" size="sm" disabled={busy} onClick={() => void save(true)}>{userId ? t("actions.inheritAll") : t("actions.resetRole")}</Button><Button size="sm" disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{t("actions.save")}</Button></div>
  </div>
}
