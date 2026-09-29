"use client"

import { useEffect, useState } from "react"
import { browserSupportsWebAuthn, sendSignal } from "@simplewebauthn/browser"
import { useRuntimeConfig } from "@/providers"

/**
 * `ready` means this browser can use passkeys on this page. WebAuthn needs a
 * secure context on a domain name, and the server only accepts ceremonies from
 * the configured public origin.
 */
export type PasskeySupport = "checking" | "ready" | "browser" | "insecure" | "origin"

const isIpLiteral = (host: string) => host.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)

/** Server-renderable guess from the site address, so the UI does not jump after hydration. */
function initialSupport(siteOrigin: string): PasskeySupport {
  try {
    const { hostname, protocol } = new URL(siteOrigin)
    const local = hostname === "localhost" || hostname.endsWith(".localhost")
    return isIpLiteral(hostname) || (protocol !== "https:" && !local) ? "insecure" : "checking"
  } catch {
    return "insecure"
  }
}

export function usePasskeySupport() {
  const { baseUrl } = useRuntimeConfig()
  let siteOrigin = ""
  try { siteOrigin = new URL(baseUrl).origin } catch { siteOrigin = "" }
  const [support, setSupport] = useState<PasskeySupport>(() => initialSupport(siteOrigin))

  useEffect(() => {
    if (!browserSupportsWebAuthn()) setSupport("browser")
    else if (!window.isSecureContext || isIpLiteral(window.location.hostname)) setSupport("insecure")
    else if (siteOrigin !== window.location.origin) setSupport("origin")
    else setSupport("ready")
  }, [siteOrigin])

  return { support, siteOrigin }
}

export type PasskeyFailure = "cancelled" | "alreadyRegistered" | "origin" | "authenticator" | "failed"

/** Classify browser/authenticator errors into user-facing categories. */
export function classifyPasskeyError(error: unknown): PasskeyFailure {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown }
  // Chrome and Safari report both "user cancelled" and "timed out" this way.
  if (code === "ERROR_CEREMONY_ABORTED" || name === "NotAllowedError" || name === "AbortError") return "cancelled"
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" || name === "InvalidStateError") return "alreadyRegistered"
  if (code === "ERROR_INVALID_DOMAIN" || code === "ERROR_INVALID_RP_ID" || name === "SecurityError") return "origin"
  if (
    code === "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT"
    || code === "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT"
    || code === "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG"
    || name === "NotSupportedError"
    || name === "ConstraintError"
  ) return "authenticator"
  return "failed"
}

/** Ask the password manager to hide a passkey this site no longer accepts. */
export function signalUnknownPasskey(rpID: string, credentialID: string) {
  void sendSignal({ signalName: "unknownCredential", rpID, credentialID }).catch(() => undefined)
}

/** Tell the password manager which passkeys remain valid after a removal. */
export function signalAcceptedPasskeys(rpID: string, userID: string, allAcceptedCredentialIDs: string[]) {
  void sendSignal({ signalName: "allAcceptedCredentials", rpID, userID, allAcceptedCredentialIDs }).catch(() => undefined)
}
