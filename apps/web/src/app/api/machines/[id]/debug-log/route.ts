export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, and, desc } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, machines, machineDebugLogs } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

// ─── GET /api/machines/:id/debug-log ──────────────────────────────────────────

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

  const [machine] = await db
    .select({ id: machines.id })
    .from(machines)
    .where(and(eq(machines.id, params.id), eq(machines.userId, session.user.id)))
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

  const { searchParams } = new URL(req.url)
  const levelFilter = searchParams.get('level')

  const whereConditions = [eq(machineDebugLogs.machineId, params.id)]
  if (levelFilter) whereConditions.push(eq(machineDebugLogs.level, levelFilter))

  const whereClause = whereConditions.length === 1 ? whereConditions[0] : and(...whereConditions)

  const rows = await db
    .select()
    .from(machineDebugLogs)
    .where(whereClause)
    .orderBy(desc(machineDebugLogs.createdAt))
    .limit(100)

  return NextResponse.json({ data: rows, error: null } satisfies ApiResponse<typeof rows>, {
    status: 200,
  })
}

// ─── DELETE /api/machines/:id/debug-log ───────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
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

  const [machine] = await db
    .select({ id: machines.id })
    .from(machines)
    .where(and(eq(machines.id, params.id), eq(machines.userId, session.user.id)))
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

  const deleted = await db
    .delete(machineDebugLogs)
    .where(eq(machineDebugLogs.machineId, params.id))
    .returning({ id: machineDebugLogs.id })

  return NextResponse.json(
    { data: { deleted: deleted.length }, error: null } satisfies ApiResponse<{ deleted: number }>,
    { status: 200 }
  )
}
