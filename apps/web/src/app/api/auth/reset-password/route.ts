import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { eq, and, isNull, gt } from 'drizzle-orm'
import { z } from 'zod'
import { db, users, passwordResetTokens } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<{ message: string }> | ApiError>> {
  try {
    const body = await req.json()
    const parsed = resetSchema.safeParse(body)

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

    const { token, password } = parsed.data
    const now = new Date()

    // Find valid, unused, non-expired token
    const [resetRecord] = await db
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
      })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.token, token),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now)
        )
      )
      .limit(1)

    if (!resetRecord) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: 'INVALID_TOKEN',
            message: 'This reset link is invalid or has expired',
            statusCode: 400,
          },
        } satisfies ApiError,
        { status: 400 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 12)

    // Update password and mark token as used in a transaction
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, resetRecord.userId))

      await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(eq(passwordResetTokens.id, resetRecord.id))
    })

    return NextResponse.json(
      {
        data: { message: 'Password has been reset successfully' },
        error: null,
      } satisfies ApiResponse<{ message: string }>,
      { status: 200 }
    )
  } catch (err) {
    console.error('[reset-password] unexpected error:', err)
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          statusCode: 500,
        },
      } satisfies ApiError,
      { status: 500 }
    )
  }
}
