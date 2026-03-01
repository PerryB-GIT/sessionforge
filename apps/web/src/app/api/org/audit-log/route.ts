import { NextRequest, NextResponse } from 'next/server'
import { eq, and, gte, lte } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, auditLogs, orgMembers, organizations, users } from '@/db'
import { isFeatureAvailable } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

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

  const [membership] = await db
    .select({ orgId: orgMembers.orgId, plan: organizations.plan })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, session.user.id))
    .limit(1)

  if (!membership) {
    return NextResponse.json({ data: [], error: null } satisfies ApiResponse<never[]>)
  }

  if (!isFeatureAvailable(membership.plan as PlanTier, 'audit_log')) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'PLAN_LIMIT',
          message: 'Audit log requires an Enterprise plan',
          statusCode: 403,
        },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  const params = req.nextUrl.searchParams
  const page = Math.max(0, Number(params.get('page') ?? '0'))
  const actionFilter = params.get('action')
  const userIdFilter = params.get('userId')
  const startDate = params.get('startDate')
  const endDate = params.get('endDate')

  const conditions = [eq(auditLogs.orgId, membership.orgId)]
  if (actionFilter) conditions.push(eq(auditLogs.action, actionFilter))
  if (userIdFilter) conditions.push(eq(auditLogs.userId, userIdFilter))
  if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate)))
  if (endDate) conditions.push(lte(auditLogs.createdAt, new Date(endDate)))

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      targetId: auditLogs.targetId,
      metadata: auditLogs.metadata,
      ip: auditLogs.ip,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.userId,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(and(...conditions))
    .orderBy(auditLogs.createdAt)
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE)

  return NextResponse.json({ data: rows, error: null } satisfies ApiResponse<typeof rows>)
}
