const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@sessionforge/shared-types'],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['ws'],
  },
}

module.exports = withSentryConfig(nextConfig, {
  // Silent during builds — errors still captured at runtime
  silent: true,
  // Disable source map upload until SENTRY_AUTH_TOKEN is configured
  disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  // Tree-shake Sentry logger to reduce bundle size
  hideSourceMaps: true,
  widenClientFileUpload: true,
})
