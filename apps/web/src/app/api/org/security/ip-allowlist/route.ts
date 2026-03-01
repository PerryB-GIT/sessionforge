import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import IPCIDR from 'ip-cidr'
import { auth } from '@/lib/auth'
import { db, organizations, orgMembers, ipAllowlists } from '@/db'
import { isFeatureAvailable } from '@sessionforge/shared-types'
import { invalidateAllowlistCache } from '@/lib/ip-allowlist'
import { logAuditEvent } from '@/lib/audit'
import type { PlanTier } from '@sessionforge/shared-types'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

const cidrSchema = z.object({
  cidr: z
    .string()
    .regex(/^[\d.]+\/\d+$|^[\da-f:]+\/\d+$/i, 'Must be a valid CIDR (e.g. 192.168.1.0/24)')
    .refine((cidr) => {
      try {
        new IPCIDR(cidr)
        return true
      } catch {
        return false
      }
    }, 'Invalid CIDR — check the address and prefix length'),
  label: z.string().max(255).optional(),
})

async function getOrgAndCheckPlan(userId: string) {
  const [membership] = await db
    .select({ orgId: orgMembers.orgId, plan: organizations.plan, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, userId))
    .limit(1)

  return membership ?? null
}

export async function GET() {
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

  const membership = await getOrgAndCheckPlan(session.user.id)
  if (!membership) return NextResponse.json({ data: [], error: null })

  if (!isFeatureAvailable(membership.plan as PlanTier, 'ip_allowlist')) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'PLAN_LIMIT',
          message: 'IP allowlist requires an Enterprise plan',
          statusCode: 403,
        },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  const entries = await db
    .select()
    .from(ipAllowlists)
    .where(eq(ipAllowlists.orgId, membership.orgId))
    .orderBy(ipAllowlists.createdAt)

  return NextResponse.json({ data: entries, error: null } satisfies ApiResponse<typeof entries>)
}

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

  const membership = await getOrgAndCheckPlan(session.user.id)
  if (!membership) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'FORBIDDEN', message: 'No organization found', statusCode: 403 },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  if (
    !isFeatureAvailable(membership.plan as PlanTier, 'ip_allowlist') ||
    membership.role !== 'owner'
  ) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'FORBIDDEN',
          message: 'Requires Enterprise plan and owner role',
          statusCode: 403,
        },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = cidrSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0].message,
          statusCode: 400,
        },
      } satisfies ApiError,
      { status: 400 }
    )
  }

  const [created] = await db
    .insert(ipAllowlists)
    .values({ orgId: membership.orgId, cidr: parsed.data.cidr, label: parsed.data.label })
    .returning()

  if (!created) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create entry', statusCode: 500 },
      } satisfies ApiError,
      { status: 500 }
    )
  }

  await invalidateAllowlistCache(membership.orgId)

  logAuditEvent(membership.orgId, session.user.id, 'ip_allowlist.updated', {
    metadata: { action: 'added', cidr: parsed.data.cidr },
  }).catch(() => {})

  return NextResponse.json({ data: created, error: null }, { status: 201 })
}
