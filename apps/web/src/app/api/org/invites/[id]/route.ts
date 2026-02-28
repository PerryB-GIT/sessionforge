import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, organizations, orgInvites } from '@/db'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.ownerId, session.user.id))
    .limit(1)

  if (!org) {
    return NextResponse.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'No organization found', statusCode: 404 } } satisfies ApiError,
      { status: 404 }
    )
  }

  const [deleted] = await db
    .delete(orgInvites)
    .where(and(eq(orgInvites.id, params.id), eq(orgInvites.orgId, org.id)))
    .returning({ id: orgInvites.id })

  if (!deleted) {
    return NextResponse.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Invitation not found', statusCode: 404 } } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json(
    { data: { id: deleted.id, revoked: true }, error: null } satisfies ApiResponse<{ id: string; revoked: boolean }>
  )
}
