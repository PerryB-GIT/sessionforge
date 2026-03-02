export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, organizations, orgMembers } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { requireOrgRole, orgAuthErrorResponse } from '@/lib/org-auth'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

// ─── DELETE /api/org/members/:id ──────────────────────────────────────────────
// Removes a member from the authenticated user's organization.
// :id is the org_members row id. Requires admin role.

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

  // Find the org owned by the requester
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.ownerId, session.user.id))
    .limit(1)

  if (!org) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'No organization found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  // Enforce admin role — only admins and owners may remove members
  try {
    await requireOrgRole(session, org.id, 'admin')
  } catch (err) {
    const { status, code, message } = orgAuthErrorResponse(err)
    return NextResponse.json(
      { data: null, error: { code, message, statusCode: status } },
      { status }
    )
  }

  // Delete the member row, scoped to the org to prevent cross-org removal
  const [deleted] = await db
    .delete(orgMembers)
    .where(and(eq(orgMembers.id, params.id), eq(orgMembers.orgId, org.id)))
    .returning({ id: orgMembers.id, userId: orgMembers.userId })

  if (!deleted) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Member not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    undefined
  logAuditEvent(org.id, session.user.id, 'member.removed', {
    targetId: deleted.userId,
    ip,
  }).catch(() => {})

  return NextResponse.json(
    { data: { id: deleted.id, removed: true }, error: null } satisfies ApiResponse<{
      id: string
      removed: boolean
    }>,
    { status: 200 }
  )
}
