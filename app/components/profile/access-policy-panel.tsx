"use client"

import { RoleAccessEditor, AccessEditor } from "./access-editor"
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Info, Loader2, Pencil, Save, Search, ShieldCheck, Trash2, X } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  MailQuotaRuleEditor,
  MailQuotaUsageManager,
} from "@/components/profile/mail-quota-editor"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/components/ui/use-toast"
import { readApiErrorCode } from "@/lib/api-error-client"
import { LocalizedUiError, localizedUiErrorMessage } from "@/lib/localized-ui-error"
import type { AccessPolicies, UserAccessOverride as UserOverride } from "@/lib/access-policies"
import { ROLES, type Role } from "@/lib/permissions"
import { normalizeMailboxBlockCreationName } from "@/lib/email-address"
import {
  ALL_MAILBOX_BLOCK_DOMAINS,
  ALL_MAILBOX_BLOCK_LOCAL_PARTS,
} from "@/lib/mailbox-block-scope"
import { SearchableUserSelect, type SearchableUser } from "@/components/profile/searchable-user-select"

interface UserItem { id: string; name: string | null; username: string | null; email: string | null; role: string | null; accessOverride: UserOverride | null }
interface MailboxBlock {
  id: string
  userId: string | null
  scopeKey: string
  localPart: string
  domain: string
  user?: { id: string; name: string | null; username: string | null; email: string | null } | null
  allowedRoles?: Role[] | null
}

const roles = [ROLES.EMPEROR, ROLES.DUKE, ROLES.KNIGHT, ROLES.CIVILIAN] as const
const roleTranslationKeys = { emperor: "EMPEROR", duke: "DUKE", knight: "KNIGHT", civilian: "CIVILIAN" } as const
const mailboxBlockPageSize = 12
const allMailboxBlockScopes = "all"
const allMailboxBlockDomains = "__all_domains__"


function roleForUser(user: UserItem | null): Role {
  return roles.includes(user?.role as Role) ? user!.role as Role : ROLES.CIVILIAN
}

