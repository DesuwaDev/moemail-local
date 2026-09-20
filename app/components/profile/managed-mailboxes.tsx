"use client"
import { useEffect, useState, type ComponentProps } from "react"
import { useFormatter, useNow, useTranslations } from "next-intl"
import { ArrowLeft, Loader2, Search } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SharedMessageDetail } from "@/components/emails/shared-message-detail"
import { AdminConfirm, AdminError, AdminPager, adminRequest, adminFailureCode, useAdminData } from "./admin-controls"

interface Mailbox {
  id: string; address: string; userId: string | null; owner: string | null; createdAt: string; expiresAt: string; disabledAt: string | null
  receiveEnabled: boolean; sendEnabled: boolean; shareEnabled: boolean; receivedCount: number; sentCount: number
}
interface Page<T> { items: T[]; total: number; page: number; pages: number }
interface MessageRow { id: string; subject: string; fromAddress: string | null; toAddress: string | null; receivedAt: string; sentAt: string }
type Message = ComponentProps<typeof SharedMessageDetail>["message"]
const endpoint = (id: string) => `/api/admin/mailboxes/${encodeURIComponent(id)}`
function localDate(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }

export function ManagedMailboxes({ userId, onChange, onUser }: { userId?: string; onChange?: () => void; onUser?: (id: string) => void }) {
  const t = useTranslations("admin.management"), format = useFormatter(), now = useNow({ updateInterval: 60000 })
  const [search, setSearch] = useState(""), [status, setStatus] = useState("all"), [page, setPage] = useState(1), [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<Mailbox | null>(null)
  const params = new URLSearchParams({ search, status, page: String(page) })
  if (userId) params.set("userId", userId)
  const { data, error, loading } = useAdminData<Page<Mailbox>>(selected ? null : `/api/admin/mailboxes?${params}`, revision)
  useEffect(() => { if (data && page > data.pages) setPage(data.pages) }, [data, page])
  const changed = () => { setRevision(value => value + 1); onChange?.() }
  if (selected) return <ManagedMailbox key={selected.id} initial={selected} onBack={() => { setSelected(null); changed() }} onChange={changed} />
  return <div className="min-w-0 space-y-3">
    <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]"><div className="relative min-w-0"><Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label={t("searchMailboxes")} placeholder={t("searchMailboxes")} value={search} maxLength={200} onChange={event => { setSearch(event.target.value); setPage(1) }} className="min-w-0 pl-8" /></div>
      <Select value={status} onValueChange={value => { setStatus(value); setPage(1) }}><SelectTrigger aria-label={t("status")}><SelectValue /></SelectTrigger><SelectContent>{["all", "active", "disabled", "expired"].map(value => <SelectItem key={value} value={value}>{t(value as never)}</SelectItem>)}</SelectContent></Select></div>
    <AdminError code={error} />
    {loading ? <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin" /> : data?.items.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p> : <div className={`divide-y overflow-hidden rounded-md border ${userId ? "" : "max-h-[55dvh] overflow-y-auto"}`}>{data?.items.map(mailbox => <div key={mailbox.id} className="flex min-w-0 items-center gap-2 p-2.5">
      <div className="min-w-0 flex-1"><button className="block max-w-full truncate text-left font-mono text-sm font-medium hover:underline" onClick={() => setSelected(mailbox)} title={mailbox.address}>{mailbox.address}</button>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">{!userId && (mailbox.userId && onUser ? <button className="max-w-full truncate text-primary hover:underline" onClick={() => onUser(mailbox.userId!)}>{t("owner", { owner: mailbox.owner || mailbox.userId })}</button> : <span>{t("owner", { owner: mailbox.owner || t("unassigned") })}</span>)}
          <span>{t("counts", { received: mailbox.receivedCount, sent: mailbox.sentCount })}</span><span className={mailbox.disabledAt ? "text-destructive" : ""}>{mailbox.disabledAt ? t("disabled") : Date.parse(mailbox.expiresAt) <= now.getTime() ? t("expired") : new Date(mailbox.expiresAt).getUTCFullYear() === 9999 ? t("permanent") : t("expires", { date: format.dateTime(new Date(mailbox.expiresAt)) })}</span></div></div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => setSelected(mailbox)}>{t("open")}</Button></div>)}</div>}
    {data && <AdminPager {...data} page={page} loading={loading} onChange={setPage} />}
  </div>
}
function ManagedMailbox({ initial, onBack, onChange }: { initial: Mailbox; onBack: () => void; onChange: () => void }) {
  const t = useTranslations("admin.management"), format = useFormatter()
  const { toast } = useToast()
  const [mailbox, setMailbox] = useState(initial), [tab, setTab] = useState("received"), [page, setPage] = useState(1), [search, setSearch] = useState("")
  const [revision, setRevision] = useState(0), [selected, setSelected] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setErrorCode] = useState("")
  const [permanent, setPermanent] = useState(() => new Date(initial.expiresAt).getUTCFullYear() === 9999)
  const [expiry, setExpiry] = useState(() => localDate(initial.expiresAt))
  const [draft, setDraft] = useState({ disabled: Boolean(initial.disabledAt), receiveEnabled: initial.receiveEnabled, sendEnabled: initial.sendEnabled, shareEnabled: initial.shareEnabled })
  const list = useAdminData<Page<MessageRow> & { mailbox: Mailbox }>(tab === "settings" || selected ? null : `${endpoint(mailbox.id)}/messages?${new URLSearchParams({ folder: tab, page: String(page), search })}`, revision)
  const detail = useAdminData<{ message: Message }>(selected ? `${endpoint(mailbox.id)}/messages/${encodeURIComponent(selected)}` : null)
  useEffect(() => { if (list.data) { setMailbox(list.data.mailbox); if (page > list.data.pages) setPage(list.data.pages) } }, [list.data, page])
  const mutate = async (url: string, method: string, body?: unknown) => {
    setBusy(true); setErrorCode("")
    try {
      const result = await adminRequest<{ mailbox?: Mailbox }>(url, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) })
      if (result.mailbox) setMailbox(result.mailbox)
      toast({ title: t("saved") })
      setRevision(value => value + 1); onChange(); return true
    } catch (caught) { setErrorCode(adminFailureCode(caught)); return false }
    finally { setBusy(false) }
  }
  const save = () => {
    const date = permanent ? new Date("9999-01-01T00:00:00.000Z") : new Date(expiry)
    if (!expiry || !Number.isFinite(date.getTime())) { setErrorCode("INVALID_REQUEST"); return }
    void mutate(endpoint(mailbox.id), "PATCH", { ...draft, ...(permanent !== (new Date(mailbox.expiresAt).getUTCFullYear() === 9999) || expiry !== localDate(mailbox.expiresAt) ? { expiresAt: date.toISOString() } : {}) })
  }
  const text = Object.fromEntries(["messageContent", "selectMessage", "loading", "from", "to", "subject", "time", "htmlFormat", "textFormat", "noSubject"].map(key => [key, t(`message.${key}` as never)])) as ComponentProps<typeof SharedMessageDetail>["t"]
  return <div className="min-w-0 space-y-3">
    <div className="flex min-w-0 items-center gap-2"><Button aria-label={t("back")} variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={busy} onClick={selected ? () => setSelected(null) : onBack}><ArrowLeft className="h-4 w-4" /></Button><div className="min-w-0"><h3 className="truncate font-mono text-sm font-medium" title={mailbox.address}>{mailbox.address}</h3><p className="truncate text-xs text-muted-foreground">{t("counts", { received: mailbox.receivedCount, sent: mailbox.sentCount })}{mailbox.disabledAt ? ` · ${t("disabled")}` : ""}</p></div></div>
    <Tabs value={tab} onValueChange={value => { setTab(value); setPage(1); setSelected(null); setSearch("") }}><TabsList className="grid w-full grid-cols-3">{["received", "sent", "settings"].map(value => <TabsTrigger disabled={busy} key={value} value={value}>{t(value as never)}</TabsTrigger>)}</TabsList></Tabs>
    <AdminError code={error || list.error || detail.error} />
    {tab === "settings" ? <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">{t("controlsHelp")}</p>
      <div className="grid gap-x-4 sm:grid-cols-2">{(["disabled", "receiveEnabled", "sendEnabled", "shareEnabled"] as const).map(key => <label key={key} className="flex items-center justify-between gap-3 border-b py-2.5 text-sm"><span>{t(`controls.${key}`)}</span><Switch checked={draft[key]} disabled={busy} onCheckedChange={value => setDraft(current => ({ ...current, [key]: value }))} /></label>)}</div>
      <label className="flex items-center justify-between gap-3 text-sm"><span>{t("permanent")}</span><Switch checked={permanent} disabled={busy} onCheckedChange={value => { setPermanent(value); if (!value) setExpiry(localDate(new Date(Date.now() + 30 * 86400000).toISOString())) }} /></label>
      {!permanent && <label className="block space-y-1 text-sm"><span>{t("expiry")}</span><Input aria-label={t("expiry")} type="datetime-local" value={expiry} disabled={busy} onChange={event => setExpiry(event.target.value)} className="max-w-full sm:max-w-xs" /></label>}
      <div className="flex flex-wrap items-center justify-between gap-2"><AdminConfirm disabled={busy} label={t("deleteMailbox")} description={t("deleteMailboxHelp", { address: mailbox.address })} onConfirm={() => void mutate(endpoint(mailbox.id), "DELETE").then(ok => { if (ok) onBack() })} /><Button size="sm" disabled={busy} onClick={save}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{t("save")}</Button></div>
    </div> : selected ? <div className="min-w-0 space-y-3"><div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{t("privacy")}</p><AdminConfirm label={t("deleteMessage")} description={t("deleteMessageHelp")} disabled={busy || detail.loading || !detail.data} onConfirm={() => void mutate(`${endpoint(mailbox.id)}/messages/${encodeURIComponent(selected)}`, "DELETE").then(ok => { if (ok) setSelected(null) })} /></div><div className="h-[min(36rem,70dvh)] min-h-96"><SharedMessageDetail message={detail.data?.message ?? null} loading={detail.loading} t={text} /></div></div> : <>
      <Input aria-label={t("searchMessages")} placeholder={t("searchMessages")} maxLength={200} value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />
      {list.loading ? <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin" /> : list.data?.items.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p> : <div className="divide-y overflow-hidden rounded-md border">{list.data?.items.map(message => <button key={message.id} className="block w-full min-w-0 p-2.5 text-left hover:bg-muted/50 focus-visible:bg-muted" onClick={() => setSelected(message.id)}><p className="truncate text-sm font-medium">{message.subject || text.noSubject}</p><div className="mt-1 flex min-w-0 justify-between gap-2 text-xs text-muted-foreground"><span className="truncate">{tab === "sent" ? message.toAddress : message.fromAddress}</span><time className="shrink-0">{format.dateTime(new Date(tab === "sent" ? message.sentAt : message.receivedAt))}</time></div></button>)}</div>}
      {list.data && <AdminPager {...list.data} page={page} loading={list.loading} onChange={setPage} />}
    </>}
  </div>
}
