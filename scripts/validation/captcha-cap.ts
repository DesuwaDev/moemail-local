import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import {
  capEndpoint, capTimeoutMs, captchaFallbackProvider, captchaProviderReady,
  captchaSiteverifyUrls, normalizeCaptchaConfig, publicCaptchaConfig,
  validCapLinkUrl, validCapServerUrl,
  capFailureProvider, captchaFailureChannel, captchaVerificationProviders,
} from "../../app/lib/captcha/providers"
import { verifyWithProvider } from "../../app/lib/captcha/siteverify"
import { capResponseFailure, fetchCap } from "../../app/lib/captcha/cap-transport"

const requests: { path: string; type?: string; body: Record<string, string> }[] = []
let consumed = false
const server = createServer(async (req, res) => {
  if (req.url === "/stalled-body") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.write("{")
    return
  }
  if (req.url === "/blocked") { res.writeHead(403).end("<h1>Forbidden</h1>"); return }
  if (req.url === "/hidden-block") { res.end("<h1>Access denied</h1>"); return }
  let body = ""
  for await (const chunk of req) body += chunk
  const input = JSON.parse(body) as Record<string, string>
  requests.push({ path: req.url!, type: req.headers["content-type"], body: input })
  if (input.response === "redirect") {
    res.writeHead(307, { Location: "/leak" }).end()
    return
  }
  const success = input.secret === "fixture-secret" && input.response === "once" && !consumed
  if (success) consumed = true
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify({ success: input.response === "malformed" ? "false" : success }))
})
server.listen(0, "127.0.0.1")
await once(server, "listening")
const address = server.address()
assert(address && typeof address !== "string")
try {
  const config = normalizeCaptchaConfig({
    enabled: true, provider: "cap", fallback: "turnstile",
    providers: {
      cap: { siteKey: "site key", secretKey: "fixture-secret",
        serverUrl: " https://captcha.example/prefix/ ",
        verificationServerUrl: `http://127.0.0.1:${address.port}/internal/` },
      turnstile: { siteKey: "backup", secretKey: "backup-secret" },
    },
  })
  assert.equal(config.providers.cap.serverUrl, "https://captcha.example/prefix")
  assert.equal(capEndpoint(config.providers.cap.serverUrl, "site key"), "https://captcha.example/prefix/site%20key/")
  assert.equal(capEndpoint(config.providers.cap.serverUrl, ".."), "")
  for (const url of ["javascript:alert(1)", "ftp://host", "https://user:pass@host", "https://host/?key=x", "https://host/#x", "https://host/?", "https://host/#"]) {
    assert.equal(validCapServerUrl(url), false, url)
  }
  const publicConfig = publicCaptchaConfig(config)
  const serialized = JSON.stringify(publicConfig)
  assert(!serialized.includes("fixture-secret"))
  assert(!serialized.includes("backup-secret"))
  assert(!serialized.includes("127.0.0.1"), "internal URL must stay server-side")
  assert.equal(publicConfig.provider, "cap")
  assert.equal(captchaFallbackProvider(config), "turnstile")
  assert.equal(config.capBlockedFallback, "none")
  assert.equal(config.capNetworkFallback, "none")
  assert.equal(captchaFailureChannel(publicConfig, "cap", "blocked", ["cap"]), null)
  assert.equal(captchaFailureChannel(publicConfig, "cap", "network", ["cap"]), null)
  assert.equal(captchaFailureChannel(publicConfig, "cap", "unavailable", ["cap"])?.provider, "turnstile")
  const policies = normalizeCaptchaConfig({
    ...config, capBlockedFallback: "hcaptcha", capNetworkFallback: "default",
    providers: { ...config.providers, hcaptcha: { siteKey: "special", secretKey: "special-secret" } },
  })
  const advertised = publicCaptchaConfig(policies)
  assert.equal(captchaFailureChannel(advertised, "cap", "blocked", ["cap"])?.provider, "hcaptcha")
  assert.equal(captchaFailureChannel(advertised, "cap", "network", ["cap"])?.provider, "turnstile")
  assert.equal(captchaFailureChannel(advertised, "hcaptcha", "unavailable", ["cap", "hcaptcha"]), null)
  assert(!JSON.stringify(advertised).includes("special-secret"))
  assert.deepEqual(captchaVerificationProviders(policies), ["cap", "turnstile", "hcaptcha"])
  policies.providers.hcaptcha.secretKey = ""
  assert.equal(capFailureProvider(policies, "blocked"), null, "an incomplete explicit target must not use the general backup")
  policies.provider = "turnstile"; policies.fallback = "cap"
  policies.capBlockedFallback = "turnstile"
  assert.equal(captchaFailureChannel(publicCaptchaConfig(policies), "cap", "blocked", ["turnstile", "cap"]), null, "no fallback cycles")
  policies.fallback = "none"
  assert.equal(capFailureProvider(policies, "blocked"), null, "inactive Cap policies authorize no extra providers")
  for (const value of ["cap", "bogus", true, null]) {
    assert.equal(normalizeCaptchaConfig({ capBlockedFallback: value }).capBlockedFallback, "none")
  }
  for (const status of [401, 403, 429, 451]) assert.equal(capResponseFailure(status, null), "blocked")
  assert.equal(capResponseFailure(503, { error: "blocked" }), "unavailable")
  assert.equal(capResponseFailure(200, { error: "country_blocked" }), "blocked")
  assert.equal(capResponseFailure(200, { error: "Access denied" }), "blocked")
  assert.equal(capResponseFailure(200, { error: "Invalid solution" }), null)
  assert.equal(capResponseFailure(200, { success: true, token: "once" }), null)
  const failures: string[] = []
  const transportUrl = `http://127.0.0.1:${address.port}`
  const blocked = await fetchCap(`${transportUrl}/blocked`, undefined, 1000, kind => failures.push(kind))
  assert.equal(blocked.status, 403)
  assert.equal(await blocked.text(), "<h1>Forbidden</h1>")
  assert.deepEqual(failures.splice(0), ["blocked"])
  await fetchCap(`${transportUrl}/hidden-block`, undefined, 1000, kind => failures.push(kind))
  assert.deepEqual(failures.splice(0), ["network"], "200 HTML block pages must not use the outage fallback")
  await assert.rejects(fetchCap(`${transportUrl}/stalled-body`, undefined, 50, kind => failures.push(kind)))
  assert.deepEqual(failures.splice(0), ["network"], "timeout covers body reads")
  const aborted = new AbortController(); aborted.abort()
  await assert.rejects(fetchCap(`${transportUrl}/blocked`, { signal: aborted.signal }, 1000, kind => failures.push(kind)))
  assert.deepEqual(failures, [], "unmount cancellation must not trigger fallback")
  assert.equal(await verifyWithProvider("cap", config.providers.cap, "login", "once"), true)
  assert.equal(await verifyWithProvider("cap", config.providers.cap, "register", "once"), false, "consumed token must fail")
  assert.equal(await verifyWithProvider("cap", config.providers.cap, "login", "malformed"), false)
  assert.equal(await verifyWithProvider("cap", config.providers.cap, "login", "redirect"), false)
  assert.equal(requests.length, 4, "secret-bearing POST must not follow redirects")
  assert(requests.every(r => r.path === "/internal/site%20key/siteverify" && r.type === "application/json"))
  assert.deepEqual(requests[0].body, { secret: "fixture-secret", response: "once" })
  // The advanced options have working defaults, so an operator who never opens
  // the section still gets a solve that leaves a phone responsive and a budget
  // both ends of the request agree on.
  const defaults = normalizeCaptchaConfig(null).providers.cap
  assert.deepEqual(
    [defaults.workerCount, defaults.timeout, defaults.haptics, defaults.troubleshootingUrl],
    ["2", "10", false, ""],
  )
  assert.equal(capTimeoutMs(defaults), 10_000)
  assert.equal(capTimeoutMs({ ...defaults, timeout: "30" }), 30_000)
  const tuned = normalizeCaptchaConfig({
    providers: {
      cap: {
        workerCount: "16", timeout: "0", haptics: "yes",
        troubleshootingUrl: " https://help.example/guide?x=1#top ",
      },
    },
  }).providers.cap
  assert.equal(tuned.workerCount, "2", "a count outside the list falls back")
  assert.equal(tuned.timeout, "10")
  assert.equal(tuned.haptics, false, "only a real boolean turns vibration on")
  assert.equal(tuned.troubleshootingUrl, "https://help.example/guide?x=1#top")
  // The widget renders this one as an href, so the scheme is what has to be
  // pinned down: a query string or an anchor is ordinary on a help page, but
  // credentials in a link the visitor clicks never are.
  assert.equal(validCapLinkUrl("https://help.example/guide?x=1#top"), true)
  for (const url of ["", "javascript:alert(1)", "ftp://host", "https://user:pass@host/help"]) {
    assert.equal(validCapLinkUrl(url), false, url)
  }
  // A dead help link must cost the link and nothing else — never a login gate.
  const badLink = normalizeCaptchaConfig({
    enabled: true, provider: "cap",
    providers: {
      cap: {
        siteKey: "site key", secretKey: "secret", serverUrl: "https://captcha.example",
        troubleshootingUrl: "javascript:alert(1)",
      },
    },
  })
  assert.equal(captchaProviderReady(badLink.providers.cap, "cap"), true)
  assert.equal(publicCaptchaConfig(badLink).troubleshootingUrl, "", "a bad link is dropped, not rendered")
  config.provider = "turnstile"; config.fallback = "cap"
  assert.equal(publicCaptchaConfig(config).fallback?.provider, "cap")
  config.providers.cap.serverUrl = ""
  assert.equal(captchaFallbackProvider(config), null)
  const migrated = normalizeCaptchaConfig({ provider: "recaptcha", providers: { recaptcha: { mode: "v3" } } })
  assert.equal(migrated.provider, "recaptchaV3")
  assert.deepEqual(captchaSiteverifyUrls("recaptcha", "china"), ["https://www.recaptcha.net/recaptcha/api/siteverify"])
  console.log("Cap: URL validation, private config, primary/fallback, JSON verification, single-use rejection, redirect rejection, advanced-option defaults and legacy migration passed.")
} finally {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
