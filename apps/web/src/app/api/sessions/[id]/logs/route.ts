export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, sessions } from '@/db'
import { redis, RedisKeys, SESSION_LOG_MAX_LINES } from '@/lib/redis'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

interface SessionLogsResponse {
  sessionId: string
  lines: string[]
  total: number
  source: 'redis' | 'gcs'
}

// ─── GET /api/sessions/:id/logs ────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

  // Verify session ownership
  const [record] = await db
    .select({ id: sessions.id, status: sessions.status })
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

  // STUB: For sessions older than SESSION_LOG_TTL_SECONDS, logs would be fetched from GCS:
  // if (rawLines.length === 0 && record.status !== 'running') {
  //   const gcsLines = await fetchLogsFromGCS(params.id, { offset, limit })
  //   return NextResponse.json({ data: { ...gcsLines, source: 'gcs' }, error: null })
  // }

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
