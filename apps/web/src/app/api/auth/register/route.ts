import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, users } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).max(255).optional(),
})

export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<{ userId: string }> | ApiError>> {
  try {
    const body = await req.json()
    const parsed = registerSchema.safeParse(body)

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

    const { email, password, name } = parsed.data
    const normalizedEmail = email.toLowerCase()

    // Check for existing user
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1)

    if (existing) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: 'EMAIL_IN_USE',
            message: 'An account with this email already exists',
            statusCode: 409,
          },
        } satisfies ApiError,
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const [newUser] = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        passwordHash,
        name: name ?? null,
        plan: 'free',
      })
      .returning({ id: users.id })

    if (!newUser) {
      throw new Error('Failed to create user')
    }

    // STUB: Send verification email via Resend
    // await resend.emails.send({
    //   from: process.env.EMAIL_FROM,
    //   to: normalizedEmail,
    //   subject: 'Verify your SessionForge account',
    //   html: buildVerifyEmailTemplate(verifyToken),
    // })

    return NextResponse.json(
      {
        data: { userId: newUser.id },
        error: null,
      } satisfies ApiResponse<{ userId: string }>,
      { status: 201 }
    )
  } catch (err) {
    console.error('[register] unexpected error:', err)
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
