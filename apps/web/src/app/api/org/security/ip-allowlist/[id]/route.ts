import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, organizations, orgMembers, ipAllowlists } from '@/db'
import { invalidateAllowlistCache } from '@/lib/ip-allowlist'
import { logAuditEvent } from '@/lib/audit'
import type { ApiError } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
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
    .select({ orgId: orgMembers.orgId, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, session.user.id))
    .limit(1)

  if (!membership || membership.role !== 'owner') {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'FORBIDDEN', message: 'Requires owner role', statusCode: 403 },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  const [entry] = await db
    .select({ cidr: ipAllowlists.cidr })
    .from(ipAllowlists)
    .where(and(eq(ipAllowlists.id, params.id), eq(ipAllowlists.orgId, membership.orgId)))
    .limit(1)

  if (!entry) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Entry not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  await db.delete(ipAllowlists).where(eq(ipAllowlists.id, params.id))
  await invalidateAllowlistCache(membership.orgId)

  logAuditEvent(membership.orgId, session.user.id, 'ip_allowlist.updated', {
    metadata: { action: 'removed', cidr: entry.cidr },
  }).catch(() => {})

  return NextResponse.json({ data: { ok: true }, error: null })
}
