export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, desc, count } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, machines } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import type { ApiResponse, ApiError, PaginatedResponse } from '@sessionforge/shared-types'
import type { Machine } from '@sessionforge/shared-types'

// ─── GET /api/machines ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
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
      db.select({ count: count() }).from(machines).where(eq(machines.userId, session.user.id)),
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
  } catch (err) {
    console.error('[GET /api/machines] unhandled error:', err)
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error',
          statusCode: 500,
        },
      },
      { status: 500 }
    )
  }
}

// ─── POST /api/machines ────────────────────────────────────────────────────────

const createMachineSchema = z.object({
  name: z.string().min(1).max(255),
  os: z.enum(['windows', 'macos', 'linux']),
  hostname: z.string().min(1).max(255),
  orgId: z.string().uuid().optional(),
  agentVersion: z.string().max(64).optional(),
  ipAddress: z.string().max(45).optional(),
  cpuModel: z.string().max(255).optional(),
  ramGb: z.number().positive().optional(),
})

export async function POST(req: NextRequest) {
  try {
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
    const parsed = createMachineSchema.safeParse(body)

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

    const { name, os, hostname, orgId, agentVersion, ipAddress, cpuModel, ramGb } = parsed.data

    const [created] = await db
      .insert(machines)
      .values({
        userId: session.user.id,
        orgId: orgId ?? null,
        name,
        os,
        hostname,
        agentVersion: agentVersion ?? '0.0.0',
        ipAddress: ipAddress ?? null,
        cpuModel: cpuModel ?? null,
        ramGb: ramGb ?? null,
      })
      .returning()

    if (!created) {
      return NextResponse.json(
        {
          data: null,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to register machine', statusCode: 500 },
        } satisfies ApiError,
        { status: 500 }
      )
    }

    if (created.orgId) {
      const ip =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        req.headers.get('x-real-ip') ??
        undefined
      logAuditEvent(created.orgId, session.user.id, 'machine.added', {
        targetId: created.id,
        metadata: { name: created.name },
        ip,
      }).catch(() => {})
    }

    return NextResponse.json({ data: created, error: null } satisfies ApiResponse<typeof created>, {
      status: 201,
    })
  } catch (err) {
    console.error('[POST /api/machines] unhandled error:', err)
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error',
          statusCode: 500,
        },
      },
      { status: 500 }
    )
  }
}
