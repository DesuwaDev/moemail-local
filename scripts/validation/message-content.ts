import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, unwatchFile, readFileSync, writeFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"
import http from "node:http"
import { syncBuiltinESMExports } from "node:module"
import { eq } from "drizzle-orm"
import { htmlToPlainText, emailText } from "../../app/lib/email-content"
import { webhookMessage, webhookResponseFailed } from "../../app/lib/webhook-options"

const root = process.cwd()
const scratch = resolve(root, 'node_modules/.cache/message-content-validation')
mkdirSync(scratch, { recursive: true })
const temporaryRoot = mkdtempSync(join(scratch, 'run-'))
const postgresUrl = process.argv.find(value => value.startsWith('--postgres-url='))?.slice('--postgres-url='.length)
const load = (file: string) => import(pathToFileURL(resolve(root, file)).href)
let closeDatabase: (() => Promise<void>) | undefined
const originalRequest = http.request
const requests: Array<Record<string, unknown>> = []
let status = 200
let responseBody = '{}'
const server = http.createServer((request, response) => {
  const chunks: Buffer[] = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', () => {
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    response.writeHead(status, { 'Content-Type': 'application/json' }).end(responseBody)
  })
})

try {
  assert.equal(htmlToPlainText('<head><style>secret</style></head><p>Code: <b>123456</b> &amp; &#x4E2D;</p><script>bad()</script><p>Next<br>line</p>'), 'Code: 123456 & 中\n\nNext\nline')
  assert.equal(emailText('original\ntext', '<p>HTML</p>'), 'original\ntext')
  const payload = { subject: '测试'.repeat(200), content: '', html: '<p>' + '中文😀'.repeat(1000) + '</p>' }
  const summary = webhookMessage(payload, { notificationMode: 'text', maxContentBytes: 256 })
  assert.equal(summary.html, '')
  assert.ok(Buffer.byteLength(summary.content) <= 256)
  assert.ok(Buffer.byteLength(summary.subject) <= 256)
  assert.ok(!summary.content.includes('\uFFFD'))
  assert.equal(webhookMessage(payload), payload)
  assert.equal(webhookResponseFailed('{"ok":false}'), true)
  assert.equal(webhookResponseFailed('{"success":false}'), true)
  assert.equal(webhookResponseFailed('{"errcode":400}'), true)
  assert.equal(webhookResponseFailed('{"success":true}'), false)

  cpSync(resolve(root, 'drizzle-local'), join(temporaryRoot, 'drizzle-local'), { recursive: true })
  cpSync(resolve(root, 'drizzle-postgres'), join(temporaryRoot, 'drizzle-postgres'), { recursive: true })
  // Start from the previous release schema to verify the additive upgrade.
  for (const folder of ['drizzle-local', 'drizzle-postgres']) {
    const journalPath = join(temporaryRoot, folder, 'meta/_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 5)
    writeFileSync(journalPath, JSON.stringify(journal))
  }
  process.chdir(temporaryRoot)
  const setup = await load('app/lib/setup-service.ts')
  const outcome = await setup.completeSetup({
    config: { server: { baseUrl: 'http://127.0.0.1:3000' }, database: postgresUrl
      ? { driver: 'postgres', postgres: { url: postgresUrl } }
      : { driver: 'sqlite', sqlite: { path: 'data/audit.db' } } },
    admin: { username: 'content-owner', password: 'content-owner-validation-123456' },
  })
  assert.equal(outcome.ok, true)
  if (postgresUrl) (globalThis as typeof globalThis & { __moemailBoundDriver?: string }).__moemailBoundDriver = 'postgres'
  const database = await load('app/lib/db.ts')
  closeDatabase = database.closeDatabase
  const schema = await load('app/lib/schema.ts')
  const db = database.createDb()
  const [owner] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, 'content-owner'))
  const legacyHookId = crypto.randomUUID()
  if (postgresUrl) {
    await database.getPostgresPool().query('INSERT INTO webhook (id, user_id, url, enabled, created_at, updated_at) VALUES ($1, $2, $3, false, $4, $4)', [legacyHookId, owner.id, 'http://8.8.8.8/', new Date()])
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    await migrate(db, { migrationsFolder: resolve(root, 'drizzle-postgres') })
  } else {
    database.getSqlite().prepare('INSERT INTO webhook (id, user_id, url, enabled, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').run(legacyHookId, owner.id, 'http://8.8.8.8/', Date.now(), Date.now())
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
    migrate(db, { migrationsFolder: resolve(root, 'drizzle-local') })
  }
  const [legacyHook] = await db.select().from(schema.webhooks)
  assert.equal(legacyHook.id, legacyHookId)
  assert.equal(legacyHook.notificationMode, 'full')
  assert.equal(legacyHook.maxContentBytes, 2048)
  assert.equal(legacyHook.lastDeliveryAt, null)
  const domains = await load('app/lib/domain-policies.ts')
  await domains.saveDomainPolicies([{ domain: 'content.test', inbound: { mode: 'imap', host: '127.0.0.1', port: 143, security: 'plain', username: 'fixture', password: 'fixture-password', rejectUnauthorized: true, mailbox: 'INBOX', recipientHeader: 'auto', initialSync: 'new', pollIntervalSeconds: 60, maxMessagesPerPoll: 20 }, outbound: { mode: 'disabled' } }])
  const [mailbox] = await db.insert(schema.emails).values({ userId: owner.id, address: 'box@content.test', expiresAt: new Date(Date.now() + 3600000) }).returning()
  const { digestApiKey } = await load('app/lib/api-key-digest.ts')
  await db.insert(schema.apiKeys).values({ userId: owner.id, name: 'content-test', key: digestApiKey('content-test-key'), expiresAt: new Date(Date.now() + 3600000) })
  const ingest = await load('app/lib/email-ingestion.ts')
  const raw = Buffer.from(['From: sender@example.com', 'To: box@content.test', 'Subject: CID and attachments', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="audit"', '', '--audit', 'Content-Type: text/html; charset=utf-8', '', '<p>Code: <b>123456</b></p><img src="cid:pixel%40test">', '--audit', 'Content-Type: image/png', 'Content-ID: <pixel@test>', 'Content-Disposition: inline; filename="pixel.png"', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=', '--audit', 'Content-Type: application/pdf', 'Content-Disposition: attachment; filename="test.pdf"', 'Content-Transfer-Encoding: base64', '', Buffer.from('%PDF-1.4\naudit bytes').toString('base64'), '--audit--', ''].join('\r\n'))
  const input = { raw, envelopeFrom: 'sender@example.com', envelopeTo: mailbox.address, transport: 'imap' }
  const result = await ingest.ingestEmail(input)
  assert.equal(result.status, 'created')
  assert.equal((await ingest.ingestEmail(input)).status, 'duplicate')
  const stored = await db.select().from(schema.messageAttachments)
  assert.equal(stored.length, 2)
  const route = await load('app/api/emails/[id]/[messageId]/route.ts')
  const url = `http://127.0.0.1:3000/api/emails/${mailbox.id}/${result.messageId}`
  const context = { params: Promise.resolve({ id: mailbox.id, messageId: result.messageId }) }
  const request = (path: string, key = 'content-test-key') => new Request(path, { headers: { 'X-API-Key': key } })
  const detail = await route.GET(request(url), context)
  assert.equal(detail.status, 200)
  const body = await detail.json()
  assert.match(body.message.content, /Code: 123456/)
  assert.equal(body.message.attachments.length, 2)
  assert.equal(body.message.inline_images.length, 1)
  assert.equal(body.message.inline_images[0].contentId, 'pixel@test')
  const pdf = body.message.attachments.find((attachment: { filename: string }) => attachment.filename === 'test.pdf')
  const downloadUrl = 'http://127.0.0.1:3000' + pdf.download_url
  const download = await route.GET(request(downloadUrl), context)
  assert.equal(await download.text(), '%PDF-1.4\naudit bytes')
  assert.equal(download.headers.get('content-type'), 'application/octet-stream')
  assert.match(download.headers.get('content-disposition')!, /^attachment;/)
  assert.equal((await route.GET(request(downloadUrl, 'invalid'), context)).status, 401)
  const [otherUser] = await db.insert(schema.users).values({ username: 'content-other' }).returning()
  const [role] = await db.select().from(schema.roles).limit(1)
  await db.insert(schema.userRoles).values({ userId: otherUser.id, roleId: role.id })
  await db.insert(schema.apiKeys).values({ userId: otherUser.id, name: 'other-test', key: digestApiKey('other-test-key'), expiresAt: new Date(Date.now() + 3600000) })
  assert.equal((await route.GET(request(downloadUrl, 'other-test-key'), context)).status, 403)

  const token = 'content-public-share'
  await db.insert(schema.messageShares).values({ messageId: result.messageId, token })
  const publicRoute = await load('app/api/shared/message/[token]/route.ts')
  const publicUrl = `http://127.0.0.1:3000/api/shared/message/${token}?attachment=${pdf.id}`
  const publicContext = { params: Promise.resolve({ token }) }
  assert.equal(await (await publicRoute.GET(new Request(publicUrl), publicContext)).text(), '%PDF-1.4\naudit bytes')
  const sharedData = await load('app/lib/shared-data.ts')
  assert.equal((await sharedData.getSharedMessage(token)).inline_images.length, 1)
  const mailboxToken = 'content-mailbox-share'
  await db.insert(schema.emailShares).values({ emailId: mailbox.id, token: mailboxToken })
  const mailboxRoute = await load('app/api/shared/[token]/messages/[messageId]/route.ts')
  const sharedContext = { params: Promise.resolve({ token: mailboxToken, messageId: result.messageId }) }
  const sharedUrl = `http://127.0.0.1:3000/api/shared/${mailboxToken}/messages/${result.messageId}`
  assert.equal((await (await mailboxRoute.GET(new Request(sharedUrl), sharedContext)).json()).message.attachments.length, 2)
  await db.update(schema.messageShares).set({ expiresAt: new Date(0) }).where(eq(schema.messageShares.token, token))
  assert.equal((await publicRoute.GET(new Request(publicUrl), publicContext)).status, 410)
  await db.update(schema.emailShares).set({ expiresAt: new Date(0) }).where(eq(schema.emailShares.token, mailboxToken))
  assert.equal((await mailboxRoute.GET(new Request(sharedUrl + '?attachment=' + pdf.id), sharedContext)).status, 410)

  // Test network responses locally without weakening the production SSRF guard.
  await new Promise<void>(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  http.request = ((url: URL, options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
    assert.equal(url.hostname, '8.8.8.8')
    return originalRequest(new URL(`http://127.0.0.1:${address.port}/`), options, callback)
  }) as typeof http.request
  syncBuiltinESMExports()
  const webhook = await load('app/lib/webhook.ts')
  const hookPayload = { event: 'new_message', data: { ...payload, emailId: mailbox.id, messageId: result.messageId, fromAddress: 'sender@example.com', toAddress: mailbox.address, receivedAt: new Date().toISOString() } }
  await webhook.callWebhook('http://8.8.8.8/', hookPayload, { notificationMode: 'text', maxContentBytes: 256 })
  assert.equal(requests.at(-1)?.html, '')
  assert.ok(Buffer.byteLength(String(requests.at(-1)?.content)) <= 256)
  responseBody = '{"success":false}'
  let count = requests.length
  await assert.rejects(webhook.callWebhook('http://8.8.8.8/', hookPayload), /WEBHOOK_REMOTE_REJECTED/)
  assert.equal(requests.length - count, 1)
  status = 413; responseBody = '{}'; count = requests.length
  await assert.rejects(webhook.callWebhook('http://8.8.8.8/', hookPayload), /WEBHOOK_HTTP_STATUS:413/)
  assert.equal(requests.length - count, 1)
  status = 503; count = requests.length
  await assert.rejects(webhook.callWebhook('http://8.8.8.8/', hookPayload), /WEBHOOK_HTTP_STATUS:503/)
  assert.equal(requests.length - count, 3)
  await db.update(schema.webhooks).set({ enabled: true, notificationMode: 'text', maxContentBytes: 256 }).where(eq(schema.webhooks.id, legacyHookId))
  status = 200; responseBody = '{"ok":false}'
  await ingest.ingestEmail({ ...input, raw: Buffer.from(raw.toString().replace('Subject: CID', 'Subject: rejected CID')) })
  const [failedHook] = await db.select().from(schema.webhooks)
  assert.equal(failedHook.lastDeliveryError, 'WEBHOOK_REMOTE_REJECTED')
  assert.ok(failedHook.lastDeliveryAt)
  responseBody = '{"ok":true}'
  await ingest.ingestEmail({ ...input, raw: Buffer.from(raw.toString().replace('Subject: CID', 'Subject: accepted CID')) })
  assert.equal((await db.select().from(schema.webhooks))[0].lastDeliveryError, null)
  await db.delete(schema.emails).where(eq(schema.emails.id, mailbox.id))
  assert.equal((await db.select().from(schema.messageAttachments)).length, 0)
  console.log(JSON.stringify({ ok: true, driver: postgresUrl ? 'postgres' : 'sqlite', checks: ['legacy-schema-upgrade', 'html-fallback', 'utf8-summary', 'atomic-attachments', 'deduplication', 'binary-download', 'owner-permission', 'public-shares', 'expired-shares', 'cid-data', 'webhook-ack', 'retry-policy', 'delivery-status', 'cascade-cleanup'] }))
} finally {
  http.request = originalRequest
  syncBuiltinESMExports()
  server.closeAllConnections()
  if (server.listening) await new Promise<void>(resolvePromise => server.close(() => resolvePromise()))
  await closeDatabase?.()
  unwatchFile(join(temporaryRoot, 'data/config.yaml'))
  process.chdir(root)
}
