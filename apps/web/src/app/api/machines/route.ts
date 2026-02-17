import { NextRequest, NextResponse } from 'next/server'
import { eq, desc, count } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, machines } from '@/db'
import type { ApiResponse, ApiError, PaginatedResponse } from '@sessionforge/shared-types'
import type { Machine } from '@sessionforge/shared-types'

// ─── GET /api/machines ─────────────────────────────────────────────────────────

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
  const offset = (page - 1) * pageSize

  const [totalResult, rows] = await Promise.all([
    db
      .select({ count: count() })
      .from(machines)
      .where(eq(machines.userId, session.user.id)),
    db
      .select({
        id: machines.id,
        userId: machines.userId,
        orgId: machines.orgId,
        name: machines.name,
        os: machines.os,
        hostname: machines.hostname,
        agentVersion: machines.agentVersion,
        status: machines.status,
        lastSeen: machines.lastSeen,
        ipAddress: machines.ipAddress,
        cpuModel: machines.cpuModel,
        ramGb: machines.ramGb,
        createdAt: machines.createdAt,
        updatedAt: machines.updatedAt,
      })
      .from(machines)
      .where(eq(machines.userId, session.user.id))
      .orderBy(desc(machines.createdAt))
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
