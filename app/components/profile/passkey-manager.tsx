"use client"

import { useState, type FormEvent, type ReactNode } from "react"
import { signOut } from "next-auth/react"
import { useFormatter, useTranslations } from "next-intl"
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser"
import { CheckCircle2, Fingerprint, Info, KeyRound, Loader2, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  classifyPasskeyError,
  signalAcceptedPasskeys,
  usePasskeySupport,
  type PasskeyFailure,
} from "@/components/auth/passkey-client"
import { AdminConfirm, AdminError, adminFailureCode, adminRequest, useAdminData } from "./admin-controls"
import { deviceParts } from "./session-manager"

export interface PasskeyItem {
  id: string
  name: string
  credentialId: string
  provider: string | null
  deviceType: string
  backedUp: boolean
  transports: string[]
  createdAt: string
  lastUsedAt: string | null
}

interface OwnPasskeys {
  items: PasskeyItem[]
  limit: number
  rpId: string | null
  userHandle: string
  reauth: { fresh: boolean; until: string | null; password: boolean; passkey: boolean }
}

type Pending = { kind: "add"; verified?: boolean } | { kind: "delete"; item: PasskeyItem }

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

// A roaming key that never syncs and is not built into this device.
const isSecurityKey = (item: PasskeyItem) => !item.backedUp
  && !item.transports.includes("internal")
  && item.transports.some(transport => ["usb", "nfc", "ble", "smart-card"].includes(transport))

