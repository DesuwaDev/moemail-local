export type RuntimeFieldKind = "text" | "number" | "boolean" | "secret" | "textarea" | "select"

export interface RuntimeFieldMetadata {
  kind?: RuntimeFieldKind
  options?: Array<{ value: string; label: string }>
  required?: boolean
  secretAction?: "generate"
}

export interface RuntimeSectionLayout {
  /** `general` sections render without a heading. */
  key: string
  fields: readonly string[]
  /** Only used by this database driver; marked when another driver is active. */
  driver?: "sqlite" | "postgres"
  /** Rendered by a dedicated control instead of one field per path. */
  composite?: "clientIp"
}

export interface RuntimeGroupLayout {
  key: string
  sections: readonly RuntimeSectionLayout[]
}

/**
 * The visual editor groups settings by task rather than by YAML nesting, so
 * related options (for example backups) sit together. Every configurable path
 * appears exactly once here or in runtimeReadOnlyFields; validation enforces it.
 */
export const runtimeLayout: readonly RuntimeGroupLayout[] = [
  { key: "site", sections: [
    { key: "general", fields: ["server.baseUrl", "server.emailPollIntervalMs"] },
    { key: "clientIp", composite: "clientIp", fields: ["server.trustProxyHeaders", "server.clientIpHeader", "server.clientIpTrustedHops"] },
  ] },
  { key: "signIn", sections: [
    { key: "passkeys", fields: ["auth.passkeys.enabled"] },
    { key: "github", fields: ["auth.github.clientId", "auth.github.clientSecret"] },
    { key: "google", fields: ["auth.google.clientId", "auth.google.clientSecret"] },
  ] },
  { key: "security", sections: [
    { key: "keys", fields: ["auth.secret", "auth.passwordPepper"] },
    { key: "serviceKeys", fields: ["auth.emperorBootstrapSecret", "email.ingestSecret"] },
    { key: "rateLimit", fields: [
      "auth.rateLimit.windowSeconds", "auth.rateLimit.maxClients",
      "auth.rateLimit.loginPerClient", "auth.rateLimit.loginGlobal",
      "auth.rateLimit.registerPerClient", "auth.rateLimit.registerGlobal",
      "auth.rateLimit.scryptMaxConcurrency",
    ] },
  ] },
  { key: "database", sections: [
    { key: "general", fields: ["database.driver", "server.autoRestartOnDriverChange"] },
    { key: "sqlite", driver: "sqlite", fields: ["database.sqlite.path"] },
    { key: "postgres", driver: "postgres", fields: [
      "database.postgres.url", "database.postgres.applicationName",
      "database.postgres.poolMax", "database.postgres.idleTimeoutMs", "database.postgres.connectTimeoutMs",
      "database.postgres.ssl", "database.postgres.sslRejectUnauthorized",
    ] },
  ] },
  { key: "backup", sections: [
    { key: "schedule", fields: ["scheduler.backupIntervalSeconds", "scheduler.backupOnStart"] },
    { key: "sqlite", driver: "sqlite", fields: ["database.sqlite.backupDir", "database.sqlite.backupRetentionDays"] },
    { key: "postgres", driver: "postgres", fields: ["database.postgres.backupDir", "database.postgres.backupRetentionDays"] },
    { key: "offsite", fields: ["offsite.remote", "offsite.intervalSeconds", "offsite.rcloneBin", "offsite.rcloneConfigContent"] },
  ] },
  { key: "cleanup", sections: [
    { key: "general", fields: [
      "scheduler.cleanupIntervalSeconds", "cleanup.permanentMessageRetentionDays",
      "cleanup.batchSize", "cleanup.maxRows", "cleanup.lockStaleMinutes",
    ] },
  ] },
  { key: "monitor", sections: [
    { key: "checks", fields: ["monitor.intervalSeconds", "monitor.windowMinutes", "monitor.healthcheckUrl", "monitor.diskPath", "monitor.accessLog"] },
    { key: "thresholds", fields: [
      "monitor.minFreePercent", "monitor.minFreeGb", "monitor.maxWalMb", "monitor.maxPostgresDatabaseGb",
      "monitor.maxHttp5xx", "monitor.maxIngestFailures",
    ] },
    { key: "alerts", fields: ["monitor.alertWebhookUrl", "monitor.alertBearerToken"] },
  ] },
]

