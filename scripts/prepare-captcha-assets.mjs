import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const target = new URL("../public/vendor/cap/", import.meta.url)
mkdirSync(target, { recursive: true })

// Pin all browser assets locally, including optional instrumentation fallback.
const assets = [
  [require.resolve("cap-widget"), "cap-0.1.57.min.js"],
  [require.resolve("@cap.js/wasm/browser/cap_wasm_bg.wasm"), "cap-0.0.7.wasm"],
  [require.resolve("pako/dist/pako_inflate.min.js"), "pako-inflate-2.1.0.min.js"],
  [join(dirname(require.resolve("cap-widget")), "LICENSE"), "CAP-LICENSE"],
  [join(dirname(require.resolve("pako/package.json")), "LICENSE"), "PAKO-LICENSE"],
]
for (const [source, name] of assets) copyFileSync(source, new URL(name, target))
