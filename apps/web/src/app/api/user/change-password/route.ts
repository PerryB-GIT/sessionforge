export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { auth } from '@/lib/auth'
import { db, users } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

const schema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Invalid input', statusCode: 400 } } satisfies ApiError,
      { status: 400 }
    )
  }

  const { currentPassword, newPassword } = parsed.data

  // Fetch current password hash
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  if (!user) {
    return NextResponse.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'User not found', statusCode: 404 } } satisfies ApiError,
      { status: 404 }
    )
  }

  // OAuth-only accounts have no password
  if (!user.passwordHash) {
    return NextResponse.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'Your account uses social login — no password to change', statusCode: 400 } } satisfies ApiError,
      { status: 400 }
    )
  }

  const matches = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!matches) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Current password is incorrect', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  const newHash = await bcrypt.hash(newPassword, 12)

  await db
    .update(users)
    .set({ passwordHash: newHash })
    .where(eq(users.id, session.user.id))

  return NextResponse.json({ data: { success: true }, error: null } satisfies ApiResponse<{ success: boolean }>)
}
