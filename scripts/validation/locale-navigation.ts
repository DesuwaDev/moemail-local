import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { proxy } from "../../proxy"
import { localizedHref } from "../../app/i18n/navigation"

assert.equal(
  localizedHref("/zh-CN/profile", "tab=runtime&safe-appearance=1", "advanced"),
  "/profile?tab=runtime&safe-appearance=1#advanced",
)
assert.equal(localizedHref("/en", "", ""), "/")
assert.equal(localizedHref("/shared/token", "cursor=abc", "message"), "/shared/token?cursor=abc#message")
assert.equal(localizedHref("profile/", "?tab=domains", "#mail"), "/profile?tab=domains#mail")

const cookieRewrite = proxy(new NextRequest("https://mail.example/profile?tab=runtime", {
  headers: { cookie: "NEXT_LOCALE=zh-CN" },
}))
assert.equal(cookieRewrite.status, 200)
assert.equal(cookieRewrite.headers.get("location"), null)
assert.equal(
  new URL(cookieRewrite.headers.get("x-middleware-rewrite") as string).pathname,
  "/zh-CN/profile",
)
assert.equal(cookieRewrite.headers.get("content-language"), "zh-CN")
assert.match(cookieRewrite.headers.get("vary") ?? "", /Cookie/u)
assert.match(cookieRewrite.headers.get("vary") ?? "", /Accept-Language/u)

const headerRewrite = proxy(new NextRequest("https://mail.example/login", {
  headers: { "accept-language": "zh-TW,zh;q=0.9,en;q=0.8" },
}))
assert.equal(
  new URL(headerRewrite.headers.get("x-middleware-rewrite") as string).pathname,
  "/zh-TW/login",
)

const legacyPass = proxy(new NextRequest("https://mail.example/ja/profile?tab=appearance"))
assert.equal(legacyPass.status, 200)
assert.equal(legacyPass.headers.get("x-middleware-next"), "1")
assert.equal(legacyPass.headers.get("location"), null)
assert.match(legacyPass.headers.get("set-cookie") ?? "", /NEXT_LOCALE=ja/u)

const internalRewritePass = proxy(new NextRequest("https://mail.example/ja/profile", {
  headers: { "x-moemail-internal-locale-rewrite": "1" },
}))
assert.equal(internalRewritePass.headers.get("x-middleware-next"), "1")
assert.equal(internalRewritePass.headers.get("location"), null)

const vendorPassThrough = proxy(new NextRequest("https://mail.example/vendor/cap/CAP-LICENSE"))
assert.equal(vendorPassThrough.headers.get("x-middleware-rewrite"), null, "extensionless PWA assets must bypass locale rewriting")

const apiPassThrough = proxy(new NextRequest("https://mail.example/api/internal/health"))
assert.equal(apiPassThrough.headers.get("x-middleware-next"), "1")
assert.equal(apiPassThrough.headers.get("x-middleware-rewrite"), null)

