"use client"

import { useCallback, useEffect, useId, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Key, Plus, Loader2, Copy, Trash2, ChevronDown, ChevronUp } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useCopy } from "@/hooks/use-copy"
import { useRolePermission } from "@/hooks/use-role-permission"
import { PERMISSIONS } from "@/lib/permissions"
import { useConfig } from "@/hooks/use-config"
import { readApiErrorCode } from "@/lib/api-error-client"
import { LocalizedUiError, localizedUiErrorMessage } from "@/lib/localized-ui-error"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiKeyLevels, type ApiKeyLevel } from "@/lib/api-key-policy"

type ApiKey = {
  id: string
  name: string
  accessLevel: ApiKeyLevel
  mailboxId: string | null
  mailboxAddress: string | null
  createdAt: string | null
  expiresAt: string | null
  enabled: boolean
}

export function ApiKeyPanel() {
  const fieldId = useId()
  const format = useFormatter()
  const t = useTranslations("profile.apiKey")
  const tCommon = useTranslations("common.actions")
  const tFormat = useTranslations("common.format")
  const tNoPermission = useTranslations("emails.noPermission")
  const tMessages = useTranslations("emails.messages")
  const tApi = useTranslations("api")
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [accessLevel, setAccessLevel] = useState<ApiKeyLevel>("read")
  const [mailboxAddress, setMailboxAddress] = useState("")
  const [expiresInDays, setExpiresInDays] = useState("30")
  const [newKey, setNewKey] = useState<string | null>(null)
  const { toast } = useToast()
  const { copyToClipboard } = useCopy()
  const [showExamples, setShowExamples] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const { checkPermission } = useRolePermission()
  const canManageApiKey = checkPermission(PERMISSIONS.MANAGE_API_KEY)

  const fetchApiKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/api-keys")
      if (!res.ok) throw new LocalizedUiError(tApi(await readApiErrorCode(res, "API_KEYS_READ_FAILED") as never))
      const data = await res.json() as { apiKeys: ApiKey[] }
      setApiKeys(data.apiKeys)
    } catch (error) {
      console.error(error)
      toast({
        title: t("createFailed"),
        description: localizedUiErrorMessage(error, t("createFailed")),
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }, [t, tApi, toast])

  useEffect(() => {
    if (canManageApiKey) {
      fetchApiKeys()
    }
  }, [canManageApiKey, fetchApiKeys])

  const { config } = useConfig()

  const createApiKey = async () => {
    if (!newKeyName.trim()) return

    setLoading(true)
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName, accessLevel, mailboxAddress, expiresInDays: Number(expiresInDays) })
      })

      if (!res.ok) throw new LocalizedUiError(tApi(await readApiErrorCode(res, "API_KEY_CREATE_FAILED") as never))

      const data = await res.json() as { key: string }
      setNewKey(data.key)
      fetchApiKeys()
    } catch (error) {
      console.error(error)
      toast({
        title: t("createFailed"),
        description: localizedUiErrorMessage(error, t("createFailed")),
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDialogClose = () => {
    setCreateDialogOpen(false)
    setNewKeyName("")
    setAccessLevel("read")
    setMailboxAddress("")
    setExpiresInDays("30")
    setNewKey(null)
  }

  const toggleApiKey = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/api-keys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      })

      if (!res.ok) throw new LocalizedUiError(tApi(await readApiErrorCode(res, "API_KEY_UPDATE_FAILED") as never))

      setApiKeys(keys =>
        keys.map(key =>
          key.id === id ? { ...key, enabled } : key
        )
      )
    } catch (error) {
      console.error(error)
      toast({
        title: t("createFailed"),
        description: localizedUiErrorMessage(error, t("createFailed")),
        variant: "destructive"
      })
    }
  }

  const deleteApiKey = async (id: string) => {
    try {
      const res = await fetch(`/api/api-keys/${id}`, {
        method: "DELETE"
      })

      if (!res.ok) throw new LocalizedUiError(tApi(await readApiErrorCode(res, "API_KEY_DELETE_FAILED") as never))

      setApiKeys(keys => keys.filter(key => key.id !== id))
      toast({
        title: t("deleteSuccess"),
        description: t("deleteSuccess")
      })
    } catch (error) {
      console.error(error)
      toast({
        title: t("deleteFailed"),
        description: localizedUiErrorMessage(error, t("deleteFailed")),
        variant: "destructive"
      })
    }
  }

  return (
    <div className="min-w-0 bg-background rounded-lg border-2 border-primary/20 p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Key className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">{t("title")}</h2>
        </div>
        {
          canManageApiKey && (
            <Dialog open={createDialogOpen} onOpenChange={(open) => {
              if (loading) return
              if (open) setCreateDialogOpen(true)
              else handleDialogClose()
            }}>
              <DialogTrigger asChild>
                <Button className="gap-2" onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="w-4 h-4" />
                  {t("create")}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg p-4 sm:p-6">
                <DialogHeader>
                  <DialogTitle>
                    {newKey ? t("createSuccess") : t("create")}
                  </DialogTitle>
                  <DialogDescription className={newKey ? "text-destructive" : undefined}>
                    {newKey ? t("saveKey") : t("policyHelp")}
                  </DialogDescription>
                </DialogHeader>

                {!newKey ? (
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor={`${fieldId}-name`}>{t("name")}</Label>
                      <Input
                        id={`${fieldId}-name`}
                        maxLength={100}
                        disabled={loading}
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        placeholder={t("namePlaceholder")}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="min-w-0 space-y-2">
                        <Label htmlFor={`${fieldId}-level`}>{t("accessLevel")}</Label>
                        <Select value={accessLevel} onValueChange={(value) => setAccessLevel(value as ApiKeyLevel)} disabled={loading}>
                          <SelectTrigger id={`${fieldId}-level`}><SelectValue /></SelectTrigger>
                          <SelectContent>{apiKeyLevels.map(level => <SelectItem key={level} value={level}>{t(`levels.${level}`)}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 space-y-2">
                        <Label htmlFor={`${fieldId}-expiry`}>{t("validFor")}</Label>
                        <Select value={expiresInDays} onValueChange={setExpiresInDays} disabled={loading}>
                          <SelectTrigger id={`${fieldId}-expiry`}><SelectValue /></SelectTrigger>
                          <SelectContent>{[7, 30, 90, 365].map(days => <SelectItem key={days} value={String(days)}>{t("days", { days })}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{t(`levelHelp.${accessLevel}`)}</p>
                    <div className="space-y-2">
                      <Label htmlFor={`${fieldId}-mailbox`}>{t("mailbox")}</Label>
                      <Input id={`${fieldId}-mailbox`} value={mailboxAddress} onChange={event => setMailboxAddress(event.target.value)}
                        disabled={loading} maxLength={320} autoCapitalize="none" spellCheck={false} inputMode="email"
                        aria-describedby={`${fieldId}-mailbox-help`} placeholder={t("mailboxPlaceholder")} />
                      <p id={`${fieldId}-mailbox-help`} className="text-sm text-muted-foreground">{t("mailboxHelp")}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>{t("key")}</Label>
                      <div className="flex gap-2">
                        <Input
                          value={newKey}
                          readOnly
                          className="min-w-0 font-mono text-sm"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          aria-label={t("copy")}
                          onClick={() => copyToClipboard(newKey)}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                <DialogFooter className="gap-2 sm:gap-0">
                  <DialogClose asChild>
                    <Button
                      variant="outline"
                      onClick={handleDialogClose}
                      disabled={loading}
                    >
                      {newKey ? tCommon("ok") : tCommon("cancel")}
                    </Button>
                  </DialogClose>
                  {!newKey && (
                    <Button
                      onClick={createApiKey}
                      disabled={loading || !newKeyName.trim()}
                    >
                      {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        t("create")
                      )}
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      </div>

      {
        !canManageApiKey ? (
          <div className="text-center text-muted-foreground py-8">
            <p>{tNoPermission("needPermission")}</p>
            <p className="mt-2">{tNoPermission("contactAdmin")}</p>
            {
              config?.adminContact && (
                <p className="mt-2">{tNoPermission("adminContact", { contact: config.adminContact })}</p>
              )
            }
          </div>
        ) : (
          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-8 space-y-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tMessages("loading")}</p>
                </div>
              </div>
            ) : apiKeys.length === 0 ? (
              <div className="text-center py-8 space-y-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Key className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-medium">{t("noKeys")}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("description")}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {apiKeys.map((key) => (
                  <div
                    key={key.id}
                    className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 rounded-lg border bg-card"
                  >
                    <div className="min-w-0 space-y-1 break-words [overflow-wrap:anywhere]">
                      <div className="font-medium">{key.name}</div>
                      <div className="text-sm text-muted-foreground">{t(`levels.${key.accessLevel}`)} · {key.mailboxId ? key.mailboxAddress || t("mailboxRemoved") : t("allMailboxes")}</div>
                      {key.createdAt && <div className="text-sm text-muted-foreground">
                        {tFormat("labelValue", {
                          label: t("createdAt"),
                          value: format.dateTime(new Date(key.createdAt)),
                        })}
                      </div>}
                      {key.expiresAt && <div className="text-sm text-muted-foreground">{t("expiresAt", { date: format.dateTime(new Date(key.expiresAt)) })}</div>}
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-2">
                      <Switch
                        aria-label={t("toggleKey", { name: key.name })}
                        checked={key.enabled}
                        onCheckedChange={(checked) => toggleApiKey(key.id, checked)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("delete")}
                        onClick={() => deleteApiKey(key.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="mt-8 space-y-4">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowExamples(!showExamples)}
                  >
                    {showExamples ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    {t("viewDocs")}
                  </button>

                  {showExamples && (
                    <div className="rounded-lg border bg-card p-4 space-y-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{t("docs.getConfig")}</div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(
                              `curl ${window.location.protocol}//${window.location.host}/api/config \\
  -H "X-API-Key: YOUR_API_KEY"`
                            )}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                        <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto">
                          {`curl ${window.location.protocol}//${window.location.host}/api/config \\
  -H "X-API-Key: YOUR_API_KEY"`}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{t("docs.generateEmail")}</div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(
                              `curl -X POST ${window.location.protocol}//${window.location.host}/api/emails/generate \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "test",
    "expiryTime": 3600000,
    "domain": "moemail.app"
  }'`
                            )}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                        <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto">
                          {`curl -X POST ${window.location.protocol}//${window.location.host}/api/emails/generate \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "test",
    "expiryTime": 3600000,
    "domain": "moemail.app"
  }'`}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{t("docs.getEmails")}</div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(
                              `curl ${window.location.protocol}//${window.location.host}/api/emails?cursor=CURSOR \\
  -H "X-API-Key: YOUR_API_KEY"`
                            )}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                        <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto">
                          {`curl ${window.location.protocol}//${window.location.host}/api/emails?cursor=CURSOR \\
  -H "X-API-Key: YOUR_API_KEY"`}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{t("docs.getMessages")}</div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(
                              `curl ${window.location.protocol}//${window.location.host}/api/emails/{emailId}?cursor=CURSOR \\
  -H "X-API-Key: YOUR_API_KEY"`
                            )}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                        <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto">
                          {`curl ${window.location.protocol}//${window.location.host}/api/emails/{emailId}?cursor=CURSOR \\
  -H "X-API-Key: YOUR_API_KEY"`}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{t("docs.getMessage")}</div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(
                              `curl ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/{messageId} \\
  -H "X-API-Key: YOUR_API_KEY"`
                            )}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                        <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto">
                          {`curl ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/{messageId} \\
  -H "X-API-Key: YOUR_API_KEY"`}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{t("docs.createEmailShare")}</div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(
                              `curl -X POST ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/share \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"expiresIn": 86400000}'`
                            )}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                        <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto">
                          {`curl -X POST ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/share \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"expiresIn": 86400000}'`}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{t("docs.getEmailShares")}</div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(
                              `curl ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/share \\
  -H "X-API-Key: YOUR_API_KEY"`
                            )}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                        <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto">
                          {`curl ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/share \\
  -H "X-API-Key: YOUR_API_KEY"`}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{t("docs.deleteEmailShare")}</div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(
                              `curl -X DELETE ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/share/{shareId} \\
  -H "X-API-Key: YOUR_API_KEY"`
                            )}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                        <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto">
                          {`curl -X DELETE ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/share/{shareId} \\
  -H "X-API-Key: YOUR_API_KEY"`}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{t("docs.createMessageShare")}</div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(
                              `curl -X POST ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/messages/{messageId}/share \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"expiresIn": 0}'`
                            )}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                        <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto">
                          {`curl -X POST ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/messages/{messageId}/share \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"expiresIn": 0}'`}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{t("docs.getMessageShares")}</div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(
                              `curl ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/messages/{messageId}/share \\
  -H "X-API-Key: YOUR_API_KEY"`
                            )}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                        <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto">
                          {`curl ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/messages/{messageId}/share \\
  -H "X-API-Key: YOUR_API_KEY"`}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{t("docs.deleteMessageShare")}</div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(
                              `curl -X DELETE ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/messages/{messageId}/share/{shareId} \\
  -H "X-API-Key: YOUR_API_KEY"`
                            )}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                        <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto">
                          {`curl -X DELETE ${window.location.protocol}//${window.location.host}/api/emails/{emailId}/messages/{messageId}/share/{shareId} \\
  -H "X-API-Key: YOUR_API_KEY"`}
                        </pre>
                      </div>

                      <div className="text-xs text-muted-foreground mt-4">
                        <p>{t("docs.notes")}</p>
                        <ul className="list-disc list-inside space-y-1 mt-2">
                          <li>{t("docs.note1")}</li>
                          <li>{t("docs.note2")}</li>
                          <li>{t("docs.note3")}</li>
                          <li>{t("docs.note4")}</li>
                          <li>{t("docs.note5")}</li>
                          <li>{t("docs.note6")}</li>
                          <li>{t("docs.note7")}</li>
                          <li>{t("docs.note8")}</li>
                          <li>{t("docs.note9")}</li>
                          <li>{t("docs.note10")}</li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )
      }
    </div>
  )
}
