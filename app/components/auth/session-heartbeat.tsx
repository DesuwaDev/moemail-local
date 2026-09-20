"use client"
import { useEffect } from "react"
import { useSession } from "next-auth/react"
import { useCurrentOriginSignOut } from "@/hooks/use-current-origin-sign-out"

/** Visible-tab presence, with a five-minute input idle cutoff for active time. */
export function SessionHeartbeat() {
  const { data: session, status } = useSession()
  const { signOutFromCurrentOrigin } = useCurrentOriginSignOut()
  useEffect(() => {
    if (status !== "authenticated") return
    let lastInput = Date.now(), lastSent = 0, busy = false
    const controller = new AbortController()
    const activity = () => { lastInput = Date.now() }
    const heartbeat = async () => {
      const now = Date.now()
      if (document.visibilityState !== "visible" || busy || now - lastSent < 15_000) return
      busy = true; lastSent = now
      try {
        const response = await fetch("/api/account/sessions", { method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: now - lastInput < 5 * 60_000 }) })
        if (response.status === 401 && !controller.signal.aborted) {
          await signOutFromCurrentOrigin()
          window.location.replace(new URL("/", window.location.origin).href)
        }
      } catch { /* An offline browser must not lose its login. */ }
      finally { busy = false }
    }
    const visible = () => { if (document.visibilityState === "visible") { activity(); void heartbeat() } }
    for (const event of ["pointerdown", "keydown", "scroll", "touchstart"]) window.addEventListener(event, activity, { passive: true })
    document.addEventListener("visibilitychange", visible)
    const timer = setInterval(() => void heartbeat(), 30_000)
    void heartbeat()
    return () => {
      controller.abort(); clearInterval(timer)
      for (const event of ["pointerdown", "keydown", "scroll", "touchstart"]) window.removeEventListener(event, activity)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [status, session?.sessionId, signOutFromCurrentOrigin])
  return null
}
