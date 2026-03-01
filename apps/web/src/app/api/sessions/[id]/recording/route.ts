export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, sessions, machines, orgMembers, organizations } from '@/db'
import { isFeatureAvailable } from '@sessionforge/shared-types'
import { getRecordingSignedUrl } from '@/lib/recording'
import type { PlanTier } from '@sessionforge/shared-types'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

// ─── GET /api/sessions/:id/recording ─────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
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

  // Load the session record and verify ownership
  const [sessionRecord] = await db
    .select({ id: sessions.id, machineId: sessions.machineId, userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.id, params.id))
    .limit(1)

  if (!sessionRecord) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Session not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  // Must be the session owner
  if (sessionRecord.userId !== session.user.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'FORBIDDEN', message: 'Forbidden', statusCode: 403 },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  // Look up the machine's org
  const [machineInfo] = await db
    .select({ orgId: machines.orgId })
    .from(machines)
    .where(eq(machines.id, sessionRecord.machineId))
    .limit(1)

  if (!machineInfo?.orgId) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'PLAN_LIMIT',
          message: 'Session recording requires Enterprise plan',
          statusCode: 403,
        },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  // Verify the user is a member of this org and the org is on Enterprise plan
  const [membership] = await db
    .select({ plan: organizations.plan })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(and(eq(orgMembers.userId, session.user.id), eq(orgMembers.orgId, machineInfo.orgId)))
    .limit(1)

  if (!membership || !isFeatureAvailable(membership.plan as PlanTier, 'session_recording')) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'PLAN_LIMIT',
          message: 'Session recording requires Enterprise plan',
          statusCode: 403,
        },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  const url = await getRecordingSignedUrl(params.id, machineInfo.orgId)
  if (!url) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Recording not available', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json({ data: { url }, error: null } satisfies ApiResponse<{ url: string }>)
}
