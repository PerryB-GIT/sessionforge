const { withSentryConfig } = require('@sentry/nextjs')
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-eval needed by Next.js dev + xterm.js
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self' wss://sessionforge.dev wss://sessionforge-j3565l4yya-uc.a.run.app https://api.stripe.com",
      'frame-src https://js.stripe.com https://hooks.stripe.com',
      "frame-ancestors 'none'",
    ].join('; '),
  },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: ['@sessionforge/shared-types'],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverComponentsExternalPackages: [
      'ws',
      '@grpc/grpc-js',
      '@grpc/proto-loader',
      '@opentelemetry/sdk-node',
      '@opentelemetry/sdk-trace-node',
      '@opentelemetry/sdk-trace-base',
      '@opentelemetry/sdk-logs',
      '@opentelemetry/sdk-metrics',
      '@opentelemetry/exporter-trace-otlp-grpc',
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/exporter-trace-otlp-proto',
      '@opentelemetry/exporter-logs-otlp-grpc',
      '@opentelemetry/exporter-logs-otlp-http',
      '@opentelemetry/exporter-logs-otlp-proto',
      '@opentelemetry/exporter-metrics-otlp-grpc',
      '@opentelemetry/exporter-metrics-otlp-http',
      '@opentelemetry/exporter-metrics-otlp-proto',
      '@opentelemetry/exporter-prometheus',
      '@opentelemetry/exporter-zipkin',
      '@opentelemetry/configuration',
      '@opentelemetry/otlp-exporter-base',
      '@opentelemetry/otlp-grpc-exporter-base',
      '@opentelemetry/otlp-transformer',
      '@opentelemetry/instrumentation',
      '@opentelemetry/resources',
    ],
    instrumentationHook: true,
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      // Prevent Node.js-only packages from being bundled on the client/edge
      const originalExternals = config.externals || []
      config.externals = [
        ...(Array.isArray(originalExternals) ? originalExternals : [originalExternals]),
        ({ request }, callback) => {
          if (
            request &&
            (request.startsWith('@opentelemetry/') ||
              request.startsWith('@grpc/') ||
              request === 'ws')
          ) {
            return callback(null, `commonjs ${request}`)
          }
          callback()
        },
      ]
    }
    return config
  },
  async redirects() {
    return [
      // Canonical route aliases
      { source: '/pricing', destination: '/#pricing', permanent: false },
      { source: '/register', destination: '/signup', permanent: true },
    ]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

module.exports = withBundleAnalyzer(
  withSentryConfig(nextConfig, {
    silent: true,
    disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
    disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
    hideSourceMaps: true,
    widenClientFileUpload: true,
  })
)
