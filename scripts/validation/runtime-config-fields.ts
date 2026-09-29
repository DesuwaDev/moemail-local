import assert from "node:assert/strict"
import { createDefaultConfig } from "../../app/lib/config/schema"
import { runtimeConfigFields, runtimeLayout, runtimeReadOnlyFields } from "../../app/components/profile/runtime-config-fields"

function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => (
    leafPaths(child, prefix ? `${prefix}.${key}` : key)
  ))
}

const schemaPaths = leafPaths(createDefaultConfig()).sort()
const visualPaths = Object.keys(runtimeConfigFields).sort()
assert.deepEqual(visualPaths, schemaPaths, "Visual runtime fields must cover every AppConfig leaf")
assert.deepEqual(
  Object.entries(runtimeConfigFields)
    .filter(([, metadata]) => metadata.required)
    .map(([path]) => path)
    .sort(),
  ["auth.passwordPepper", "auth.secret", "email.ingestSecret"],
  "Required post-setup secrets must reject empty values in visual mode",
)
assert.deepEqual(
  Object.entries(runtimeConfigFields)
    .filter(([, metadata]) => metadata.secretAction === "generate")
    .map(([path]) => path)
    .sort(),
  ["auth.emperorBootstrapSecret", "auth.secret", "email.ingestSecret", "monitor.alertBearerToken"],
  "Only independently rotatable secrets may expose the generate action",
)
const placedPaths = [
  ...runtimeLayout.flatMap(group => group.sections.flatMap(section => section.fields)),
  ...runtimeReadOnlyFields,
]
assert.deepEqual(
  placedPaths.filter((path, index) => placedPaths.indexOf(path) !== index),
  [],
  "A runtime field may appear in only one visual group",
)
assert.deepEqual([...placedPaths].sort(), schemaPaths, "Every AppConfig leaf must be placed in a visual group or shown read-only")
assert.deepEqual(
  runtimeLayout.map(group => group.key).filter((key, index, keys) => keys.indexOf(key) !== index),
  [],
  "Visual group keys must be unique",
)

console.log(JSON.stringify({ ok: true, fields: visualPaths.length, groups: runtimeLayout.length }))
