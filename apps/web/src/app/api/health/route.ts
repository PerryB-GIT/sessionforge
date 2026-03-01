import { NextResponse } from 'next/server'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET() {
  const checks: Record<string, 'ok' | 'error' | 'skip'> = {}
  let healthy = true

  // Database check
  try {
    await db.execute(sql`SELECT 1`)
    checks.db = 'ok'
  } catch (err) {
    checks.db = 'error'
    healthy = false
    logger.error('Health check: DB unreachable', { error: String(err) })
  }

  // Redis check — only if Upstash env vars are present
  const redisConfigured =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  if (redisConfigured) {
    try {
      const { redis } = await import('@/lib/redis')
      await (redis as any).set('health:ping', '1', { ex: 10 })
      checks.redis = 'ok'
    } catch (err) {
      checks.redis = 'error'
      healthy = false
      logger.error('Health check: Redis unreachable', { error: String(err) })
    }
  } else {
    checks.redis = 'skip'
  }

  const status = healthy ? 200 : 503
  // Only expose aggregate status to unauthenticated callers.
  // Internal topology (which services are running, their individual status)
  // must not be leaked in public responses.
  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded' },
    { status }
  )
}
