import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, organizations, orgMembers, orgInvites, users } from '@/db'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const { token } = params

  // Look up the invite by token
  const [invite] = await db
    .select({
      id: orgInvites.id,
      orgId: orgInvites.orgId,
      email: orgInvites.email,
      role: orgInvites.role,
      expiresAt: orgInvites.expiresAt,
      acceptedAt: orgInvites.acceptedAt,
    })
    .from(orgInvites)
    .where(eq(orgInvites.token, token))
    .limit(1)

  if (!invite) {
    return NextResponse.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Invitation not found or already used', statusCode: 404 } } satisfies ApiError,
      { status: 404 }
    )
  }

  if (invite.acceptedAt) {
    return NextResponse.json(
      { data: null, error: { code: 'CONFLICT', message: 'This invitation has already been accepted', statusCode: 409 } } satisfies ApiError,
      { status: 409 }
    )
  }

  if (invite.expiresAt < new Date()) {
    return NextResponse.json(
      { data: null, error: { code: 'GONE', message: 'This invitation has expired. Ask your admin to send a new one.', statusCode: 410 } } satisfies ApiError,
      { status: 410 }
    )
  }

  // Must be logged in
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'You must be logged in to accept this invitation', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  // Verify accepting user's email matches the invite
  const [acceptingUser] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  if (!acceptingUser) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'User not found', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  if (acceptingUser.email.toLowerCase() !== invite.email.toLowerCase()) {
    return NextResponse.json(
      { data: null, error: { code: 'FORBIDDEN', message: 'This invitation was sent to a different email address', statusCode: 403 } } satisfies ApiError,
      { status: 403 }
    )
  }

  // Check if already a member (idempotent accept)
  const [existingMember] = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, invite.orgId), eq(orgMembers.userId, acceptingUser.id)))
    .limit(1)

  // Fetch org name for the response
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, invite.orgId))
    .limit(1)

  if (existingMember) {
    // Already a member — just mark the invite accepted and return success
    await db
      .update(orgInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(orgInvites.id, invite.id))

    return NextResponse.json({
      data: { orgId: invite.orgId, orgName: org?.name ?? '' },
      error: null,
    } satisfies ApiResponse<{ orgId: string; orgName: string }>)
  }

  // Add to org_members and mark invite accepted — in a transaction
  await db.transaction(async (tx) => {
    await tx.insert(orgMembers).values({
      orgId: invite.orgId,
      userId: acceptingUser.id,
      role: invite.role,
    })
    await tx
      .update(orgInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(orgInvites.id, invite.id))
  })

  return NextResponse.json({
    data: { orgId: invite.orgId, orgName: org?.name ?? '' },
    error: null,
  } satisfies ApiResponse<{ orgId: string; orgName: string }>)
}