/** Maintained by the setup wizard; shown read-only and edited only as YAML. */
export const runtimeReadOnlyFields = ["version", "setup.completed", "setup.completedAt"] as const

// This file describes behavior only. All user-facing labels and help text live in
// i18n/messages/<locale>/runtime.json and are validated against these paths.
export const runtimeConfigFields: Record<string, RuntimeFieldMetadata> = {
  version: { kind: "number" },
  "setup.completed": { kind: "boolean" },
  "setup.completedAt": {},
  "server.baseUrl": {},
  "server.trustProxyHeaders": { kind: "boolean" },
  "server.clientIpHeader": {},
  "server.clientIpTrustedHops": { kind: "number" },
  "server.autoRestartOnDriverChange": { kind: "boolean" },
  "server.emailPollIntervalMs": { kind: "number" },
  "database.driver": { kind: "select", options: [{ value: "sqlite", label: "SQLite" }, { value: "postgres", label: "PostgreSQL" }] },
  "database.sqlite.path": {},
  "database.sqlite.backupDir": {},
  "database.sqlite.backupRetentionDays": { kind: "number" },
  "database.postgres.url": { kind: "secret" },
  "database.postgres.poolMax": { kind: "number" },
  "database.postgres.idleTimeoutMs": { kind: "number" },
  "database.postgres.connectTimeoutMs": { kind: "number" },
  "database.postgres.ssl": { kind: "boolean" },
  "database.postgres.sslRejectUnauthorized": { kind: "boolean" },
  "database.postgres.applicationName": {},
  "database.postgres.backupDir": {},
  "database.postgres.backupRetentionDays": { kind: "number" },
  "auth.secret": { kind: "secret", required: true, secretAction: "generate" },
  "auth.passwordPepper": { kind: "secret", required: true },
  "auth.emperorBootstrapSecret": { kind: "secret", secretAction: "generate" },
  "auth.github.clientId": {},
  "auth.github.clientSecret": { kind: "secret" },
  "auth.google.clientId": {},
  "auth.google.clientSecret": { kind: "secret" },
  "auth.passkeys.enabled": { kind: "boolean" },
  "auth.rateLimit.windowSeconds": { kind: "number" },
  "auth.rateLimit.loginPerClient": { kind: "number" },
  "auth.rateLimit.loginGlobal": { kind: "number" },
  "auth.rateLimit.registerPerClient": { kind: "number" },
  "auth.rateLimit.registerGlobal": { kind: "number" },
  "auth.rateLimit.maxClients": { kind: "number" },
  "auth.rateLimit.scryptMaxConcurrency": { kind: "number" },
  "email.ingestSecret": { kind: "secret", required: true, secretAction: "generate" },
  "cleanup.batchSize": { kind: "number" },
  "cleanup.maxRows": { kind: "number" },
  "cleanup.lockStaleMinutes": { kind: "number" },
  "cleanup.permanentMessageRetentionDays": { kind: "number" },
  "scheduler.cleanupIntervalSeconds": { kind: "number" },
  "scheduler.backupIntervalSeconds": { kind: "number" },
  "scheduler.backupOnStart": { kind: "boolean" },
  "monitor.intervalSeconds": { kind: "number" },
  "monitor.healthcheckUrl": {},
  "monitor.diskPath": {},
  "monitor.accessLog": {},
  "monitor.minFreePercent": { kind: "number" },
  "monitor.minFreeGb": { kind: "number" },
  "monitor.maxWalMb": { kind: "number" },
  "monitor.maxPostgresDatabaseGb": { kind: "number" },
  "monitor.windowMinutes": { kind: "number" },
  "monitor.maxHttp5xx": { kind: "number" },
  "monitor.maxIngestFailures": { kind: "number" },
  "monitor.alertWebhookUrl": {},
  "monitor.alertBearerToken": { kind: "secret", secretAction: "generate" },
  "offsite.remote": {},
  "offsite.intervalSeconds": { kind: "number" },
  "offsite.rcloneBin": {},
  "offsite.rcloneConfigContent": { kind: "textarea" },
}
