/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@sessionforge/shared-types'],
  experimental: {
    serverComponentsExternalPackages: ['ws'],
  },
}

module.exports = nextConfig
