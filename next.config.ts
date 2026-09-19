import type { NextConfig } from 'next'
import withPWA from 'next-pwa'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./app/i18n/request.ts')

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingExcludes: {
    // Standalone serializes its config; compilation tools are never used at runtime.
    '*': ['typescript', 'esbuild', '@esbuild/*', '@swc/core', '@swc/core-*', 'webpack', 'terser', 'next-pwa', 'workbox-build', 'workbox-webpack-plugin'].flatMap(name => [
      `node_modules/${name}/**/*`,
      `node_modules/.pnpm/*/node_modules/${name}/**/*`,
    ]),
  },
  serverExternalPackages: ['better-sqlite3', 'pg'],
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        // Restrict embedding without blocking custom appearance scripts or email srcDoc.
        { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }, {
      source: '/api/:path*',
      headers: [
        {
          key: 'Cache-Control',
          value: 'private, no-store, max-age=0, must-revalidate',
        },
        { key: 'Pragma', value: 'no-cache' },
      ],
    }]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '*.googleusercontent.com',
      }
    ],
  },
};

const withPWAConfigured = withPWA({
  dest: 'public',
  register: false,
  skipWaiting: true,
  cacheStartUrl: false,
  dynamicStartUrl: false,
  importScripts: ['/pwa-cache-cleanup.js'],
  runtimeCaching: [],
  // App Router emits empty client stubs for API routes; they have no offline use.
  buildExcludes: [/^static\/chunks\/app\/api\//],
  disable: process.env.NODE_ENV === 'development',
})

const configWithPWA = withPWAConfigured(nextConfig)

export default withNextIntl(configWithPWA)
