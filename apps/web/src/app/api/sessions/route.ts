export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, desc, and, count } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, sessions, machines } from '@/db'
import { redis, RedisKeys } from '@/lib/redis'
import { checkSessionLimit, checkMachineLimit, PlanLimitError } from '@/lib/plan-enforcement'
import type { ApiResponse, ApiError, PaginatedResponse, StartSessionRequest } from '@sessionforge/shared-types'
import type { CloudToAgentMessage } from '@sessionforge/shared-types'

// ─── GET /api/sessions ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
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
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)))
  const machineId = searchParams.get('machineId')
  const statusFilter = searchParams.get('status') as 'running' | 'stopped' | 'crashed' | 'paused' | null
  const offset = (page - 1) * pageSize

  const whereConditions = [eq(sessions.userId, session.user.id)]
  if (machineId) whereConditions.push(eq(sessions.machineId, machineId))
  if (statusFilter) whereConditions.push(eq(sessions.status, statusFilter))

  const whereClause = whereConditions.length === 1 ? whereConditions[0] : and(...whereConditions)

  const [totalResult, rows] = await Promise.all([
    db.select({ count: count() }).from(sessions).where(whereClause),
    db
      .select({
        id: sessions.id,
        machineId: sessions.machineId,
        userId: sessions.userId,
        pid: sessions.pid,
        processName: sessions.processName,
        workdir: sessions.workdir,
        status: sessions.status,
        exitCode: sessions.exitCode,
        peakMemoryMb: sessions.peakMemoryMb,
        avgCpuPercent: sessions.avgCpuPercent,
        startedAt: sessions.startedAt,
        stoppedAt: sessions.stoppedAt,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(whereClause)
      .orderBy(desc(sessions.createdAt))
      .limit(pageSize)
      .offset(offset),
  ])

  const total = totalResult[0]?.count ?? 0
  const response: PaginatedResponse<(typeof rows)[0]> = {
    items: rows,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  }

  return NextResponse.json(
    { data: response, error: null } satisfies ApiResponse<typeof response>,
    { status: 200 }
  )
}

// ─── POST /api/sessions ────────────────────────────────────────────────────────

const startSessionSchema = z.object({
  machineId: z.string().uuid(),
  command: z.string().default('claude'),
  workdir: z.string().optional(),
  env: z.record(z.string()).optional(),
})

export async function POST(req: NextRequest) {
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

  const body = await req.json()
  const parsed = startSessionSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message ?? 'Invalid input',
          statusCode: 400,
        },
      } satisfies ApiError,
      { status: 400 }
    )
  }

  const { machineId, command, workdir, env } = parsed.data

  // Verify machine belongs to user and is online
  const [machine] = await db
    .select({ id: machines.id, status: machines.status })
    .from(machines)
    .where(and(eq(machines.id, machineId), eq(machines.userId, session.user.id)))
    .limit(1)

  if (!machine) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Machine not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  if (machine.status !== 'online') {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'MACHINE_OFFLINE',
          message: `Machine is ${machine.status}. It must be online to start a session.`,
          statusCode: 422,
        },
      } satisfies ApiError,
      { status: 422 }
    )
  }

  // Enforce plan limits
  try {
    await checkSessionLimit(session.user.id)
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return NextResponse.json(
        {
          data: null,
          error: { code: err.code, message: err.message, statusCode: 402 },
        } satisfies ApiError,
        { status: 402 }
      )
    }
    throw err
  }

  // Create the session record (agent will update it with pid/processName when started)
  const requestId = crypto.randomUUID()

  const [newSession] = await db
    .insert(sessions)
    .values({
      machineId,
      userId: session.user.id,
      processName: command,
      workdir: workdir ?? null,
      status: 'running',
    })
    .returning()

  if (!newSession) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create session record', statusCode: 500 },
      } satisfies ApiError,
      { status: 500 }
    )
  }

  // Dispatch start_session command to agent via Redis pub/sub
  const agentCommand: CloudToAgentMessage = {
    type: 'start_session',
    requestId,
    command,
    workdir: workdir ?? process.env.DEFAULT_WORKDIR ?? '/home',
    env,
  }

  await redis.publish(RedisKeys.agentChannel(machineId), JSON.stringify(agentCommand))

  return NextResponse.json(
    { data: newSession, error: null } satisfies ApiResponse<typeof newSession>,
    { status: 201 }
  )
}
