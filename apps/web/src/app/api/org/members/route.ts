import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, organizations, orgMembers, users, orgInvites } from '@/db'
import { sendInviteEmail } from '@/lib/email'
import { requireFeature, FeatureNotAvailableError } from '@/lib/plan-enforcement'
import { logAuditEvent } from '@/lib/audit'
import { requireOrgRole, orgAuthErrorResponse } from '@/lib/org-auth'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

// ─── GET /api/org/members ───────────────────────────────────────────────────
// Returns all members of the authenticated user's organization.

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

  // Find the user's org
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

// ─── POST /api/org/members ──────────────────────────────────────────────────
// Send an org invite. Requires team plan. Feature-gated to team_invites.

const inviteBodySchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
})

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

  const body = await req.json().catch(() => ({}))
  const parsed = inviteBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message ?? 'Invalid input',
          statusCode: 400,
        },
      } satisfies ApiError,
      { status: 400 }
    )
  }

  const { email, role } = parsed.data
  const normalizedEmail = email.toLowerCase()

  // Feature gate
  try {
    await requireFeature(session.user.id, 'team_invites')
  } catch (err) {
    if (err instanceof FeatureNotAvailableError) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'Team invitations require a Team plan or higher',
            statusCode: 403,
          },
        } satisfies ApiError,
        { status: 403 }
      )
    }
    throw err
  }

  // Find the user's org (by owner)
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
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

  // Enforce admin role for inviting members
  try {
    await requireOrgRole(session, org.id, 'admin')
  } catch (err) {
    const { status, code, message } = orgAuthErrorResponse(err)
    return NextResponse.json(
      { data: null, error: { code, message, statusCode: status } },
      { status }
    )
  }

  // Cannot invite yourself
  if (normalizedEmail === session.user.email?.toLowerCase()) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'BAD_REQUEST', message: 'You cannot invite yourself', statusCode: 400 },
      } satisfies ApiError,
      { status: 400 }
    )
  }

  // Check if already an active member
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1)

  if (existingUser) {
    const [existingMember] = await db
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, existingUser.id)))
      .limit(1)

    if (existingMember) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: 'CONFLICT',
            message: 'This person is already a member of your organization',
            statusCode: 409,
          },
        } satisfies ApiError,
        { status: 409 }
      )
    }
  }

  // Atomic delete-then-insert (clears any prior invite for this org+email)
  const userId = session.user.id
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const invite = await db.transaction(async (tx) => {
    await tx
      .delete(orgInvites)
      .where(and(eq(orgInvites.orgId, org.id), eq(orgInvites.email, normalizedEmail)))
    const [row] = await tx
      .insert(orgInvites)
      .values({
        orgId: org.id,
        email: normalizedEmail,
        token,
        role,
        invitedBy: userId,
        expiresAt,
      })
      .returning()
    return row
  })

  if (!invite) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create invitation',
          statusCode: 500,
        },
      } satisfies ApiError,
      { status: 500 }
    )
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    undefined
  logAuditEvent(org.id, session.user.id, 'member.invited', {
    targetId: normalizedEmail,
    metadata: { role, inviteId: invite.id },
    ip,
  }).catch(() => {})

  // Send email non-blocking
  const APP_URL = process.env.NEXTAUTH_URL ?? 'https://sessionforge.dev'
  const acceptUrl = `${APP_URL}/invite/${token}`
  sendInviteEmail(
    normalizedEmail,
    session.user.name ?? session.user.email ?? null,
    org.name,
    acceptUrl
  ).catch((err) => {
    console.error('[POST /api/org/members] failed to send invite email:', err)
  })

  return NextResponse.json(
    {
      data: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt },
      error: null,
    },
    { status: 201 }
  )
}
