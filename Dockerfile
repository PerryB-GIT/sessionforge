# =============================================================================
# SessionForge Production Dockerfile
# Multi-stage build for minimal, secure production image.
# =============================================================================

# Stage 1: Install dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy all package manifests for workspace resolution
COPY package.json package-lock.json turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/

# Install dependencies (allow lockfile updates for platform differences)
RUN npm ci --ignore-scripts

# Stage 2: Build the application
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy full source
COPY . .

# Ensure shared-types workspace node_modules are linked
RUN npm install --workspace=packages/shared-types --ignore-scripts 2>/dev/null || true

# Set build-time env
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the Next.js app (standalone output configured in next.config.js)
RUN npm run build --workspace=apps/web

# Extract the nextConfig JSON from the generated standalone server so our custom server
# can pass it to startServer via __NEXT_PRIVATE_STANDALONE_CONFIG env var.
# We use a sed/grep pipeline to extract the JSON-stringified config without eval().
RUN node -e " \
  const fs = require('fs'); \
  const src = fs.readFileSync('apps/web/.next/standalone/apps/web/server.js', 'utf8'); \
  const start = src.indexOf('const nextConfig = {') + 'const nextConfig = '.length; \
  const afterKey = src.indexOf('\n\nprocess.env.__NEXT_PRIVATE_STANDALONE_CONFIG'); \
  const configLiteral = src.slice(start, afterKey); \
  const vm = require('vm'); \
  const ctx = {}; vm.runInNewContext('const nextConfig = ' + configLiteral + '; __result = JSON.stringify(nextConfig)', ctx); \
  fs.writeFileSync('apps/web/.next/standalone/apps/web/next-config.json', ctx.__result); \
  console.log('Extracted nextConfig (' + ctx.__result.length + ' bytes)'); \
"

COPY apps/web/server.js apps/web/.next/standalone/apps/web/server.js

# Install server.js runtime deps that Next.js standalone doesn't bundle automatically
# (ws, @upstash/redis, bcryptjs, postgres are used only by our custom server, not by Next.js)
RUN cd apps/web/.next/standalone && \
    npm install --no-save ws @upstash/redis bcryptjs postgres 2>/dev/null

# Stage 3: Minimal production runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Copy only what's needed to run the app (standalone output)
RUN mkdir -p ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Drop to non-root user
USER nextjs

EXPOSE 3000

# Health check for Cloud Run / load balancers
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Run the custom server (handles WS upgrades + proxies to Next.js)
CMD ["node", "apps/web/server.js"]
