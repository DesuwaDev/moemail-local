import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  { rules: {
    "@typescript-eslint/no-explicit-any": "off",
    // Existing effects synchronize async loading, editable forms and browser-only
    // mail sanitization. Keep those lifecycles during the framework migration.
    "react-hooks/set-state-in-effect": "off",
  } },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "docs/**"]),
])
