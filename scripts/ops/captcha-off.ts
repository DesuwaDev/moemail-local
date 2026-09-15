import { requireValidatedRuntimeConfig } from "./validated-runtime"

/**
 * Recovery hatch for an operator locked out by a challenge that cannot be
 * solved — a key of the wrong type, a provider script blocked on the network, a
 * domain the key does not cover. Only the `enabled` flag is cleared: both key
 * pairs stay in storage so the panel can be repaired after signing back in.
 */
const config = await requireValidatedRuntimeConfig("captcha disable")

// The config store binds a database driver while its module loads, so it may
// only be imported once the runtime configuration above has been validated.
const { getCaptchaConfig, saveCaptchaConfig } = await import("../../app/lib/captcha/config")
const { closeDatabase } = await import("../../app/lib/db")

const current = await getCaptchaConfig()

if (!current.enabled) {
  console.log(JSON.stringify({
    event: "captcha.already_disabled",
    driver: config.database.driver,
    provider: current.provider,
  }))
} else {
  const next = await saveCaptchaConfig({ ...current, enabled: false })
  console.log(JSON.stringify({
    event: "captcha.disabled",
    driver: config.database.driver,
    provider: next.provider,
    keysPreserved: Object.entries(next.providers)
      .filter(([, settings]) => settings.siteKey.length > 0)
      .map(([id]) => id),
  }))
}

await closeDatabase()