function PasskeyRow({ item, actions, children }: { item: PasskeyItem; actions?: ReactNode; children?: ReactNode }) {
  const t = useTranslations("profile.security.passkeys"), format = useFormatter()
  const securityKey = isSecurityKey(item)
  const Icon = securityKey ? KeyRound : Fingerprint
  const badge = securityKey ? "securityKey" : item.backedUp ? "synced" : "deviceBound"
  return <li className="min-w-0 p-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-3">
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium [overflow-wrap:anywhere]">{item.name || t("unnamed")}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${item.backedUp ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`} title={t(item.backedUp ? "syncedHelp" : "deviceBoundHelp")}>{t(badge)}</span>
        </div>
        {item.provider && <p className="mt-0.5 text-xs text-muted-foreground">{t("storedIn", { provider: item.provider })}</p>}
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {t("created", { time: format.dateTime(new Date(item.createdAt), { dateStyle: "medium" }) })}
          {" · "}
          {item.lastUsedAt ? t("lastUsed", { time: format.dateTime(new Date(item.lastUsedAt), { dateStyle: "short", timeStyle: "short" }) }) : t("neverUsed")}
        </p>
      </div>
    </div>
    {actions && <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5 sm:mt-0">{actions}</div>}
    {children && <div className="col-span-full mt-2">{children}</div>}
  </li>
}

/** Owner view: add, rename and remove the signed-in account's passkeys. */
export function PasskeyManager() {
  const t = useTranslations("profile.security.passkeys")
  const tFailure = useTranslations("auth.passkey")
  const tSessions = useTranslations("profile.security.sessions")
  const { toast } = useToast()
  const { support, siteOrigin } = usePasskeySupport()
  const [revision, setRevision] = useState(0)
  const { data, error, loading } = useAdminData<OwnPasskeys>("/api/account/passkeys", revision)
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState("")
  const [notice, setNotice] = useState<PasskeyFailure | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState<PasskeyItem | null>(null)
  const [password, setPassword] = useState("")

  const items = data?.items ?? []
  const ready = support === "ready" && Boolean(data?.rpId)
  const limitReached = Boolean(data && items.length >= data.limit)
  const refresh = () => setRevision(value => value + 1)
  const clearMessages = () => { setFailure(""); setNotice(null) }

  // API failures carry a registered code; anything else came from the browser
  // or authenticator and is explained by category instead.
  const handleFailure = (caught: unknown, retry: Pending) => {
    const code = adminFailureCode(caught)
    if (code === "REAUTH_REQUIRED") { setPending(retry); return }
    if (code !== "ADMIN_OPERATION_FAILED") { setFailure(code); return }
    setNotice(classifyPasskeyError(caught))
  }

  const defaultName = () => {
    const parts = deviceParts(navigator.userAgent)
    return parts.length > 1 ? tSessions("deviceLabel", { browser: parts[0], system: parts[1] }) : parts[0] || undefined
  }

  const runAdd = async () => {
    setBusy("add"); clearMessages()
    try {
      const { challengeId, options } = await adminRequest<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>("/api/account/passkeys/options", jsonPost({}))
      const response = await startRegistration({ optionsJSON: options })
      await adminRequest("/api/account/passkeys", jsonPost({ challengeId, response, name: defaultName() }))
      setPending(null)
      toast({ title: t("added") })
      refresh()
    } catch (caught) {
      handleFailure(caught, { kind: "add" })
    } finally { setBusy(null) }
  }

  const runDelete = async (item: PasskeyItem) => {
    setBusy("delete"); clearMessages()
    try {
      await adminRequest(`/api/account/passkeys/${encodeURIComponent(item.id)}`, { method: "DELETE" })
      // Best effort: supporting password managers hide the removed passkey.
      if (data?.rpId) signalAcceptedPasskeys(data.rpId, data.userHandle, items.filter(candidate => candidate.id !== item.id).map(candidate => candidate.credentialId))
      setPending(null)
      toast({ title: t("deleted") })
      refresh()
    } catch (caught) {
      handleFailure(caught, { kind: "delete", item })
    } finally { setBusy(null) }
  }

  const add = () => {
    clearMessages()
    if (data?.reauth.fresh || (pending?.kind === "add" && pending.verified)) void runAdd()
    else setPending({ kind: "add" })
  }

  const confirmDelete = (item: PasskeyItem) => {
    setRemoving(null)
    if (data?.reauth.fresh) void runDelete(item)
    else { clearMessages(); setPending({ kind: "delete", item }) }
  }

  const verified = async (action: Pending) => {
    setPassword("")
    toast({ title: t("verify.verified") })
    refresh()
    // Removal needs no further gesture. Creating a passkey needs a fresh click:
    // Safari refuses a second WebAuthn ceremony without new user activation.
    if (action.kind === "delete") await runDelete(action.item)
    else setPending({ kind: "add", verified: true })
  }

  const verifyWithPasskey = async () => {
    if (!pending) return
    setBusy("verify"); clearMessages()
    try {
      const { challengeId, options } = await adminRequest<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>("/api/account/reauth/options", jsonPost({}))
      const response = await startAuthentication({ optionsJSON: options })
      await adminRequest("/api/account/reauth", jsonPost({ method: "passkey", challengeId, response }))
      setBusy(null)
      await verified(pending)
    } catch (caught) {
      handleFailure(caught, pending)
    } finally { setBusy(null) }
  }

  const verifyWithPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!pending || !password) return
    setBusy("verify"); clearMessages()
    try {
      await adminRequest("/api/account/reauth", jsonPost({ method: "password", password }))
      setBusy(null)
      await verified(pending)
    } catch (caught) {
      handleFailure(caught, pending)
    } finally { setBusy(null) }
  }

  const rename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    setBusy("rename"); clearMessages()
    try {
      await adminRequest(`/api/account/passkeys/${encodeURIComponent(editing.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editing.name }),
      })
      setEditing(null)
      toast({ title: t("renamed") })
      refresh()
    } catch (caught) {
      setFailure(adminFailureCode(caught))
    } finally { setBusy(null) }
  }

  const signInAgain = async () => {
    setBusy("relogin")
    try { await signOut({ redirect: false }) } finally {
      window.location.replace(new URL("/login", window.location.origin).href)
    }
  }

  const unavailable = support === "browser" || support === "insecure" || support === "origin"
    ? t(`unavailable.${support}`, { origin: siteOrigin })
    : data && !data.rpId ? t("unavailable.server") : ""
  const canVerifyWithPasskey = Boolean(data?.reauth.passkey && ready)
  const canVerifyWithPassword = Boolean(data?.reauth.password)

  return <div className="flex min-w-0 flex-col gap-3">
    {unavailable && <p role="status" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs leading-relaxed"><Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600" />{unavailable}</p>}

    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium">{data ? t("count", { count: items.length, limit: data.limit }) : " "}</p>
      <div className="flex items-center gap-1.5">
        <Button size="sm" className="gap-1.5" disabled={!ready || !data || limitReached || busy !== null} onClick={add}>
          {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{t("addButton")}
        </Button>
        <Button size="icon" variant="ghost" className="size-8" aria-label={t("refresh")} disabled={loading || busy !== null} onClick={refresh}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
    </div>
    {busy === "add" && <p role="status" className="text-xs text-muted-foreground">{t("adding")}</p>}
    {limitReached && <p className="text-xs text-muted-foreground">{t("limitReached", { limit: data?.limit ?? 0 })}</p>}

    {pending && (pending.kind === "add" && pending.verified
      ? <section className="rounded-md border border-primary/30 bg-primary/5 p-3">
        <p className="flex items-start gap-2 text-sm"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />{t("verify.verifiedHelp")}</p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPending(null)}>{t("cancel")}</Button>
          <Button size="sm" className="gap-1.5" disabled={busy !== null || !ready} onClick={() => void runAdd()}>{busy === "add" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{t("verify.continueAdd")}</Button>
        </div>
      </section>
      : <section aria-labelledby="passkey-verify-title" className="rounded-md border border-primary/30 bg-primary/5 p-3">
        <h3 id="passkey-verify-title" className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />{t("verify.title")}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("verify.help")}</p>
        {canVerifyWithPasskey && <Button className="mt-3 w-full gap-2 sm:w-auto" disabled={busy !== null} onClick={() => void verifyWithPasskey()}>
          {busy === "verify" ? <Loader2 className="size-4 animate-spin" /> : <Fingerprint className="size-4" />}{t("verify.passkey")}
        </Button>}
        {canVerifyWithPasskey && canVerifyWithPassword && <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true"><span className="h-px flex-1 bg-border" />{t("verify.or")}<span className="h-px flex-1 bg-border" /></div>}
        {canVerifyWithPassword && <form onSubmit={event => void verifyWithPassword(event)} className={`${canVerifyWithPasskey ? "" : "mt-3 "}flex flex-col gap-2 sm:flex-row`}>
          <Input type="password" autoComplete="current-password" maxLength={256} value={password} onChange={event => setPassword(event.target.value)} placeholder={t("verify.password")} aria-label={t("verify.password")} disabled={busy !== null} className="h-9 sm:flex-1" />
          <Button type="submit" variant={canVerifyWithPasskey ? "outline" : "default"} disabled={busy !== null || !password}>{busy === "verify" && !canVerifyWithPasskey ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}{t("verify.passwordSubmit")}</Button>
        </form>}
        {!canVerifyWithPasskey && !canVerifyWithPassword && <div className="mt-3 space-y-2">
          <p className="text-xs leading-relaxed">{t("verify.relogin")}</p>
          <Button size="sm" disabled={busy !== null} onClick={() => void signInAgain()}>{t("verify.reloginButton")}</Button>
        </div>}
        <div className="mt-2 flex justify-end"><Button size="sm" variant="ghost" disabled={busy === "verify"} onClick={() => { setPending(null); setPassword(""); clearMessages() }}>{t("cancel")}</Button></div>
      </section>)}

    <AdminError code={error || failure} />
    {notice && <p role="status" className={`rounded-md border p-2 text-sm ${notice === "cancelled" ? "text-muted-foreground" : "border-destructive/30 text-destructive"}`}>{tFailure(`failures.${notice}`)}</p>}

    <div className="min-w-0 rounded-md border">
      {loading && !data ? <Loader2 className="mx-auto my-6 size-5 animate-spin" /> : !items.length
        ? <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <Fingerprint aria-hidden="true" className="size-8 text-primary/60" />
          <p className="text-sm font-medium">{t("emptyTitle")}</p>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{t("emptyHelp")}</p>
        </div>
        : <ul className="divide-y">{items.map(item => {
          const editingThis = editing?.id === item.id
          return <PasskeyRow key={item.id} item={item} actions={editingThis ? undefined : <>
            <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" disabled={busy !== null} onClick={() => { clearMessages(); setEditing({ id: item.id, name: item.name }) }}><Pencil className="size-3.5" />{t("rename")}</Button>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs text-destructive" disabled={busy !== null} onClick={() => setRemoving(item)}><Trash2 className="size-3.5" />{t("delete")}</Button>
          </>}>
            {editingThis && <form onSubmit={event => void rename(event)} className="flex flex-col gap-2 sm:flex-row">
              <Input autoFocus maxLength={64} value={editing.name} onChange={event => setEditing({ id: item.id, name: event.target.value })} aria-label={t("nameLabel")} placeholder={t("nameLabel")} className="h-9 sm:flex-1" />
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => setEditing(null)}>{t("cancel")}</Button>
                <Button type="submit" size="sm" className="h-9" disabled={busy !== null || !editing.name.trim()}>{busy === "rename" && <Loader2 className="mr-1.5 size-4 animate-spin" />}{t("save")}</Button>
              </div>
            </form>}
          </PasskeyRow>
        })}</ul>}
    </div>

    <details className="text-xs leading-relaxed text-muted-foreground">
      <summary className="cursor-pointer hover:text-foreground">{t("faqTitle")}</summary>
      <ul className="mt-1 list-disc space-y-1 pl-4"><li>{t("faqStorage")}</li><li>{t("faqSync")}</li><li>{t("faqLost")}</li></ul>
    </details>

    <AlertDialog open={removing !== null} onOpenChange={open => { if (!open) setRemoving(null) }}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg p-4 sm:p-6">
        <AlertDialogHeader><AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle><AlertDialogDescription className="break-words">{t("deleteConfirm", { name: removing?.name || t("unnamed") })}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel><Button variant="destructive" onClick={() => { if (removing) confirmDelete(removing) }}>{t("delete")}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}

/** Emperor view inside user details: review and remove, never add. */
export function AdminPasskeys({ userId }: { userId: string }) {
  const t = useTranslations("profile.security.passkeys")
  const { toast } = useToast()
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [failure, setFailure] = useState("")
  const endpoint = `/api/admin/users/${encodeURIComponent(userId)}/passkeys`
  const { data, error, loading } = useAdminData<{ items: PasskeyItem[] }>(endpoint, revision)
  const remove = async (item: PasskeyItem) => {
    setBusy(true); setFailure("")
    try {
      await adminRequest(`${endpoint}/${encodeURIComponent(item.id)}`, { method: "DELETE" })
      toast({ title: t("deleted") })
      setRevision(value => value + 1)
    } catch (caught) { setFailure(adminFailureCode(caught)) } finally { setBusy(false) }
  }
  return <section className="min-w-0 space-y-2">
    <h3 className="flex items-center gap-2 text-sm font-semibold"><Fingerprint aria-hidden="true" className="size-4 shrink-0 text-primary" />{t("admin.title", { count: data?.items.length ?? 0 })}</h3>
    <AdminError code={error || failure} />
    <div className="min-w-0 rounded-md border">
      {loading ? <Loader2 className="mx-auto my-4 size-5 animate-spin" /> : !data?.items.length
        ? <p className="p-4 text-center text-sm text-muted-foreground">{t("admin.empty")}</p>
        : <ul className="divide-y">{data.items.map(item => <PasskeyRow key={item.id} item={item} actions={
          <AdminConfirm label={t("delete")} description={t("admin.deleteConfirm", { name: item.name || t("unnamed") })} disabled={busy} onConfirm={() => void remove(item)} />
        } />)}</ul>}
    </div>
  </section>
}
