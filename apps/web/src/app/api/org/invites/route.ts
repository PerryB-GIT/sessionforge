import { NextResponse } from 'next/server'
import { eq, and, isNull, gt } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, organizations, orgInvites } from '@/db'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

export async function GET() {
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
    return NextResponse.json({ data: [], error: null })
  }

  const now = new Date()
  const invites = await db
    .select({
      id: orgInvites.id,
      email: orgInvites.email,
      role: orgInvites.role,
      expiresAt: orgInvites.expiresAt,
      createdAt: orgInvites.createdAt,
    })
    .from(orgInvites)
    .where(
      and(
        eq(orgInvites.orgId, org.id),
        isNull(orgInvites.acceptedAt),
        gt(orgInvites.expiresAt, now),
      )
    )
    .orderBy(orgInvites.createdAt)

  return NextResponse.json({ data: invites, error: null } satisfies ApiResponse<typeof invites>)
}
