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
  disable: process.env.NODE_ENV === 'development',
})

const configWithPWA = withPWAConfigured(nextConfig)

export default withNextIntl(configWithPWA)
