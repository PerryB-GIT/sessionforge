export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { auth } from '@/lib/auth'
import { db, users } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

// ─── GET /api/user ─────────────────────────────────────────────────────────────

export async function GET() {
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
}

// ─── PATCH /api/user ───────────────────────────────────────────────────────────

const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(255).optional(),
  email: z.string().email('Invalid email').max(255).optional(),
})

export async function PATCH(req: NextRequest) {
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
}

// ─── POST /api/user/change-password is in /api/user/change-password/route.ts ──
