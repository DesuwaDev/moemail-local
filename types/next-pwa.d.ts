declare module "next-pwa" {
  import type { NextConfig } from "next"

  interface PwaOptions {
    dest: string
    register?: boolean
    skipWaiting?: boolean
    cacheStartUrl?: boolean
    dynamicStartUrl?: boolean
    importScripts?: string[]
    runtimeCaching?: unknown[]
    buildExcludes?: RegExp[]
    disable?: boolean
  }

  export default function withPwa(
    options: PwaOptions,
  ): (config: NextConfig) => NextConfig
}
