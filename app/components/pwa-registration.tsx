"use client"

import { useEffect } from "react"

// next-pwa injects its registration into the Pages Router entry, which the
// App Router never loads. Register explicitly without caching private routes.
export function PwaRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    const register = () => {
      void navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      }).catch(error => console.warn("pwa.registration_failed", error))
    }
    if (document.readyState === "complete") register()
    else window.addEventListener("load", register, { once: true })
    return () => window.removeEventListener("load", register)
  }, [])
  return null
}
