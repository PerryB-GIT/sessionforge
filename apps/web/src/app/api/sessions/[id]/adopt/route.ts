export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, sessions, orgMembers } from '@/db'
import { machines } from '@/db/schema'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

// ─── POST /api/sessions/:id/adopt ──────────────────────────────────────────────
// Mark session as adoptable (owner or org admin only)

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authSession = await auth()
  if (!authSession?.user?.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  // Fetch session with machine for org lookup
  const [record] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      status: sessions.status,
      machineId: sessions.machineId,
      orgId: machines.orgId,
    })
    .from(sessions)
    .leftJoin(machines, eq(sessions.machineId, machines.id))
    .where(eq(sessions.id, params.id))
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

  const isOwner = record.userId === authSession.user.id

  // Check org admin/owner role if machine belongs to an org
  let isOrgAdmin = false
  if (record.orgId) {
    const [member] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, record.orgId), eq(orgMembers.userId, authSession.user.id)))
      .limit(1)
    isOrgAdmin = member?.role === 'owner' || member?.role === 'admin'
  }

  if (!isOwner && !isOrgAdmin) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'FORBIDDEN', message: 'Forbidden', statusCode: 403 },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  if (record.status !== 'running') {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'SESSION_NOT_RUNNING',
          message: 'Session must be running to be made adoptable',
          statusCode: 400,
        },
      } satisfies ApiError,
      { status: 400 }
    )
  }

  await db.update(sessions).set({ adoptable: true }).where(eq(sessions.id, params.id))

  return NextResponse.json(
    { data: { ok: true, adoptable: true }, error: null } satisfies ApiResponse<{
      ok: boolean
      adoptable: boolean
    }>,
    { status: 200 }
  )
}

// ─── DELETE /api/sessions/:id/adopt ────────────────────────────────────────────
// Revoke adoptable status (owner only)

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authSession = await auth()
  if (!authSession?.user?.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  const [record] = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.id, params.id))
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

  if (record.userId !== authSession.user.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'FORBIDDEN', message: 'Forbidden', statusCode: 403 },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  await db.update(sessions).set({ adoptable: false }).where(eq(sessions.id, params.id))

  return NextResponse.json(
    { data: { ok: true, adoptable: false }, error: null } satisfies ApiResponse<{
      ok: boolean
      adoptable: boolean
    }>,
    { status: 200 }
  )
}

// ─── GET /api/sessions/:id/adopt ───────────────────────────────────────────────
// Get adoptable status (any authenticated user)

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authSession = await auth()
  if (!authSession?.user?.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  const [record] = await db
    .select({ adoptable: sessions.adoptable, adoptedBy: sessions.adoptedBy })
    .from(sessions)
    .where(eq(sessions.id, params.id))
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
    {
      data: { adoptable: record.adoptable, adoptedBy: record.adoptedBy },
      error: null,
    } satisfies ApiResponse<{ adoptable: boolean; adoptedBy: string | null }>,
    { status: 200 }
  )
}
