import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, sessions, machines } from '@/db'
import { redis, RedisKeys } from '@/lib/redis'
import type { ApiResponse, ApiError, CloudToAgentMessage } from '@sessionforge/shared-types'

// ─── GET /api/sessions/:id ─────────────────────────────────────────────────────

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

  const [record] = await db
    .select()
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

  return NextResponse.json(
    { data: record, error: null } satisfies ApiResponse<typeof record>,
    { status: 200 }
  )
}

// ─── DELETE /api/sessions/:id ──────────────────────────────────────────────────

export async function DELETE(
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

  // Fetch session with machine info for authorization
  const [record] = await db
    .select({
      id: sessions.id,
      machineId: sessions.machineId,
      status: sessions.status,
    })
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

  if (record.status === 'stopped' || record.status === 'crashed') {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'SESSION_NOT_RUNNING',
          message: `Session is already ${record.status}`,
          statusCode: 422,
        },
      } satisfies ApiError,
      { status: 422 }
    )
  }

  // Send stop command to agent via Redis
  const stopCommand: CloudToAgentMessage = {
    type: 'stop_session',
    sessionId: record.id,
    force: false,
  }

  await redis.publish(RedisKeys.agentChannel(record.machineId), JSON.stringify(stopCommand))

  // Optimistically update status - agent will confirm via WebSocket
  await db
    .update(sessions)
    .set({ status: 'stopped', stoppedAt: new Date() })
    .where(eq(sessions.id, record.id))

  return NextResponse.json(
    { data: { id: record.id, stopped: true }, error: null } satisfies ApiResponse<{
      id: string
      stopped: boolean
    }>,
    { status: 200 }
  )
}
