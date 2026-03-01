FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
RUN npm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=apps/web

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/apps/web/public ./public
# standalone output: puts server.js + node_modules at /app (monorepo paths preserved)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
# static assets go into .next/static where Next.js expects them
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./.next/static
# Full .next build dir: server.js calls startServer({ dir: '/app' }) so it needs /app/.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next ./.next
# Custom WebSocket server (replaces the standalone-generated server.js at /app/)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/server.js ./server.js
# Full root node_modules: standalone only bundles Next.js deps; ws/pg/@upstash/redis are not included
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