export function AccessPolicyPanel() {
  const formatList = useFormatter()
  const t = useTranslations("admin.access")
  const tSession = useTranslations("profile.sessionState")
  const tRoles = useTranslations("profile.card.roles")
  const tFormat = useTranslations("common.format")
  const tApi = useTranslations("api")
  const { toast } = useToast()
  const [policies, setPolicies] = useState<AccessPolicies | null>(null)
  const [domains, setDomains] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [users, setUsers] = useState<UserItem[]>([])
  const [search, setSearch] = useState("")
  const [selectedUserId, setSelectedUserId] = useState("")
  const [usageRevision, setUsageRevision] = useState(0)
  const [blocks, setBlocks] = useState<MailboxBlock[]>([])
  const [blockLocalPart, setBlockLocalPart] = useState("")
  const [blockDomain, setBlockDomain] = useState("")
  const [blockScope, setBlockScope] = useState<"global" | "user" | "roles">("global")
  const [blockUserId, setBlockUserId] = useState("")
  const [blockAllowedRoles, setBlockAllowedRoles] = useState<Role[]>([])
  const [blockSearch, setBlockSearch] = useState("")
  const [blockScopeFilter, setBlockScopeFilter] = useState<"all" | "global" | "user" | "roles">("all")
  const [blockDomainFilter, setBlockDomainFilter] = useState(allMailboxBlockDomains)
  const [blockPage, setBlockPage] = useState(1)
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [savingBlock, setSavingBlock] = useState(false)
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null)
  const blockFormRef = useRef<HTMLDivElement>(null)
  const deferredBlockSearch = useDeferredValue(blockSearch)
  const normalizedBlockLocalPart = normalizeMailboxBlockCreationName(blockLocalPart)
  const invalidBlockLocalPart = blockLocalPart.length > 0 && !normalizedBlockLocalPart
  const indexedBlocks = useMemo(() => blocks.map(block => {
      const identity = block.user?.name || block.user?.username || block.user?.email || block.userId || ""
      const domainLabel = block.domain === ALL_MAILBOX_BLOCK_DOMAINS ? t("blocks.allDomains") : block.domain
      const localizedRoles = block.allowedRoles?.map(item => tRoles(roleTranslationKeys[item])).join(" ") ?? ""
      return {
        block,
        scope: block.allowedRoles ? "roles" as const : block.userId ? "user" as const : "global" as const,
        searchText: `${block.localPart}@${block.domain} ${domainLabel} ${identity} ${block.allowedRoles?.join(" ") ?? ""} ${localizedRoles}`
          .normalize("NFKC").toLocaleLowerCase(),
      }
    }), [blocks, t, tRoles])
  const filteredBlocks = useMemo(() => {
    const query = deferredBlockSearch.trim().normalize("NFKC").toLocaleLowerCase()
    return indexedBlocks.filter(item => (
      (!query || item.searchText.includes(query))
      && (blockScopeFilter === allMailboxBlockScopes || item.scope === blockScopeFilter)
      && (blockDomainFilter === allMailboxBlockDomains || item.block.domain === blockDomainFilter)
    )).map(item => item.block)
  }, [blockDomainFilter, blockScopeFilter, deferredBlockSearch, indexedBlocks])
  const blockPageCount = Math.max(1, Math.ceil(filteredBlocks.length / mailboxBlockPageSize))
  const currentBlockPage = Math.min(blockPage, blockPageCount)
  const pagedBlocks = useMemo(() => {
    const start = (currentBlockPage - 1) * mailboxBlockPageSize
    return filteredBlocks.slice(start, start + mailboxBlockPageSize)
  }, [currentBlockPage, filteredBlocks])
  const blockKnownUsers = useMemo(() => {
    const byId = new Map<string, SearchableUser>(users.map(user => [user.id, user]))
    for (const block of blocks) {
      if (block.user && !byId.has(block.user.id)) {
        byId.set(block.user.id, { ...block.user, role: null })
      }
    }
    return [...byId.values()]
  }, [blocks, users])
  const blockFilterDomains = useMemo(() => [...new Set([
    ALL_MAILBOX_BLOCK_DOMAINS,
    ...domains,
    ...blocks.map(block => block.domain),
  ])], [blocks, domains])

  const loadPolicies = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/access-policies", { cache: "no-store" })
      const body = await response.clone().json() as { policies?: AccessPolicies; domains?: string[] }
      if (!response.ok || !body.policies || !body.domains) throw new LocalizedUiError(tApi(await readApiErrorCode(response, "ACCESS_POLICIES_READ_FAILED") as never))
      setPolicies(body.policies)
      setDomains(body.domains)
      setBlockDomain(current => current || body.domains![0] || "")
    } catch (caught) {
      setError(localizedUiErrorMessage(caught, t("errors.loadPolicies")))
    } finally {
      setLoading(false)
    }
  }, [t, tApi])

  const loadUsers = useCallback(async (signal?: AbortSignal) => {
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "100" })
      if (search.trim()) params.set("search", search.trim())
      const response = await fetch(`/api/roles/users?${params}`, { cache: "no-store", signal })
      const body = await response.clone().json() as { users?: UserItem[] }
      if (!response.ok || !body.users) throw new LocalizedUiError(tApi(await readApiErrorCode(response, "USERS_READ_FAILED") as never))
      setUsers(body.users)
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return
      setError(localizedUiErrorMessage(caught, t("errors.loadUsers")))
    }
  }, [search, t, tApi])

  const rememberUser = useCallback((user: SearchableUser) => {
    const resolved = {
      ...user,
      accessOverride: (user.accessOverride ?? null) as UserOverride | null,
    }
    setUsers(previous => previous.some(item => item.id === user.id)
      ? previous.map(item => item.id === user.id ? { ...item, ...resolved } : item)
      : [...previous, resolved])
  }, [])

  const loadBlocks = useCallback(async () => {
    try {
      const response = await fetch("/api/access-policies/mailbox-blocks", { cache: "no-store" })
      const body = await response.clone().json() as { blocks?: MailboxBlock[] }
      if (!response.ok || !body.blocks) throw new LocalizedUiError(tApi(await readApiErrorCode(response, "MAILBOX_BLOCKS_READ_FAILED") as never))
      setBlocks(body.blocks)
    } catch (caught) {
      setError(localizedUiErrorMessage(caught, t("errors.loadBlocks")))
    }
  }, [t, tApi])

  useEffect(() => { void Promise.all([loadPolicies(), loadBlocks()]) }, [loadBlocks, loadPolicies])
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => void loadUsers(controller.signal), 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [loadUsers])
  useEffect(() => { setBlockPage(1) }, [blockDomainFilter, blockScopeFilter, deferredBlockSearch])
  useEffect(() => {
    if (blockPage > blockPageCount) setBlockPage(blockPageCount)
  }, [blockPage, blockPageCount])
  useEffect(() => {
    if (blockDomainFilter !== allMailboxBlockDomains && !blockFilterDomains.includes(blockDomainFilter)) {
      setBlockDomainFilter(allMailboxBlockDomains)
    }
  }, [blockDomainFilter, blockFilterDomains])

  const selectedUser = useMemo(() => users.find(user => user.id === selectedUserId) ?? null, [selectedUserId, users])
  const selectedUserRole = roleForUser(selectedUser)


  const saveRoles = async () => {
    if (!policies) return
    setSaving(true); setError("")
    try {
      const response = await fetch("/api/access-policies", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mailQuotaRules: policies.mailQuotaRules }) })
      const body = await response.clone().json() as { policies?: AccessPolicies }
      if (!response.ok || !body.policies) throw new LocalizedUiError(tApi(await readApiErrorCode(response, "ACCESS_POLICIES_SAVE_FAILED") as never))
      setPolicies(body.policies)
      setUsageRevision(value => value + 1)
      toast({ title: t("success.savePolicies") })
    } catch (caught) { setError(localizedUiErrorMessage(caught, t("errors.savePolicies"))) } finally { setSaving(false) }
  }

  const selectUser = (id: string) => setSelectedUserId(id)

  const resetBlockDraft = () => {
    setEditingBlockId(null)
    setBlockLocalPart("")
    setBlockScope("global")
    setBlockUserId("")
    setBlockAllowedRoles([])
  }

  const editBlock = (block: MailboxBlock) => {
    setEditingBlockId(block.id)
    setBlockLocalPart(block.localPart)
    setBlockDomain(block.domain)
    if (block.allowedRoles) {
      setBlockScope("roles")
      setBlockAllowedRoles(block.allowedRoles)
      setBlockUserId("")
    } else if (block.userId) {
      setBlockScope("user")
      setBlockUserId(block.userId)
      setBlockAllowedRoles([])
    } else {
      setBlockScope("global")
      setBlockUserId("")
      setBlockAllowedRoles([])
    }
    requestAnimationFrame(() => blockFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }))
  }

  const saveBlock = async () => {
    if (!normalizedBlockLocalPart || !blockDomain || (blockScope === "user" && !blockUserId)) return
    const updating = editingBlockId !== null
    setSavingBlock(true)
    setError("")
    try {
      const endpoint = updating
        ? `/api/access-policies/mailbox-blocks?id=${encodeURIComponent(editingBlockId!)}`
        : "/api/access-policies/mailbox-blocks"
      const response = await fetch(endpoint, { method: updating ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: blockScope, userId: blockScope === "user" ? blockUserId : undefined, allowedRoles: blockScope === "roles" ? blockAllowedRoles : undefined, localPart: normalizedBlockLocalPart, domain: blockDomain }) })
      if (!response.ok) throw new LocalizedUiError(tApi(await readApiErrorCode(response, updating ? "MAILBOX_BLOCK_UPDATE_FAILED" : "MAILBOX_BLOCK_CREATE_FAILED") as never))
      await loadBlocks()
      if (updating) resetBlockDraft()
      else setBlockLocalPart("")
      toast({ title: t(updating ? "success.updateBlock" : "success.createBlock") })
    } catch (caught) {
      setError(localizedUiErrorMessage(caught, t(updating ? "errors.updateBlock" : "errors.createBlock")))
    } finally {
      setSavingBlock(false)
    }
  }

  const deleteBlock = async (id: string) => {
    setDeletingBlockId(id)
    setError("")
    try {
      const response = await fetch(`/api/access-policies/mailbox-blocks?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      if (!response.ok) throw new LocalizedUiError(tApi(await readApiErrorCode(response, "MAILBOX_BLOCK_DELETE_FAILED") as never))
      setBlocks(previous => previous.filter(block => block.id !== id))
      if (editingBlockId === id) resetBlockDraft()
      toast({ title: t("success.deleteBlock") })
    } catch (caught) {
      setError(localizedUiErrorMessage(caught, t("errors.deleteBlock")))
    } finally {
      setDeletingBlockId(null)
    }
  }


  if (loading) return <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>

  if (!policies) return <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
    <p role="alert" className="text-destructive">{error || t("errors.loadPolicies")}</p>
    <Button variant="outline" size="sm" onClick={() => void loadPolicies()}>{tSession("retry")}</Button>
  </div>

  const blockAddress = (block: Pick<MailboxBlock, "localPart" | "domain">) => (
    block.domain === ALL_MAILBOX_BLOCK_DOMAINS
      ? t("blocks.allDomainsAddress", { localPart: block.localPart })
      : `${block.localPart}@${block.domain}`
  )
  const blockScopeDescription = (block: MailboxBlock) => block.allowedRoles
    ? t("blocks.rolesScope", { roles: block.allowedRoles.length ? formatList.list(block.allowedRoles.map(item => tRoles(roleTranslationKeys[item])), { type: "unit" }) : t("blocks.emperorOnly") })
    : block.userId
      ? t("blocks.userScope", { user: block.user?.name || block.user?.username || block.user?.email || block.userId })
      : t("blocks.globalScope")
  const blockRangeStart = filteredBlocks.length === 0
    ? 0
    : (currentBlockPage - 1) * mailboxBlockPageSize + 1
  const blockRangeEnd = Math.min(currentBlockPage * mailboxBlockPageSize, filteredBlocks.length)
  const blockFiltersActive = blockSearch.length > 0
    || blockScopeFilter !== allMailboxBlockScopes
    || blockDomainFilter !== allMailboxBlockDomains
  return (
    <div className="min-w-0 rounded-lg border-2 border-primary/20 bg-background p-4 sm:p-5">
      <div className="mb-4 flex min-w-0 items-start gap-2"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div className="min-w-0"><h2 className="font-semibold">{t("title")}</h2><p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{t("description")}</p></div></div>
      {error && <div className="mb-4 rounded border border-destructive/60 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      <Tabs defaultValue="roles" className="min-w-0">
        <TabsList className="h-auto w-full max-w-full justify-start overflow-x-auto"><TabsTrigger className="shrink-0" value="roles">{t("tabs.roles")}</TabsTrigger><TabsTrigger className="shrink-0" value="users">{t("tabs.users")}</TabsTrigger><TabsTrigger className="shrink-0" value="mailQuotas">{t("tabs.mailQuotas")}</TabsTrigger><TabsTrigger className="shrink-0" value="blocks">{t("tabs.blocks")}</TabsTrigger></TabsList>
        <TabsContent value="roles" className="pt-2"><RoleAccessEditor /></TabsContent>
        <TabsContent value="users" className="space-y-4 pt-2">
          <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(15rem,.8fr)]"><div className="relative min-w-0"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder={t("searchPlaceholder")} className="min-w-0 pl-9" /></div><Select value={selectedUserId} onValueChange={selectUser}><SelectTrigger className="min-w-0 gap-2 [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0"><SelectValue placeholder={t("selectUser")} /></SelectTrigger><SelectContent>{users.map(user => <SelectItem key={user.id} value={user.id}>{tFormat("identityRole", { identity: user.name || user.username || user.email || user.id, role: tRoles(roleTranslationKeys[roleForUser(user)]) })}</SelectItem>)}</SelectContent></Select></div>
          {selectedUser ? <AccessEditor key={selectedUser.id} userId={selectedUser.id} role={selectedUserRole} /> : <p className="py-6 text-center text-sm text-muted-foreground">{t("selectUserHint")}</p>}
        </TabsContent>
        <TabsContent value="mailQuotas" className="min-w-0 space-y-4 pt-2">
      <div className="mb-4 rounded-md border border-primary/20 bg-primary/5 p-3">
        <h3 className="flex items-center gap-2 text-sm font-medium"><Info className="h-4 w-4 text-primary" />{t("quotaGuide.title")}</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
          <li>{t("quotaGuide.general")}</li>
          <li>{t("quotaGuide.mail")}</li>
          <li>{t("quotaGuide.enforcement")}</li>
        </ul>
      </div>
<MailQuotaRuleEditor rules={policies.mailQuotaRules} domains={domains} users={users} onUserResolved={rememberUser} onChange={mailQuotaRules => setPolicies(previous => previous ? { ...previous, mailQuotaRules } : previous)} /><MailQuotaUsageManager users={users} revision={usageRevision} onUserResolved={rememberUser} onReset={() => { setUsageRevision(value => value + 1); toast({ title: t("success.resetUsage") }) }} /><div className="flex justify-end"><Button className="w-full sm:w-auto" onClick={() => void saveRoles()} disabled={saving}><Save className="mr-1 h-4 w-4 shrink-0" />{t("actions.save")}</Button></div></TabsContent>
        <TabsContent value="blocks" className="min-w-0 space-y-4 pt-2">
          <div>
            <h3 className="text-sm font-medium">{t("blocks.title")}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("blocks.help")}</p>
          </div>

          <div ref={blockFormRef} className={`space-y-3 rounded-md border p-3 transition-colors ${editingBlockId ? "border-primary/50 bg-primary/[0.03]" : ""}`}>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-medium">{t(editingBlockId ? "blocks.editTitle" : "blocks.createTitle")}</h4>
                <p className="text-xs leading-relaxed text-muted-foreground">{t(editingBlockId ? "blocks.editHelp" : "blocks.createHelp")}</p>
              </div>
              {editingBlockId && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">{t("blocks.editing")}</span>}
            </div>
            <div className="grid min-w-0 gap-2 lg:grid-cols-2 xl:grid-cols-[minmax(7rem,1fr)_minmax(8rem,1fr)_minmax(8rem,.8fr)_minmax(10rem,1.2fr)_auto]">
              <Input aria-label={t("blocks.localPart")} className="h-8 min-w-0" value={blockLocalPart} onChange={event => setBlockLocalPart(event.target.value.split("@", 1)[0].slice(0, 64))} placeholder={t("blocks.localPart")} maxLength={64} pattern="(?:\*|[A-Za-z0-9._+-]+)" autoCapitalize="none" autoComplete="off" spellCheck={false} />
              <Select value={blockDomain} onValueChange={setBlockDomain}><SelectTrigger aria-label={t("blocks.domain")} className="h-8 min-w-0 gap-2 [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0"><SelectValue placeholder={t("blocks.domain")} /></SelectTrigger><SelectContent><SelectItem value={ALL_MAILBOX_BLOCK_DOMAINS}>{t("blocks.allDomains")}</SelectItem>{domains.map(domain => <SelectItem key={domain} value={domain}>{domain}</SelectItem>)}</SelectContent></Select>
              <Select value={blockScope} onValueChange={value => setBlockScope(value as "global" | "user" | "roles")}><SelectTrigger aria-label={t("blocks.scope")} className="h-8 min-w-0 gap-2 [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="global">{t("blocks.global")}</SelectItem><SelectItem value="user">{t("blocks.user")}</SelectItem><SelectItem value="roles">{t("blocks.roles")}</SelectItem></SelectContent></Select>
              {blockScope === "user" ? <SearchableUserSelect value={blockUserId} onValueChange={setBlockUserId} knownUsers={blockKnownUsers} onUserResolved={rememberUser} /> : <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded border px-2 py-1 text-xs">{blockScope === "roles" ? roles.filter(item => item !== ROLES.EMPEROR).map(item => <label key={item} className="flex items-center gap-1"><Checkbox checked={blockAllowedRoles.includes(item)} onChange={checked => setBlockAllowedRoles(previous => checked ? [...new Set([...previous, item])] : previous.filter(roleName => roleName !== item))} />{tRoles(roleTranslationKeys[item])}</label>) : <span className="min-w-0 leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{t("blocks.globalHint")}</span>}</div>}
              <div className="flex min-w-0 gap-2 lg:col-span-2 lg:justify-end xl:col-span-1">
                {editingBlockId && <Button type="button" size="sm" variant="outline" className="min-h-8 h-auto flex-1 whitespace-normal lg:flex-none" disabled={savingBlock} onClick={resetBlockDraft}><X className="mr-1 h-4 w-4 shrink-0" />{t("blocks.cancelEdit")}</Button>}
                <Button type="button" size="sm" className="min-h-8 h-auto flex-1 whitespace-normal lg:flex-none" disabled={savingBlock || !normalizedBlockLocalPart || !blockDomain || (blockScope === "user" && !blockUserId)} onClick={() => void saveBlock()}>{savingBlock && <Loader2 className="mr-1 h-4 w-4 shrink-0 animate-spin" />}{t(editingBlockId ? "blocks.update" : "blocks.add")}</Button>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("blocks.wildcardHelp", { wildcard: ALL_MAILBOX_BLOCK_LOCAL_PARTS })}</p>
            {blockScope === "roles" && <p className="text-xs leading-relaxed text-muted-foreground">{t("blocks.rolesHelp")}</p>}
            {invalidBlockLocalPart && <p className="text-xs text-destructive">{t("blocks.invalidLocalPart")}</p>}
          </div>

          <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1fr)_10rem_minmax(10rem,14rem)_auto]">
            <div className="relative min-w-0 sm:col-span-2 xl:col-span-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={blockSearch} onChange={event => setBlockSearch(event.target.value)} placeholder={t("blocks.search")} className="min-w-0 pl-9" /></div>
            <Select value={blockScopeFilter} onValueChange={value => setBlockScopeFilter(value as typeof blockScopeFilter)}><SelectTrigger aria-label={t("blocks.scopeFilter")} className="min-w-0 gap-2 [&>span]:min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={allMailboxBlockScopes}>{t("blocks.allScopes")}</SelectItem><SelectItem value="global">{t("blocks.global")}</SelectItem><SelectItem value="user">{t("blocks.user")}</SelectItem><SelectItem value="roles">{t("blocks.roles")}</SelectItem></SelectContent></Select>
            <Select value={blockDomainFilter} onValueChange={setBlockDomainFilter}><SelectTrigger aria-label={t("blocks.domainFilter")} className="min-w-0 gap-2 [&>span]:min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={allMailboxBlockDomains}>{t("blocks.allDomainScopes")}</SelectItem>{blockFilterDomains.map(domain => <SelectItem key={domain} value={domain}>{domain === ALL_MAILBOX_BLOCK_DOMAINS ? t("blocks.allDomains") : domain}</SelectItem>)}</SelectContent></Select>
            <Button type="button" variant="outline" className="min-w-0 sm:col-span-2 xl:col-span-1" disabled={!blockFiltersActive} onClick={() => { setBlockSearch(""); setBlockScopeFilter("all"); setBlockDomainFilter(allMailboxBlockDomains) }}><X className="mr-1 h-4 w-4 shrink-0" />{t("blocks.clearFilters")}</Button>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("blocks.resultCount", { filtered: filteredBlocks.length, total: blocks.length })}</span>
            {filteredBlocks.length > 0 && <span>{t("blocks.range", { start: blockRangeStart, end: blockRangeEnd, total: filteredBlocks.length })}</span>}
          </div>

          {blocks.length === 0 ? <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">{t("blocks.empty")}</div> : filteredBlocks.length === 0 ? <div className="space-y-3 rounded border border-dashed p-6 text-center text-sm text-muted-foreground"><p>{t("blocks.noSearchResults")}</p>{blockFiltersActive && <Button type="button" size="sm" variant="outline" onClick={() => { setBlockSearch(""); setBlockScopeFilter("all"); setBlockDomainFilter(allMailboxBlockDomains) }}>{t("blocks.clearFilters")}</Button>}</div> : <div className="overflow-hidden rounded-md border">{pagedBlocks.map(block => <div key={block.id} className={`grid min-w-0 gap-2 border-b p-2.5 transition-colors last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,.9fr)_auto] sm:items-center ${editingBlockId === block.id ? "bg-primary/[0.05]" : "hover:bg-muted/40"}`}><div className="min-w-0 truncate font-mono text-sm" title={blockAddress(block)}>{blockAddress(block)}</div><div className="min-w-0 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{blockScopeDescription(block)}</div><div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t("blocks.editAddress", { address: blockAddress(block) })} title={t("blocks.edit")} disabled={savingBlock || deletingBlockId === block.id} onClick={() => editBlock(block)}><Pencil className="h-4 w-4" /></Button><AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" aria-label={t("blocks.deleteAddress", { address: blockAddress(block) })} title={t("blocks.delete")} disabled={savingBlock || deletingBlockId === block.id}>{deletingBlockId === block.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("blocks.deleteTitle")}</AlertDialogTitle><AlertDialogDescription>{t("blocks.deleteDescription", { address: blockAddress(block) })}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("blocks.cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void deleteBlock(block.id)}>{t("blocks.delete")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></div>)}</div>}

          {filteredBlocks.length > mailboxBlockPageSize && <div className="flex min-w-0 items-center justify-between gap-3"><Button type="button" size="sm" variant="outline" disabled={currentBlockPage <= 1} onClick={() => setBlockPage(page => Math.max(1, page - 1))}><ChevronLeft className="mr-1 h-4 w-4" />{t("blocks.previous")}</Button><span className="text-xs text-muted-foreground">{t("blocks.page", { page: currentBlockPage, pages: blockPageCount })}</span><Button type="button" size="sm" variant="outline" disabled={currentBlockPage >= blockPageCount} onClick={() => setBlockPage(page => Math.min(blockPageCount, page + 1))}>{t("blocks.next")}<ChevronRight className="ml-1 h-4 w-4" /></Button></div>}
        </TabsContent>
      </Tabs>
    </div>
  )
}
