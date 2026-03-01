export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, and, not } from 'drizzle-orm'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import Stripe from 'stripe'
import { auth } from '@/lib/auth'
import { db, users, organizations, orgMembers } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

// ─── GET /api/user ─────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } } satisfies ApiError,
        { status: 401 }
      )
    }

    const [user] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1)

    if (!user) {
      return NextResponse.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'User not found', statusCode: 404 } } satisfies ApiError,
        { status: 404 }
      )
    }

    return NextResponse.json({ data: user, error: null } satisfies ApiResponse<typeof user>)
  } catch (err) {
    console.error('[GET /api/user] unhandled error:', err)
    return NextResponse.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unknown error', statusCode: 500 } },
      { status: 500 }
    )
  }
}

// ─── PATCH /api/user ───────────────────────────────────────────────────────────

const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(255).optional(),
  email: z.string().email('Invalid email').max(255).optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } } satisfies ApiError,
        { status: 401 }
      )
    }

    const body = await req.json()
    const parsed = updateProfileSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Invalid input', statusCode: 400 } } satisfies ApiError,
        { status: 400 }
      )
    }

    const { name, email } = parsed.data

    // If changing email, check it's not taken by another user
    if (email) {
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1)

      if (existing && existing.id !== session.user.id) {
        return NextResponse.json(
          { data: null, error: { code: 'CONFLICT', message: 'Email already in use', statusCode: 409 } } satisfies ApiError,
          { status: 409 }
        )
      }
    }

    const updates: { name?: string; email?: string } = {}
    if (name !== undefined) updates.name = name
    if (email !== undefined) updates.email = email

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { data: null, error: { code: 'VALIDATION_ERROR', message: 'No fields to update', statusCode: 400 } } satisfies ApiError,
        { status: 400 }
      )
    }

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, session.user.id))
      .returning({ id: users.id, name: users.name, email: users.email })

    return NextResponse.json({ data: updated, error: null } satisfies ApiResponse<typeof updated>)
  } catch (err) {
    console.error('[PATCH /api/user] unhandled error:', err)
    return NextResponse.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unknown error', statusCode: 500 } },
      { status: 500 }
    )
  }
}

// ─── POST /api/user/change-password is in /api/user/change-password/route.ts ──

// ─── DELETE /api/user ──────────────────────────────────────────────────────────

export async function DELETE() {
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

  const userId = session.user.id

  try {
    // 1. Cancel Stripe subscription if one exists
    const [userRow] = await db
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (userRow?.stripeCustomerId) {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-04-10' })
        const subs = await stripe.subscriptions.list({
          customer: userRow.stripeCustomerId,
          status: 'active',
          limit: 1,
        })
        for (const sub of subs.data) {
          await stripe.subscriptions.cancel(sub.id)
        }
      } catch (stripeErr) {
        console.error('[DELETE /api/user] Stripe cancel failed:', stripeErr)
      }
    }

    // 2. Delete orgs where user is the sole owner
    const ownedOrgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.ownerId, userId))

    for (const org of ownedOrgs) {
      const otherOwners = await db
        .select({ id: orgMembers.id })
        .from(orgMembers)
        .where(
          and(
            eq(orgMembers.orgId, org.id),
            eq(orgMembers.role, 'owner'),
            not(eq(orgMembers.userId, userId))
          )
        )
        .limit(1)

      if (otherOwners.length === 0) {
        await db.delete(organizations).where(eq(organizations.id, org.id))
      }
    }

    // 3. Delete user — cascade handles everything else
    await db.delete(users).where(eq(users.id, userId))

    return NextResponse.json({ data: { ok: true }, error: null })
  } catch (err) {
    console.error('[DELETE /api/user] error:', err)
    return NextResponse.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete account', statusCode: 500 },
      } satisfies ApiError,
      { status: 500 }
    )
  }
}
