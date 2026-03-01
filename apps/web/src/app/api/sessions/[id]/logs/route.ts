export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, sessions, users } from '@/db'
import { redis, RedisKeys, SESSION_LOG_MAX_LINES } from '@/lib/redis'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'
import { PLAN_LIMITS } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'

interface SessionLogsResponse {
  sessionId: string
  lines: string[]
  total: number
  source: 'redis' | 'gcs'
}

// ─── GET /api/sessions/:id/logs ────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  const { searchParams } = new URL(req.url)
  const limit = Math.min(SESSION_LOG_MAX_LINES, parseInt(searchParams.get('limit') ?? '500', 10))
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  // Verify session ownership — also select stoppedAt for history gate
  const [record] = await db
    .select({ id: sessions.id, status: sessions.status, stoppedAt: sessions.stoppedAt })
    .from(sessions)
    .where(and(eq(sessions.id, params.id), eq(sessions.userId, session.user.id)))
    .limit(1)

  if (!record) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Session not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  const logKey = RedisKeys.sessionLogs(params.id)

  // Fetch logs from Redis ring buffer (LRANGE)
  // Lines stored as base64-encoded PTY output chunks
  const rawLines = await redis.lrange(logKey, offset, offset + limit - 1)
  const total = await redis.llen(logKey)

  // Redis is empty — check if session is stopped and fetch from GCS
  if (record.status !== 'running' && rawLines.length === 0) {
    // Plan history gate
    const [userRow] = await db
      .select({ plan: users.plan })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1)

    const plan = (userRow?.plan ?? 'free') as PlanTier
    const limits = PLAN_LIMITS[plan]

    if (record.stoppedAt && limits.historyDays > 0) {
      const ageMs = Date.now() - new Date(record.stoppedAt).getTime()
      const ageDays = ageMs / (1000 * 60 * 60 * 24)
      if (ageDays > limits.historyDays) {
        return NextResponse.json(
          {
            data: null,
            error: {
              code: 'HISTORY_LIMIT',
              message: `Session logs older than ${limits.historyDays} days require a higher plan`,
              statusCode: 403,
            },
          } satisfies ApiError,
          { status: 403 }
        )
      }
    }

    // Fetch from GCS
    try {
      const { fetchLogsFromGCS } = await import('@/lib/gcs-logs')
      const gcsResult = await fetchLogsFromGCS(params.id, session.user.id, offset, limit)
      if (gcsResult.lines.length > 0) {
        return NextResponse.json({
          data: {
            sessionId: params.id,
            lines: gcsResult.lines,
            total: gcsResult.total,
            source: 'gcs',
          },
          error: null,
        })
      }
    } catch (err) {
      console.error('[GET /api/sessions/:id/logs] GCS fetch failed:', err)
      // Fall through to empty response
    }
  }

  const response: SessionLogsResponse = {
    sessionId: params.id,
    lines: rawLines as string[],
    total,
    source: 'redis',
  }

  return NextResponse.json(
    { data: response, error: null } satisfies ApiResponse<SessionLogsResponse>,
    { status: 200 }
  )
}
