import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, users, passwordResetTokens } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

const forgotSchema = z.object({
  email: z.string().email('Invalid email address'),
})

const RESET_TOKEN_TTL_MINUTES = 60

export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<{ message: string }> | ApiError>> {
  try {
    const body = await req.json()
    const parsed = forgotSchema.safeParse(body)

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

    const normalizedEmail = parsed.data.email.toLowerCase()

    // Always return success to prevent email enumeration
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1)

    if (user) {
      const token = randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000)

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        token,
        expiresAt,
      })

      // STUB: Send password reset email via Resend
      // const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password?token=${token}`
      // await resend.emails.send({
      //   from: process.env.EMAIL_FROM,
      //   to: user.email,
      //   subject: 'Reset your SessionForge password',
      //   html: buildPasswordResetTemplate(user.name, resetUrl),
      // })
    }

    return NextResponse.json(
      {
        data: { message: 'If an account exists with this email, a reset link has been sent.' },
        error: null,
      } satisfies ApiResponse<{ message: string }>,
      { status: 200 }
    )
  } catch (err) {
    console.error('[forgot-password] unexpected error:', err)
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
