"use client"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog"

class AdminRequestError extends Error { constructor(readonly code: string) { super(code) } }
export const adminFailureCode = (error: unknown) => error instanceof AdminRequestError ? error.code : "ADMIN_OPERATION_FAILED"

export async function adminRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const body = await response.json()
  if (!response.ok) throw new AdminRequestError(typeof body.code === "string" ? body.code : "INVALID_REQUEST")
  return body as T
}
export function useAdminData<T>(url: string | null, revision = 0) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true)
  useEffect(() => {
    setData(null); setError("")
    if (!url) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      void adminRequest<T>(url, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value) }).catch(caught => {
        if (!controller.signal.aborted) setError(adminFailureCode(caught))
      }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [url, revision])
  return { data, error, loading }
}
export function AdminError({ code }: { code: string }) {
  const t = useTranslations("api")
  return code ? <p role="alert" className="rounded-md border border-destructive/30 p-2 text-sm text-destructive">{t.has(code as never) ? t(code as never) : t("INVALID_REQUEST")}</p> : null
}
export function AdminPager({ page, pages, total, loading, onChange }: { page: number; pages: number; total: number; loading?: boolean; onChange: (page: number) => void }) {
  const t = useTranslations("admin.management")
  return <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
    <span>{t("pagination", { page, pages, total })}</span><div className="flex shrink-0 gap-1">
      <Button variant="outline" size="icon" className="h-8 w-8" aria-label={t("previous")} disabled={loading || page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
      <Button variant="outline" size="icon" className="h-8 w-8" aria-label={t("next")} disabled={loading || page >= pages} onClick={() => onChange(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
    </div></div>
}
export function AdminConfirm({ label, description, onConfirm, disabled, destructive = true }: { label: string; description: string; onConfirm: () => void; disabled?: boolean; destructive?: boolean }) {
  const t = useTranslations("admin.management")
  return <AlertDialog><AlertDialogTrigger asChild><Button size="sm" variant="outline" disabled={disabled} className={destructive ? "text-destructive" : ""}>{label}</Button></AlertDialogTrigger>
    <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto"><AlertDialogHeader><AlertDialogTitle>{label}</AlertDialogTitle><AlertDialogDescription className="break-words">{description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={onConfirm}>{t("confirm")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}
