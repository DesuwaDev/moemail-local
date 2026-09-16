import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import {
  capEndpoint, captchaFallbackProvider, captchaSiteverifyUrls,
  normalizeCaptchaConfig, publicCaptchaConfig, validCapServerUrl,
} from "../../app/lib/captcha/providers"
import { verifyWithProvider } from "../../app/lib/captcha/siteverify"

const requests: { path: string; type?: string; body: Record<string, string> }[] = []
let consumed = false
const server = createServer(async (req, res) => {
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
  assert.equal(await verifyWithProvider("cap", config.providers.cap, "login", "once"), true)
  assert.equal(await verifyWithProvider("cap", config.providers.cap, "register", "once"), false, "consumed token must fail")
  assert.equal(await verifyWithProvider("cap", config.providers.cap, "login", "malformed"), false)
  assert.equal(await verifyWithProvider("cap", config.providers.cap, "login", "redirect"), false)
  assert.equal(requests.length, 4, "secret-bearing POST must not follow redirects")
  assert(requests.every(r => r.path === "/internal/site%20key/siteverify" && r.type === "application/json"))
  assert.deepEqual(requests[0].body, { secret: "fixture-secret", response: "once" })
  config.provider = "turnstile"; config.fallback = "cap"
  assert.equal(publicCaptchaConfig(config).fallback?.provider, "cap")
  config.providers.cap.serverUrl = ""
  assert.equal(captchaFallbackProvider(config), null)
  const migrated = normalizeCaptchaConfig({ provider: "recaptcha", providers: { recaptcha: { mode: "v3" } } })
  assert.equal(migrated.provider, "recaptchaV3")
  assert.deepEqual(captchaSiteverifyUrls("recaptcha", "china"), ["https://www.recaptcha.net/recaptcha/api/siteverify"])
  console.log("Cap: URL validation, private config, primary/fallback, JSON verification, single-use rejection, redirect rejection and legacy migration passed.")
} finally {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