const switcherSource = readFileSync(join(process.cwd(), "app/hooks/use-locale-switcher.ts"), "utf8")
assert.doesNotMatch(switcherSource, /useRouter|router\.(?:push|replace|refresh)\s*\(/u, "locale switching must not wait for navigation")
assert.match(switcherSource, /useInstantLocale/u)

const providerSource = readFileSync(join(process.cwd(), "app/i18n/locale-provider.tsx"), "utf8")
assert.match(providerSource, /NextIntlClientProvider locale=\{locale\} messages=\{catalogs\[locale\]\}/u)
assert.match(providerSource, /window\.history\.replaceState/u)
assert.match(providerSource, /startViewTransition/u)
assert.match(providerSource, /NEXT_LOCALE=/u)

const globalCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8")
assert.match(globalCss, /data-locale-transition="entering"/u)
assert.match(globalCss, /::view-transition-old\(root\)/u)
assert.match(globalCss, /::view-transition-new\(root\)/u)
assert.match(globalCss, /prefers-reduced-motion: reduce/u)

const profileSource = readFileSync(join(process.cwd(), "app/components/profile/profile-card.tsx"), "utf8")
assert.match(profileSource, /searchParams\.get\("tab"\)/u)
assert.match(profileSource, /window\.history\.replaceState/u)
assert.match(profileSource, /visitedTabs/u)
assert.match(profileSource, /forceMount/u)
assert.match(profileSource, /requestIdleCallback/u)
assert.match(profileSource, /data-\[state=inactive\]:hidden/u)

const setupPageSource = readFileSync(join(process.cwd(), "app/[locale]/setup/page.tsx"), "utf8")
assert.match(setupPageSource, /<SetupHeader \/>/u)

const authSource = readFileSync(join(process.cwd(), "app/lib/auth.ts"), "utf8")
const authErrorSource = readFileSync(join(process.cwd(), "app/[locale]/auth-error/page.tsx"), "utf8")
const authErrorContentSource = readFileSync(join(process.cwd(), "app/components/auth/auth-error-content.tsx"), "utf8")
const signButtonSource = readFileSync(join(process.cwd(), "app/components/auth/sign-button.tsx"), "utf8")
const currentOriginSignOutSource = readFileSync(join(process.cwd(), "app/hooks/use-current-origin-sign-out.ts"), "utf8")
const sessionStatusGuardSource = readFileSync(join(process.cwd(), "app/components/auth/session-status-guard.tsx"), "utf8")
const apiErrorClientSource = readFileSync(join(process.cwd(), "app/lib/api-error-client.ts"), "utf8")
const loginFormSource = readFileSync(join(process.cwd(), "app/components/auth/login-form.tsx"), "utf8")
const loginPageSource = readFileSync(join(process.cwd(), "app/[locale]/login/page.tsx"), "utf8")
assert.match(authSource, /signIn:\s*"\/login"/u)
assert.match(authSource, /error:\s*"\/auth-error"/u)
assert.match(authErrorSource, /<AuthErrorContent\s*\/>/u)
assert.match(authErrorContentSource, /useTranslations\("auth\.authError"\)/u)
assert.doesNotMatch(authErrorContentSource, /useLocale\(\)/u)
assert.match(signButtonSource, /useCurrentOriginSignOut\(\)/u)
assert.match(profileSource, /useCurrentOriginSignOut\(\)/u)
assert.match(currentOriginSignOutSource, /signOut\(\{ redirect: false \}\)/u)
assert.match(currentOriginSignOutSource, /new URL\("\/", window\.location\.origin\)/u)
assert.match(currentOriginSignOutSource, /window\.location\.replace\(new URL\("\/", window\.location\.origin\)\.href\)/u)
assert.doesNotMatch(`${signButtonSource}\n${profileSource}`, /callbackUrl/u)
assert.match(authSource, /class UserBannedCredentialsError extends CredentialsSignin/u)
assert.match(authSource, /session\.user\.bannedAt = typeof token\.bannedAt === "string" \? new Date\(token\.bannedAt\) : null/u)
// The ban notice now travels through the shared API catalog together with the
// captcha codes, so the login toast maps whatever code the provider returned.
assert.match(authSource, /class CaptchaRequiredError extends CredentialsSignin/u)
assert.match(authSource, /class CaptchaFailedError extends CredentialsSignin/u)
assert.match(loginFormSource, /tApi\.has\(code as never\)\s*\n\s*\? tApi\(code as never\)/u)
assert.match(sessionStatusGuardSource, /signOut\(\{ redirect: false \}\)/u)
assert.match(sessionStatusGuardSource, /sessionStorage\.removeItem\(BANNED_NOTICE_KEY\)/u)
assert.match(sessionStatusGuardSource, /window\.location\.replace\(new URL\("\/", window\.location\.origin\)\.href\)/u)
assert.match(sessionStatusGuardSource, /duration: 5_000/u)
assert.match(sessionStatusGuardSource, /window\.fetch = guardedFetch/u)
assert.match(apiErrorClientSource, /code === "USER_BANNED"[\s\S]*dispatchEvent/u)
assert.doesNotMatch(loginFormSource, /min-h-\[220px\]/u)
assert.match(loginFormSource, /grid gap-3 min-\[480px\]:grid-cols-2/u)
assert.match(loginFormSource, /usernameField\("min-\[480px\]:col-span-2"\)/u)
// The slot reserves the widget's height so the card cannot jump while the
// vendor script loads. Vertical centring is deliberately absent: the widget
// scales from its top edge when the viewport is narrower than it is.
assert.match(loginFormSource, /className="mt-4 min-h-\[65px\]"/u)
assert.match(loginFormSource, /type="submit"/u)
assert.match(loginFormSource, /activeTab === "login" \? t\("actions\.login"\) : t\("actions\.register"\)/u)
assert.match(loginFormSource, /max-w-lg/u)
assert.match(loginPageSource, /min-h-\[100dvh\]/u)

const userPanelSource = readFileSync(join(process.cwd(), "app/components/profile/promote-panel.tsx"), "utf8")
const userDetailsSource = readFileSync(join(process.cwd(), "app/components/profile/user-details-dialog.tsx"), "utf8")
assert.doesNotMatch(userPanelSource, /<RoleIcon/u)
assert.match(userPanelSource, /sm:grid-cols-\[auto_minmax\(0,1fr\)_auto\]/u)
assert.match(userPanelSource, /className="h-8 w-full min-w-0 text-sm sm:w-auto sm:min-w-28"/u)
assert.match(userDetailsSource, /useLayoutEffect[\s\S]*ResizeObserver/u)
assert.match(userDetailsSource, /\[scrollbar-gutter:stable\][^"\n]*transition-\[height\]/u)
assert.match(userDetailsSource, /querySelector<HTMLElement>\('\[role="tabpanel"\]\[data-state="active"\]'\)/u)
assert.match(userDetailsSource, /if \(contentHeight <= 0\) return/u)
assert.doesNotMatch(userDetailsSource, /activePanelRef/u)
assert.match(userDetailsSource, /grid-cols-2[^"\n]*sm:grid-cols-4/u)
assert.match(userDetailsSource, /p-4 pr-14 sm:p-6 sm:pr-16/u)
assert.match(userDetailsSource, /tabViewportRef\.current\?\.scrollTo\(\{ top: 0 \}\)/u)
assert.doesNotMatch(userDetailsSource, /max-h-72 space-y-2 overflow-y-auto/u)

const accessPanelSource = readFileSync(join(process.cwd(), "app/components/profile/access-policy-panel.tsx"), "utf8")
const sendQuotaSource = readFileSync(join(process.cwd(), "app/components/profile/mail-quota-editor.tsx"), "utf8")
const quotaGuideSource = readFileSync(join(process.cwd(), "app/components/profile/mail-quota-rule-guide.tsx"), "utf8")
const searchableUserSource = readFileSync(join(process.cwd(), "app/components/profile/searchable-user-select.tsx"), "utf8")
const domainPolicySource = readFileSync(join(process.cwd(), "app/components/profile/domain-policy-panel.tsx"), "utf8")
const messageListSource = readFileSync(join(process.cwd(), "app/components/emails/message-list.tsx"), "utf8")
const emailListSource = readFileSync(join(process.cwd(), "app/components/emails/email-list.tsx"), "utf8")
const htmlFrameSource = readFileSync(join(process.cwd(), "app/components/emails/html-message-frame.tsx"), "utf8")
const messageViewSource = readFileSync(join(process.cwd(), "app/components/emails/message-view.tsx"), "utf8")
const sharedMessageSource = readFileSync(join(process.cwd(), "app/components/emails/shared-message-detail.tsx"), "utf8")
const threeColumnSource = readFileSync(join(process.cwd(), "app/components/emails/three-column-layout.tsx"), "utf8")
const appearancePanelSource = readFileSync(join(process.cwd(), "app/components/profile/appearance-panel.tsx"), "utf8")
const mailboxBlockRouteSource = readFileSync(join(process.cwd(), "app/api/access-policies/mailbox-blocks/route.ts"), "utf8")
assert.match(accessPanelSource, /ROLES\.EMPEROR, ROLES\.DUKE, ROLES\.KNIGHT, ROLES\.CIVILIAN/u)
assert.match(accessPanelSource, /<MailQuotaRuleEditor/u)
assert.match(accessPanelSource, /mailQuotaRules/u)
assert.doesNotMatch(accessPanelSource, /<RoleMailQuotaEditor|<UserMailQuotaEditor/u)
assert.match(sendQuotaSource, /subjectSpecificity|subjects\.all/u)
assert.doesNotMatch(sendQuotaSource, /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/u)
assert.match(sendQuotaSource, /admin\.access\.mailQuota/u)
assert.match(sendQuotaSource, /RULES_PER_PAGE = 20/u)
assert.match(sendQuotaSource, /filteredRules\.slice/u)
assert.match(sendQuotaSource, /subjectFilter[\s\S]*targetFilter/u)
assert.match(sendQuotaSource, /useDeferredValue\(query\)/u)
assert.match(sendQuotaSource, /indexedRules/u)
assert.match(sendQuotaSource, /quotaFilter/u)
assert.match(sendQuotaSource, /editingRule[\s\S]*cloneAssignment/u)
assert.match(sendQuotaSource, /manager\.modes\.custom/u)
assert.match(sendQuotaSource, /raw\.trim\(\) === "" \? Number\.NaN/u)
assert.match(sendQuotaSource, /rules\.length >= 2_000/u)
assert.match(sendQuotaSource, /AlertDialogTitle/u)
assert.match(sendQuotaSource, /xl:grid-cols-\[minmax\(14rem,1fr\)_minmax\(9rem,.42fr\)_minmax\(9rem,.42fr\)_minmax\(9rem,.42fr\)\]/u)
assert.match(sendQuotaSource, /grid-cols-\[1\.25rem_minmax\(0,1fr\)\]/u)
assert.match(sendQuotaSource, /\[overflow-wrap:anywhere\]/u)
assert.match(sendQuotaSource, /\[&>span\]:truncate/u)
assert.match(sendQuotaSource, /<MailQuotaRuleGuide/u)
assert.match(sendQuotaSource, /<MailQuotaCompatibility/u)
assert.match(quotaGuideSource, /aria-live="polite"/u)
assert.match(quotaGuideSource, /unlimitedOverride/u)
assert.match(accessPanelSource, /setUsageRevision\(value => value \+ 1\)/u)
assert.match(accessPanelSource, /ALL_MAILBOX_BLOCK_DOMAINS/u)
assert.match(accessPanelSource, /blocks\.allDomains/u)
assert.match(accessPanelSource, /mailboxBlockPageSize = 12/u)
assert.match(accessPanelSource, /useDeferredValue\(blockSearch\)/u)
assert.match(accessPanelSource, /filteredBlocks\.slice/u)
assert.match(accessPanelSource, /blockScopeFilter[\s\S]*blockDomainFilter/u)
assert.match(accessPanelSource, /editBlock[\s\S]*scrollIntoView\(\{ behavior: "smooth"/u)
assert.match(accessPanelSource, /method: updating \? "PUT" : "POST"/u)
assert.match(mailboxBlockRouteSource, /export async function PUT/u)
assert.match(sendQuotaSource, /<SearchableUserSelect/u)
assert.match(searchableUserSource, /setTimeout\(\(\) =>/u)
assert.match(searchableUserSource, /\/api\/roles\/users\?\$\{params\}/u)
assert.match(searchableUserSource, /AbortController/u)
assert.match(domainPolicySource, /current\.inbound\.realtime\.enabled/u)
assert.match(domainPolicySource, /current\.inbound\.realtime\.reconnect/u)
assert.match(domainPolicySource, /connectionTimeoutSeconds/u)
assert.match(domainPolicySource, /idleRenewSeconds/u)
assert.match(domainPolicySource, /reconnectMinSeconds/u)
assert.match(domainPolicySource, /reconnectMaxSeconds/u)
assert.match(domainPolicySource, /imap\.capabilityIdle/u)
assert.match(domainPolicySource, /sm:grid-cols-2/u)
assert.match(domainPolicySource, /<details className="group overflow-hidden rounded border/u)
assert.match(messageListSource, /ml-auto flex min-w-0 flex-1 justify-end gap-1 overflow-x-auto whitespace-nowrap/u)
assert.match(emailListSource, /if \(!response\.ok\)[\s\S]*MAILBOXES_READ_FAILED[\s\S]*Array\.isArray\(data\.emails\)/u)
assert.match(messageListSource, /if \(!response\.ok\)[\s\S]*MESSAGES_READ_FAILED[\s\S]*Array\.isArray\(data\.messages\)/u)
assert.match(messageListSource, /max-w-48 shrink-0 truncate rounded-full/u)
assert.doesNotMatch(messageListSource, /basis-full flex flex-wrap gap-x-3/u)
assert.match(htmlFrameSource, /if \(!frame \|\| frame\.html !== html \|\| frame\.dark !== dark \|\| frame\.images !== inlineImages\)/u)
assert.match(htmlFrameSource, /srcDoc=\{frame\.source\}/u)
assert.doesNotMatch(htmlFrameSource, /srcDoc=\{source\}/u)
assert.match(messageViewSource, /relative min-h-0 flex-1 overflow-auto/u)
assert.match(sharedMessageSource, /relative min-h-0 flex-1 overflow-auto/u)
assert.ok([...threeColumnSource.matchAll(/min-h-0 flex-1 overflow-auto/gu)].length >= 5)
assert.match(appearancePanelSource, /summary className="grid min-h-14[^"]*list-none/u)
assert.match(appearancePanelSource, /\[&::-webkit-details-marker\]:hidden/u)
assert.match(appearancePanelSource, /group-open:rotate-180/u)
assert.match(appearancePanelSource, /<Tabs value=\{advancedSection\}/u)
assert.equal([...appearancePanelSource.matchAll(/<TabsTrigger value=/gu)].length, 3)
assert.match(appearancePanelSource, /xl:grid-cols-\[minmax\(0,1\.35fr\)_minmax\(18rem,.65fr\)\]/u)
assert.doesNotMatch(appearancePanelSource, /summary className="cursor-pointer select-none p-4 sm:p-5"/u)

const mailuPanelSource = readFileSync(join(process.cwd(), "app/components/profile/mailu-integration-panel.tsx"), "utf8")
assert.equal([...mailuPanelSource.matchAll(/<MailuSettingsSection\b/gu)].length, 6)
assert.match(mailuPanelSource, /type SectionId = "api" \| "accounts" \| "imap" \| "smtp" \| "retention" \| "reconcile"/u)
assert.match(mailuPanelSource, /const \[settingsExpanded, setSettingsExpanded\] = useState\(false\)/u)
assert.match(mailuPanelSource, /integration\.enabled && settingsExpanded/u)
assert.match(mailuPanelSource, /aria-expanded=\{settingsExpanded\}/u)
assert.match(mailuPanelSource, /if \(!enabled\) setSettingsExpanded\(false\)/u)
assert.match(mailuPanelSource, /role="group"/u)
assert.match(mailuPanelSource, /aria-pressed=\{activeSection === section\.id\}/u)
assert.match(mailuPanelSource, /grid-cols-2 gap-1 rounded-lg bg-muted\/50 p-1 sm:grid-cols-3 lg:grid-cols-6/u)
assert.match(mailuPanelSource, /role="region"/u)
assert.doesNotMatch(mailuPanelSource, /hidden=\{!open\}|onToggle=/u)
assert.match(mailuPanelSource, /sm:grid-cols-2 xl:grid-cols-4/u)
assert.match(mailuPanelSource, /integration\.imap\.realtime\.enabled/u)
assert.match(mailuPanelSource, /integration\.imap\.realtime\.reconnect/u)
assert.match(mailuPanelSource, /imap\.fallbackPollInterval/u)
assert.match(mailuPanelSource, /integration\.imap\.connectionTimeoutSeconds/u)
assert.match(mailuPanelSource, /integration\.imap\.realtime\.idleRenewSeconds/u)
assert.match(mailuPanelSource, /integration\.imap\.realtime\.reconnectMinSeconds/u)
assert.match(mailuPanelSource, /integration\.imap\.realtime\.reconnectMaxSeconds/u)
assert.match(mailuPanelSource, /sm:grid-cols-2 xl:grid-cols-5/u)
assert.doesNotMatch(mailuPanelSource, /<fieldset/u)

const websiteConfigSource = readFileSync(join(process.cwd(), "app/components/profile/website-config-panel.tsx"), "utf8")
const captchaWidgetSource = readFileSync(join(process.cwd(), "app/components/auth/captcha.tsx"), "utf8")
const captchaRegistrySource = readFileSync(join(process.cwd(), "app/lib/captcha/providers.ts"), "utf8")
const captchaVerifySource = readFileSync(join(process.cwd(), "app/lib/captcha/verify.ts"), "utf8")
const captchaSiteverifySource = readFileSync(join(process.cwd(), "app/lib/captcha/siteverify.ts"), "utf8")
const capAdapterSource = readFileSync(join(process.cwd(), "app/components/auth/cap-adapter.ts"), "utf8")
const configRouteSource = readFileSync(join(process.cwd(), "app/api/config/route.ts"), "utf8")
const globalsCssSource = readFileSync(join(process.cwd(), "app/globals.css"), "utf8")
const homeContentSource = readFileSync(join(process.cwd(), "app/components/home/home-content.tsx"), "utf8")
// Google mints a site key as either v2 or v3 and refuses the other generation
// with "Invalid key type", so the two are separate channels with their own key
// pairs instead of one channel with a mode switch.
assert.match(captchaRegistrySource, /"turnstile", "recaptcha", "recaptchaV3", "hcaptcha"/u)
assert.match(captchaRegistrySource, /scoreBased: boolean/u)
assert.doesNotMatch(captchaRegistrySource, /RECAPTCHA_MODES/u)
assert.doesNotMatch(captchaRegistrySource, /mode: normalizeOption/u)
// Pre-split rows carry their v3 keys over to the new channel rather than
// leaving them in the v2 slot, where they would fail on the next render.
assert.match(captchaRegistrySource, /function migrateRecaptchaGenerations/u)
assert.match(captchaRegistrySource, /recaptcha: undefined, recaptchaV3: providers\.recaptcha/u)
assert.match(captchaSiteverifySource, /if \(descriptor\.scoreBased\) \{/u)
assert.match(captchaRegistrySource, /channel\.provider === "recaptchaV3"/u)
assert.match(captchaWidgetSource, /const invisible = CAPTCHA_PROVIDERS\[provider\]\.scoreBased/u)
// google.com is unreachable from mainland China, so both the browser and the
// server pick between it and the mirror Google publishes instead of one region
// being pinned for everyone.
assert.match(captchaRegistrySource, /"auto", \.\.\.CAPTCHA_REGIONS/u)
assert.match(captchaRegistrySource, /china: "https:\/\/www\.recaptcha\.net"/u)
assert.match(captchaRegistrySource, /function candidateOrigins/u)
assert.match(captchaSiteverifySource, /lastAnsweringUrl\.set\(provider, url\)/u)
assert.match(captchaWidgetSource, /mode: "no-cors"/u)
assert.match(captchaWidgetSource, /originProbes\.clear\(\)/u)
assert.match(websiteConfigSource, /optionFields\.includes\("endpoint"\)/u)
// The panel drives the live runtime through the shared registry, so provider,
// option and scope lists must stay derived rather than hand-maintained here.
assert.match(websiteConfigSource, /from "@\/lib\/captcha\/providers"/u)
assert.match(websiteConfigSource, /CAPTCHA_PROVIDER_IDS\.map\(id => \{/u)
assert.match(websiteConfigSource, /captchaOptionFields\(id\)/u)
// The Cloud console issues an Enterprise credential by default, so the
// reCAPTCHA channels explain which secret belongs in the field.
assert.match(websiteConfigSource, /t\.has\(`captcha\.providers\.\$\{id\}\.keyHint`/u)
assert.match(websiteConfigSource, /CAPTCHA_SCOPES\.map\(scope => \(/u)
assert.match(websiteConfigSource, /<SelectContent className="max-h-\[var\(--radix-select-content-available-height\)\]">/u)
assert.match(websiteConfigSource, /aria-labelledby="captcha-provider-label captcha-provider-value"/u)
assert.match(websiteConfigSource, /aria-labelledby=\{`captcha-\$\{role\}-heading`\}/u)
assert.match(websiteConfigSource, /<div className="grid gap-3 sm:grid-cols-2">/u)
assert.match(websiteConfigSource, /<Label htmlFor="website-default-role"/u)
assert.match(websiteConfigSource, /<SelectTrigger id="website-default-role">/u)
assert.match(websiteConfigSource, /<Label htmlFor="website-admin-contact"/u)
// An odd option count stretches the trailing cell instead of leaving a hole,
// and the compact selects pair up well before `sm` so a phone does not get one
// long column of boxes.
assert.match(websiteConfigSource, /min-\[380px\]:\[&>\*:nth-child\(odd\):last-child\]:col-span-2/u)
assert.match(websiteConfigSource, /<div className="grid gap-2 min-\[380px\]:grid-cols-2">/u)
// Paired selects get narrow, so their value clips rather than shoving the
// chevron out of the control.
assert.match(websiteConfigSource, /const COMPACT_TRIGGER = "gap-2 \[&>span\]:min-w-0 \[&>span\]:truncate"/u)
// One control carries both the state and the channel: "off" is an option of the
// picker, so the trigger always spells out what is live. A separate switch
// would leave the dropdown looking like an unapplied draft.
assert.match(websiteConfigSource, /value=\{enabled \? provider : CAPTCHA_OFF\}/u)
assert.match(websiteConfigSource, /<SelectItem\s+value=\{CAPTCHA_OFF\}/u)
assert.doesNotMatch(websiteConfigSource, /id="captcha-enabled"/u)
// Keys, options and scopes only exist while a channel is live.
assert.match(websiteConfigSource, /\{enabled && \(/u)
assert.match(websiteConfigSource, /\{!enabled && \(/u)
// The picker alone shows a draft; the panel also has to say whether that draft
// is what the site is running on, and name the channel still in force when it
// is not.
assert.match(websiteConfigSource, /const \[liveCaptcha, setLiveCaptcha\] = useState/u)
assert.match(websiteConfigSource, /JSON\.stringify\(captcha\) !== JSON\.stringify\(liveCaptcha\)/u)
assert.match(websiteConfigSource, /setLiveCaptcha\(stored\)/u)
assert.match(websiteConfigSource, /setLiveCaptcha\(submitted\)/u)
assert.match(websiteConfigSource, /captcha\.status\.activeNow", \{ channel: liveChannelLabel \}/u)
assert.match(websiteConfigSource, /motion-reduce:animate-none/u)
// A failed load must not let the panel save its empty defaults over storage.
assert.match(websiteConfigSource, /disabled=\{loading \|\| !loaded\}/u)
assert.doesNotMatch(websiteConfigSource, /overflow-x-auto/u)
assert.doesNotMatch(websiteConfigSource, /aria-pressed=/u)
assert.doesNotMatch(websiteConfigSource, /connectedToRuntime|previewNotice|previewValues|uiOnly/u)

// Vendor widgets ship fixed pixel widths (~300px) that overflow a 320px
// viewport, so the mount is measured and scaled inside a clipped wrapper
// rather than wrapping, stretching the card, or scrolling the page sideways.
assert.match(captchaWidgetSource, /new ResizeObserver\(measure\)/u)
assert.match(captchaWidgetSource, /flex w-full items-start justify-center overflow-hidden/u)
assert.match(captchaWidgetSource, /className="shrink-0 origin-top"/u)
assert.match(captchaWidgetSource, /transform: `scale\(\$\{scale\}\)`/u)
assert.match(captchaWidgetSource, /height: Math\.ceil\(naturalHeight \* scale\)/u)
// Vendors refuse to re-render into a container they already used.
assert.match(captchaWidgetSource, /frame\.replaceChildren\(host\)/u)
// The v3 badge is hidden because it lands on top of the floating corner button,
// so the attribution Google requires has to ship with the form instead. The
// rule has to stay unlayered — anchored at column 0 here — because Tailwind
// strips a custom utility whose class it cannot find in the scanned source, and
// this one only ever exists in the DOM Google injects.
assert.match(captchaWidgetSource, /https:\/\/policies\.google\.com\/privacy/u)
assert.match(captchaWidgetSource, /https:\/\/policies\.google\.com\/terms/u)
assert.match(
  globalsCssSource,
  /^\.grecaptcha-badge \{\s+visibility: hidden !important;/mu,
)
// Same trap, other direction: an opacity modifier on a custom utility makes the
// class name unrecognizable to Tailwind, so the home page backdrop has to carry
// its alpha inside the gradient and be referenced by its bare class name.
assert.match(globalsCssSource, /linear-gradient\(hsl\(var\(--primary\) \/ 0\.05\) 1px/u)
assert.match(homeContentSource, /-z-10 bg-grid-primary"/u)
assert.doesNotMatch(homeContentSource, /bg-grid-primary\//u)
assert.match(loginFormSource, /<Captcha\s+ref=\{captchaRef\}/u)
assert.match(loginFormSource, /const captcha = await collectCaptchaSolution\(\)/u)
assert.doesNotMatch(loginFormSource, /turnstile/iu)

// A vendor bundle that never arrives leaves the form unsubmittable, and a retry
// against the same origin cannot fix it, so the operator can name a second
// channel the page switches to on its own.
assert.match(captchaRegistrySource, /const CAPTCHA_FALLBACK_OFF = "none"/u)
// A channel standing in for itself would repeat the load that just failed, and
// an unusable backup would turn a load failure into a rejection.
assert.match(captchaRegistrySource, /fallback === provider \? CAPTCHA_FALLBACK_OFF : fallback/u)
assert.match(captchaRegistrySource, /export function captchaFallbackProvider/u)
assert.match(captchaRegistrySource, /captchaProviderReady\(config\.providers\[config\.fallback\], config\.fallback\)/u)
// Failure routing and cycle prevention are exercised in captcha-cap.ts.
assert.match(captchaWidgetSource, /setBackup\(null\)/u)
assert.match(captchaWidgetSource, /t\("fallbackNotice"\)/u)
// Both channels are operator-configured, so the browser's claim about which one
// minted the token only orders the attempts; it can never widen what is
// accepted.
assert.match(captchaWidgetSource, /token: tokenRef\.current, provider/u)
assert.match(captchaVerifySource, /const minted = mintedBy \?\? channels\[0\]/u)
assert.match(captchaVerifySource, /const channel = channels\.find\(id => id === minted\)/u)
// An unusable primary must not take its backup down with it: the login page is
// handed both and switches on its own, so with a self-hosted primary that fails
// closed the backup's token is the only one that can arrive.
assert.match(captchaVerifySource, /captchaVerificationProviders\(config\)/u)
assert.match(captchaVerifySource, /if \(!primaryReady && config\.provider !== "cap"\)/u)
assert.match(websiteConfigSource, /CAPTCHA_PROVIDER_IDS\.filter\(id => id !== provider\)/u)
assert.match(websiteConfigSource, /captchaProviderReady\(settings\)/u)

// Two channel forms stacked open run for a screenful on a phone — Cap alone adds
// two URL fields — so each channel folds into a summary row that still answers
// which provider is on duty and whether it can verify anything yet.
assert.match(websiteConfigSource, /function incompleteChannel\(config: CaptchaConfig\)/u)
assert.match(websiteConfigSource, /setOpenChannel\(incompleteChannel\(stored\)\)/u)
assert.match(websiteConfigSource, /renderChannelRow\("primary"\)/u)
assert.match(websiteConfigSource, /renderChannelRow\("fallback"\)/u)
assert.match(websiteConfigSource, /aria-expanded=\{open\}/u)
assert.match(websiteConfigSource, /aria-controls=\{`captcha-\$\{role\}-panel`\}/u)
assert.match(websiteConfigSource, /captcha\.channelStatus\.ready" : "captcha\.channelStatus\.incomplete"/u)
// Folding is driven by explicit actions only, so a form cannot collapse under
// the operator's hands the moment the last key makes it valid.
assert.match(websiteConfigSource, /setOpenChannel\(open \? null : role\)/u)
assert.match(websiteConfigSource, /setOpenChannel\(value === CAPTCHA_OFF \? null : "primary"\)/u)

// Cap runs on the operator's own hardware, so its pace, patience and help link
// are theirs to set — but every one of them has a working default, so they hide
// behind a single row instead of adding four controls to the longest form on
// the page. The hosted vendors declare no advanced options, so the row itself
// never renders for them.
assert.match(captchaRegistrySource, /advancedFields: \["workerCount", "timeout", "haptics", "troubleshootingUrl"\]/u)
assert.match(captchaRegistrySource, /export function captchaAdvancedFields/u)
assert.match(websiteConfigSource, /const advancedFields = captchaAdvancedFields\(id\)/u)
assert.match(websiteConfigSource, /advancedFields\.length > 0 && \(/u)
assert.match(websiteConfigSource, /setAdvancedChannel\(advancedOpen \? null : id\)/u)
assert.match(websiteConfigSource, /useState<CaptchaProviderId \| null>\(null\)/u)
// Folded away, it still has to admit when it is no longer showing the defaults.
assert.match(websiteConfigSource, /settings\[field\] !== DEFAULT_SETTINGS\[id\]\[field\]/u)
assert.match(websiteConfigSource, /captcha\.advancedCustomized/u)
// Absent, the widget claims every core the browser reports, which finishes
// fastest on a desktop and heats a phone.
assert.match(capAdapterSource, /channel\.workerCount !== "auto"/u)
assert.match(capAdapterSource, /data-cap-worker-count/u)
assert.match(capAdapterSource, /!channel\.haptics.+data-cap-disable-haptics/u)
// Both ends wait on the same self-hosted server, so they read one budget.
assert.match(captchaRegistrySource, /export function capTimeoutMs/u)
assert.match(capAdapterSource, /timeout: Number\(channel\.timeout\) \* 1000/u)
assert.match(captchaSiteverifySource, /provider === "cap" \? capTimeoutMs\(settings\) : VERIFY_TIMEOUT_MS/u)
// A mistyped help link is refused where it can still be corrected, and dropped
// rather than rendered if it ever reaches the widget — but it never decides
// whether the channel itself is usable, because a dead link must not lock a
// login form.
assert.match(configRouteSource, /apiError\("CAPTCHA_LINK_URL_INVALID", 400\)/u)
assert.match(captchaRegistrySource, /validCapLinkUrl\(settings\.troubleshootingUrl\) \? settings\.troubleshootingUrl : ""/u)
assert.match(capAdapterSource, /if \(validCapLinkUrl\(channel\.troubleshootingUrl\)\)/u)
assert.doesNotMatch(
  captchaRegistrySource.slice(
    captchaRegistrySource.indexOf("export function captchaProviderReady"),
    captchaRegistrySource.indexOf("export function captchaOptionFields"),
  ),
  /troubleshootingUrl/u,
)

console.log(JSON.stringify({
  localePrefixHidden: true,
  legacyLocaleLinksCanonicalized: true,
  localeNavigationPreservesPath: true,
  queryAndHashPreserved: true,
  profileTabPreserved: true,
  networkNavigationRemoved: true,
  deterministicMotion: true,
  visitedProfileTabsPreserved: true,
  setupControlsPresent: true,
  authFallbackPagesLocalized: true,
  bannedSessionsSignOutWithTransientNotice: true,
  signOutPreservesCurrentBrowserOrigin: true,
  authCardStableAndResponsive: true,
  duplicateRoleIconRemoved: true,
  userRoleEditorResponsive: true,
  adaptiveUserDetailsDialog: true,
  accessPolicyLayoutCovered: true,
  allDomainMailboxBlocksLocalized: true,
  scalableMailboxBlockEditor: true,
  bidirectionalMailQuotaUiLocalized: true,
  liveQuotaCompatibilityGuidance: true,
  quotaUsageRefreshAfterSave: true,
  quotaUserSearchLiveAndAbortable: true,
  compactMailuSettingsResponsive: true,
  inlineMailboxQuotaResponsive: true,
  mailuRealtimeControlsLocalized: true,
  genericImapRealtimeControlsLocalized: true,
  imapAdvancedSettingsResponsive: true,
  htmlMessageFrameMountAndSizingGuarded: true,
  compactAdvancedAppearanceResponsive: true,
  scalableCaptchaProviderPicker: true,
  captchaRuntimeWiredForEveryProvider: true,
  captchaWidgetFitsNarrowViewports: true,
  captchaChannelStateReadableFromOneControl: true,
  captchaLiveStateDistinguishedFromDraft: true,
  captchaPanelCompactOnPhones: true,
  recaptchaGenerationsHoldSeparateKeys: true,
  recaptchaReachesFilteredNetworksThroughMirror: true,
  vendorBadgeHiddenWithAttributionShipped: true,
  customUtilitiesSurviveThePurge: true,
  captchaFallsBackToASecondChannel: true,
  captchaChannelsFoldIntoSummaryRows: true,
  unusableSelfHostedPrimaryKeepsItsBackup: true,
  capAdvancedOptionsFoldAway: true,
}))
