"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { nanoid } from "nanoid"
import { useFormatter, useTranslations } from "next-intl"
import { parse, stringify } from "yaml"
import { AlertTriangle, CheckCircle2, Dices, Eye, EyeOff, FileCog, RefreshCw, RotateCcw, Save, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { ClientIpSettings } from "./client-ip-settings"
import { LocalizedUiError, localizedUiErrorMessage } from "@/lib/localized-ui-error"
import {
  runtimeConfigFields,
  runtimeGroupOrder,
  type RuntimeFieldMetadata,
} from "./runtime-config-fields"

interface ConfigIssue { path: string; code?: string }
interface ConfigStatus {
  fileExists: boolean
  loadedFromFile: boolean
  lastError: { at: string; issues: ConfigIssue[] } | null
  restartRequired: { at: string; reason: string } | null
}
type ConfigObject = Record<string, unknown>
type RuntimeGroup = typeof runtimeGroupOrder[number]
type FieldEntry = [string, RuntimeFieldMetadata]
interface RuntimeConfigResponse {
  yaml: string
  config: ConfigObject
  defaults: ConfigObject
  fingerprint: string
  revision: number
  path: string
  status: ConfigStatus
  restartRequired?: boolean
  restartReason?: string | null
  error?: string
  issues?: ConfigIssue[]
}

// Nested objects become headed sections instead of collapsible panels.
const groupSections: Partial<Record<RuntimeGroup, readonly string[]>> = {
  database: ["sqlite", "postgres"],
  auth: ["github", "google", "passkeys", "rateLimit"],
}
// Edited together by the client IP composite control (with live detection).
const clientIpPaths = ["server.trustProxyHeaders", "server.clientIpHeader", "server.clientIpTrustedHops"]
const clientIpControlIds: Record<string, string> = {
  "server.trustProxyHeaders": "client-ip-enabled",
  "server.clientIpHeader": "client-ip-header",
  "server.clientIpTrustedHops": "client-ip-hops",
}

function getPath(root: ConfigObject, path: string) {
  return path.split(".").reduce<unknown>((value, key) => (
    typeof value === "object" && value !== null ? (value as ConfigObject)[key] : undefined
  ), root)
}

function setPath(root: ConfigObject, path: string, value: unknown) {
  const clone = structuredClone(root)
  const segments = path.split(".")
  let cursor = clone
  for (const segment of segments.slice(0, -1)) {
    cursor = cursor[segment] as ConfigObject
  }
  cursor[segments.at(-1)!] = value
  return clone
}

function groupForPath(path: string): RuntimeGroup {
  const group = path.includes(".") ? path.split(".")[0] : "root"
  return (runtimeGroupOrder as readonly string[]).includes(group) ? group as RuntimeGroup : "root"
}

const controlId = (path: string) => clientIpControlIds[path] ?? "runtime-field-" + path.replaceAll(".", "-")

function RuntimeField({
  path,
  metadata,
  value,
  defaultValue,
  disabled,
  onChange,
}: {
  path: string
  metadata: RuntimeFieldMetadata
  value: unknown
  defaultValue: unknown
  disabled: boolean
  onChange: (value: unknown) => void
}) {
  const t = useTranslations("runtime")
  const [secretVisible, setSecretVisible] = useState(false)
  const kind = metadata.kind ?? (typeof defaultValue === "boolean" ? "boolean" : typeof defaultValue === "number" ? "number" : "text")
  const changed = JSON.stringify(value) !== JSON.stringify(defaultValue)
  const requiredMissing = metadata.required && (value === null || value === undefined || String(value).trim() === "")
  const canRestoreDefault = kind !== "secret"
  const canGenerateSecret = kind === "secret" && metadata.secretAction === "generate"
  const label = t(`fields.${path}.label` as never)
  const description = t(`fields.${path}.description` as never)
  const id = controlId(path)

  return (
    <div className={cn("min-w-0 space-y-2", kind === "textarea" && "md:col-span-2")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor={id} className="text-sm font-medium leading-5">{label}{metadata.required && <span className="ml-0.5 text-destructive">*</span>}</Label>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {kind === "boolean" && <Switch id={id} className="mt-0.5 shrink-0" checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} />}
        {canGenerateSecret ? (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={disabled} onClick={() => onChange(nanoid(43))} title={t("actions.generate")} aria-label={t("actions.generateFor", { label })}><Dices className="h-3.5 w-3.5" /></Button>
        ) : canRestoreDefault ? (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={disabled || !changed} onClick={() => onChange(defaultValue)} title={t("actions.restoreDefault")} aria-label={t("actions.restoreDefault")}><RotateCcw className="h-3.5 w-3.5" /></Button>
        ) : null}
      </div>
      {kind === "boolean" ? null : kind === "select" ? (
        <Select value={String(value)} onValueChange={onChange} disabled={disabled}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent>{metadata.options?.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
      ) : kind === "textarea" ? (
        <Textarea id={id} value={value == null ? "" : String(value)} onChange={event => onChange(event.target.value || null)} disabled={disabled} spellCheck={false} className="min-h-28 font-mono text-xs" />
      ) : kind === "secret" ? (
        <div className="relative">
          <Input
            id={id}
            type={secretVisible ? "text" : "password"}
            value={value == null ? "" : String(value)}
            onChange={event => onChange(event.target.value || (defaultValue === null ? null : ""))}
            disabled={disabled}
            spellCheck={false}
            autoComplete="new-password"
            aria-invalid={requiredMissing}
            className="pr-10 font-mono"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full w-10 hover:bg-transparent"
            disabled={disabled}
            onClick={() => setSecretVisible(visible => !visible)}
            title={secretVisible ? t("actions.hide", { label }) : t("actions.show", { label })}
            aria-label={secretVisible ? t("actions.hide", { label }) : t("actions.show", { label })}
          >
            {secretVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      ) : (
        <Input
          id={id}
          type={kind === "number" ? "number" : "text"}
          value={value == null ? "" : String(value)}
          onChange={event => onChange(kind === "number" ? Number(event.target.value) : event.target.value || (defaultValue === null ? null : ""))}
          disabled={disabled}
          spellCheck={false}
        />
      )}
      {requiredMissing && <p className="text-xs text-destructive">{t("required")}</p>}
      <code className="block truncate text-[10px] text-muted-foreground/80" title={path}>{path}</code>
    </div>
  )
}

export function RuntimeConfigPanel() {
  const format = useFormatter()
  const t = useTranslations("runtime")
  const tApi = useTranslations("api")
  const tClientIp = useTranslations("runtime.clientIp")
  const [yaml, setYaml] = useState("")
  const [savedYaml, setSavedYaml] = useState("")
  const [config, setConfig] = useState<ConfigObject | null>(null)
  const [savedConfig, setSavedConfig] = useState<ConfigObject | null>(null)
  const [defaults, setDefaults] = useState<ConfigObject | null>(null)
  const [revision, setRevision] = useState<number | null>(null)
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  const [path, setFilePath] = useState("")
  const [status, setStatus] = useState<ConfigStatus | null>(null)
  const [mode, setMode] = useState("visual")
  const [activeGroup, setActiveGroup] = useState<RuntimeGroup>(runtimeGroupOrder[0])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [issues, setIssues] = useState<ConfigIssue[]>([])
  const [conflict, setConflict] = useState(false)

  const applyResponse = (body: RuntimeConfigResponse) => {
    setYaml(body.yaml)
    setSavedYaml(body.yaml)
    setConfig(body.config)
    setSavedConfig(body.config)
    setDefaults(body.defaults)
    setRevision(body.revision)
    setFingerprint(body.fingerprint)
    setFilePath(body.path)
    setStatus(body.status)
  }

  const loadConfig = useCallback(async () => {
    setLoading(true); setError(""); setIssues([]); setConflict(false); setMessage("")
    try {
      const response = await fetch("/api/runtime-config", { cache: "no-store" })
      const body = await response.json() as RuntimeConfigResponse
      if (!response.ok) {
        throw new LocalizedUiError(body.error && tApi.has(body.error as never)
          ? tApi(body.error as never)
          : t("errors.load"))
      }
      applyResponse(body)
    } catch (caught) {
      console.error("runtime_config.load_failed", caught)
      setError(localizedUiErrorMessage(caught, t("errors.load")))
    } finally { setLoading(false) }
  }, [t, tApi])

  useEffect(() => { void loadConfig() }, [loadConfig])

  const groupedFields = useMemo(() => new Map(runtimeGroupOrder.map(group => [
    group,
    Object.entries(runtimeConfigFields).filter(([fieldPath]) => groupForPath(fieldPath) === group) as FieldEntry[],
  ])), [])

  const missingRequiredFields = useMemo(() => config
    ? Object.entries(runtimeConfigFields).filter(([fieldPath, metadata]) => {
      if (!metadata.required) return false
      const value = getPath(config, fieldPath)
      return value === null || value === undefined || String(value).trim() === ""
    })
    : [], [config])
  const formattedRequiredFields = format.list(
    missingRequiredFields.map(([fieldPath]) => t(`fields.${fieldPath}.label` as never)),
    { type: "unit" },
  )

  const dirtyPaths = useMemo(() => config && savedConfig
    ? Object.keys(runtimeConfigFields).filter(fieldPath => JSON.stringify(getPath(config, fieldPath)) !== JSON.stringify(getPath(savedConfig, fieldPath)))
    : [], [config, savedConfig])
  const dirtyGroups = new Set(dirtyPaths.map(groupForPath))
  const issueGroups = new Set([...issues, ...(status?.lastError?.issues ?? [])].map(issue => groupForPath(issue.path)))
  for (const [fieldPath] of missingRequiredFields) issueGroups.add(groupForPath(fieldPath))

  const saveConfig = async () => {
    if (revision === null || !fingerprint || !config) return
    if (mode === "visual" && missingRequiredFields.length > 0) {
      setError(t("requiredSecrets", { fields: formattedRequiredFields }))
      return
    }
    setSaving(true); setError(""); setIssues([]); setConflict(false); setMessage("")
    try {
      const response = await fetch("/api/runtime-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "yaml" ? { yaml, fingerprint } : { config, fingerprint }),
      })
      const body = await response.json() as RuntimeConfigResponse
      if (!response.ok) {
        setConflict(response.status === 409)
        setIssues(body.issues ?? [])
        throw new LocalizedUiError(body.error && tApi.has(body.error as never)
          ? tApi(body.error as never)
          : t("errors.save"))
      }
      applyResponse(body)
      setMessage(body.restartRequired ? t("success.restart", { reason: t("success.driverRestart") }) : t("success.applied"))
    } catch (caught) {
      console.error("runtime_config.save_failed", caught)
      setError(localizedUiErrorMessage(caught, t("errors.save")))
    } finally { setSaving(false) }
  }

  const disabled = loading || saving || revision === null || !fingerprint || !config || !defaults

  const changeMode = (nextMode: string) => {
    if (nextMode === mode) return
    setError("")
    setIssues([])

    if (nextMode === "yaml") {
      if (config) setYaml(stringify(config, { lineWidth: 0 }))
      setMode("yaml")
      return
    }

    try {
      const parsed = parse(yaml, { prettyErrors: false }) as unknown
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new LocalizedUiError(t("errors.notObject"))
      }
      setConfig(parsed as ConfigObject)
      setMode("visual")
    } catch (caught) {
      console.error("runtime_config.yaml_parse_failed", caught)
      setError(t("errors.yamlSwitch", { reason: t("errors.syntax") }))
    }
  }

  const selectGroup = (group: RuntimeGroup) => { setActiveGroup(group); setQuery("") }

  // Jump from an issue to its control, switching group and mode as needed.
  const revealField = (fieldPath: string) => {
    if (mode !== "visual") changeMode("visual")
    selectGroup(groupForPath(fieldPath))
    window.setTimeout(() => {
      const control = document.getElementById(controlId(fieldPath))
      control?.scrollIntoView({ block: "center" })
      control?.focus()
    }, 50)
  }

  const normalizedQuery = query.trim().toLowerCase()
  const fieldMatches = ([fieldPath]: FieldEntry) => !normalizedQuery || [
    fieldPath,
    t(`fields.${fieldPath}.label` as never),
    t(`fields.${fieldPath}.description` as never),
  ].some(text => text.toLowerCase().includes(normalizedQuery))
  const clientIpMatches = !normalizedQuery
    || [tClientIp("title"), tClientIp("summary"), ...clientIpPaths].some(text => text.toLowerCase().includes(normalizedQuery))
    || clientIpPaths.some(fieldPath => fieldMatches([fieldPath, runtimeConfigFields[fieldPath]]))

  const renderField = ([fieldPath, metadata]: FieldEntry) => config && defaults && (
    <RuntimeField key={fieldPath} path={fieldPath} metadata={metadata} value={getPath(config, fieldPath)} defaultValue={getPath(defaults, fieldPath)} disabled={disabled} onChange={value => setConfig(current => current ? setPath(current, fieldPath, value) : current)} />
  )
  const fieldGrid = (fields: FieldEntry[]) => (
    <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">{fields.map(renderField)}</div>
  )
  const clientIp = config && (
    <ClientIpSettings value={{ trustProxyHeaders: Boolean(getPath(config, "server.trustProxyHeaders")), clientIpHeader: String(getPath(config, "server.clientIpHeader") ?? "auto"), clientIpTrustedHops: Number(getPath(config, "server.clientIpTrustedHops") ?? 1) }} disabled={disabled} revision={revision} onChange={value => setConfig(current => current ? Object.entries(value).reduce((next, [key, item]) => setPath(next, "server." + key, item), current) : current)} />
  )

  const groupContent = (group: RuntimeGroup) => {
    const fields = (groupedFields.get(group) ?? []).filter(([fieldPath]) => !clientIpPaths.includes(fieldPath))
    const subsections = groupSections[group] ?? []
    const inSection = (fieldPath: string, section: string) => fieldPath.startsWith(`${group}.${section}.`)
    const general = fields.filter(([fieldPath]) => !subsections.some(section => inSection(fieldPath, section)))
    const driver = config ? getPath(config, "database.driver") : undefined
    return <div className="divide-y">
      {general.length > 0 && <div className="pb-5">{fieldGrid(general)}</div>}
      {group === "server" && <div className="py-5">{clientIp}</div>}
      {subsections.map(section => (
        <section key={section} className="py-5 last:pb-0">
          <h4 className="mb-4 flex flex-wrap items-center gap-2 text-sm font-semibold">
            {t(`sections.${group}.${section}` as never)}
            {group === "database" && driver !== section && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{t("layout.inactive")}</span>}
          </h4>
          {fieldGrid(fields.filter(([fieldPath]) => inSection(fieldPath, section)))}
        </section>
      ))}
    </div>
  }

  const searchResults = runtimeGroupOrder.map(group => ({
    group,
    fields: (groupedFields.get(group) ?? []).filter(entry => !clientIpPaths.includes(entry[0]) && fieldMatches(entry)),
    clientIp: group === "server" && clientIpMatches,
  })).filter(result => result.fields.length > 0 || result.clientIp)
  const resultCount = searchResults.reduce((total, result) => total + result.fields.length + (result.clientIp ? 1 : 0), 0)

  const statusDots = (group: RuntimeGroup) => <>
    {issueGroups.has(group) && <span className="size-2 shrink-0 rounded-full bg-destructive" role="img" aria-label={t("layout.issueGroup")} title={t("layout.issueGroup")} />}
    {dirtyGroups.has(group) && <span className="size-2 shrink-0 rounded-full bg-primary" role="img" aria-label={t("layout.dirtyGroup")} title={t("layout.dirtyGroup")} />}
  </>
  const issueList = (list: ConfigIssue[]) => (
    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">{list.map((issue, index) => (
      <li key={`${issue.path}-${index}`}><button type="button" className="font-mono underline-offset-2 hover:underline" onClick={() => revealField(issue.path)}>{issue.path}</button></li>
    ))}</ul>
  )
  const yamlDirty = mode === "yaml" && yaml !== savedYaml

  return (
    <div className="rounded-lg border-2 border-primary/20 bg-background p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2"><FileCog className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div className="min-w-0"><h2 className="font-semibold">{t("title")}</h2><p className="text-xs leading-relaxed text-muted-foreground">{t("description")}</p></div></div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadConfig()} disabled={loading || saving}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />{t("reload")}</Button>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <div className="flex min-w-0 gap-1.5"><dt className="shrink-0">{t("file")}</dt><dd className="min-w-0 break-all font-mono text-foreground">{path || t("loading")}</dd></div>
        <div className="flex gap-1.5"><dt>{t("revision")}</dt><dd className="font-mono text-foreground">{revision ?? "-"}</dd></div>
        <div className="flex gap-1.5"><dt>{t("status")}</dt><dd className="text-foreground">{status?.loadedFromFile ? t("statusLoaded") : status?.fileExists ? t("statusPending") : t("statusMissing")}</dd></div>
      </dl>
      <p className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-relaxed">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
        <span><span className="font-medium text-destructive">{t("secretWarningTitle")}</span>{" "}<span className="text-muted-foreground">{t("secretWarningDescription")}</span></span>
      </p>

      <div className="mt-3 space-y-2 empty:hidden">
        {status?.restartRequired && <div className="rounded border border-amber-500/60 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">{t("success.driverRestart")}</div>}
        {status?.lastError && <div className="rounded border border-amber-500/60 bg-amber-500/10 p-3 text-sm"><p className="font-medium text-amber-700 dark:text-amber-300">{t("lastError")}</p>{issueList(status.lastError.issues)}</div>}
        {conflict && <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">{t("conflict")}</div>}
        {error && <div role="alert" className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        {issues.length > 0 && <div className="rounded border border-destructive/70 p-3 text-sm"><p className="font-medium text-destructive">{t("validationIssues")}</p>{issueList(issues)}</div>}
        {mode === "visual" && missingRequiredFields.length > 0 && <div className="rounded border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">{t("requiredSecrets", { fields: formattedRequiredFields })}</div>}
        {message && <div role="status" className="flex items-center gap-2 rounded border border-green-600/50 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{message}</div>}
      </div>

      <Tabs value={mode} onValueChange={changeMode} className="mt-4">
        <TabsList><TabsTrigger value="visual">{t("visual")}</TabsTrigger><TabsTrigger value="yaml">{t("yaml")}</TabsTrigger></TabsList>
        <TabsContent value="visual" className="mt-3">
          {config && defaults && <div className="grid min-w-0 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6">
            <aside className="min-w-0 space-y-2 lg:sticky lg:top-20 lg:self-start">
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("layout.search")} aria-label={t("layout.search")} className="h-9 pl-8 pr-8" />
                {query && <Button type="button" variant="ghost" size="icon" className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2" onClick={() => setQuery("")} aria-label={t("layout.clearSearch")} title={t("layout.clearSearch")}><X className="h-3.5 w-3.5" /></Button>}
              </div>
              <div className="lg:hidden">
                <Select value={activeGroup} onValueChange={value => selectGroup(value as RuntimeGroup)}>
                  <SelectTrigger aria-label={t("layout.groupLabel")}><SelectValue /></SelectTrigger>
                  <SelectContent>{runtimeGroupOrder.map(group => <SelectItem key={group} value={group}>
                    <span className="flex items-center gap-2">{t(`groups.${group}` as never)}{statusDots(group)}</span>
                  </SelectItem>)}</SelectContent>
                </Select>
              </div>
              <nav aria-label={t("layout.groupLabel")} className="hidden lg:block">
                <ul className="space-y-0.5">{runtimeGroupOrder.map(group => {
                  const active = !normalizedQuery && group === activeGroup
                  return <li key={group}>
                    <button type="button" aria-current={active ? "true" : undefined} onClick={() => selectGroup(group)} className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}>
                      <span className="min-w-0 flex-1 truncate">{t(`groups.${group}` as never)}</span>
                      {statusDots(group)}
                      <span className="text-xs tabular-nums opacity-70">{groupedFields.get(group)?.length ?? 0}</span>
                    </button>
                  </li>
                })}</ul>
              </nav>
            </aside>

            <section className="min-w-0" aria-live="polite">
              {normalizedQuery ? <>
                <p className="mb-4 border-b pb-2 text-sm text-muted-foreground">{resultCount ? t("layout.searchResults", { count: resultCount }) : t("layout.noResults")}</p>
                <div className="space-y-6">{searchResults.map(result => <div key={result.group}>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">{t(`groups.${result.group}` as never)}{statusDots(result.group)}</h3>
                  <div className="space-y-5">{result.clientIp && clientIp}{result.fields.length > 0 && fieldGrid(result.fields)}</div>
                </div>)}</div>
              </> : <>
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
                  <h3 className="flex items-center gap-2 text-base font-semibold">{t(`groups.${activeGroup}` as never)}{statusDots(activeGroup)}</h3>
                  <span className="text-xs text-muted-foreground">{t("layout.fieldCount", { count: groupedFields.get(activeGroup)?.length ?? 0 })}</span>
                </div>
                {groupContent(activeGroup)}
              </>}
            </section>
          </div>}
        </TabsContent>
        <TabsContent value="yaml"><Textarea value={yaml} onChange={event => setYaml(event.target.value)} disabled={disabled} aria-label={t("yamlAria")} spellCheck={false} className="min-h-[34rem] resize-y whitespace-pre font-mono text-xs leading-5" /></TabsContent>
      </Tabs>

      {/* Right padding keeps the save button clear of the site's floating menu button. */}
      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-5 flex items-center justify-between gap-3 rounded-b-lg border-t bg-background/95 py-3 pl-4 pr-[4.5rem] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-5 sm:-mb-5 sm:pl-5 xl:pr-5">
        <div className="min-w-0 text-xs leading-relaxed">
          <p className={dirtyPaths.length > 0 || yamlDirty ? "font-medium text-primary" : "text-muted-foreground"}>{mode === "yaml" ? (yamlDirty ? t("layout.unsavedYaml") : t("layout.saved")) : dirtyPaths.length > 0 ? t("layout.unsaved", { count: dirtyPaths.length }) : t("layout.saved")}</p>
          <p className="hidden text-muted-foreground md:block">{t("externalEditHint")}</p>
        </div>
        <Button className="shrink-0" onClick={() => void saveConfig()} disabled={disabled || (mode === "visual" && missingRequiredFields.length > 0)}><Save className="mr-1 h-4 w-4" />{saving ? t("saving") : t("save")}</Button>
      </div>
    </div>
  )
}
