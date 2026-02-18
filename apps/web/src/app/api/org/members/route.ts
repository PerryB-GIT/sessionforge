import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, organizations, orgMembers, users } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

// ─── GET /api/org/members ───────────────────────────────────────────────────
// Returns all members of the authenticated user's organization.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  // Find the user's org
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

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(eq(orgMembers.orgId, org.id))

  return NextResponse.json({ data: rows, error: null } satisfies ApiResponse<typeof rows>)
}
