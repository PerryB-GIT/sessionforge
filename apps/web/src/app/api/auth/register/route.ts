import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { Resend } from 'resend'
import { db, users, verificationTokens } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

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

    // Generate verification token (NextAuth verificationTokens table)
    const token = crypto.randomUUID()
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    await db.insert(verificationTokens).values({
      identifier: normalizedEmail,
      token,
      expires,
    })

    // Send verification email via Resend
    const resend = new Resend(process.env.RESEND_API_KEY)
    const appUrl = process.env.NEXTAUTH_URL ?? 'https://sessionforge.dev'
    const verifyUrl = `${appUrl}/api/auth/verify-email?token=${token}&email=${encodeURIComponent(normalizedEmail)}`

    await resend.emails.send({
      from: process.env.EMAIL_FROM ?? 'noreply@sessionforge.dev',
      to: normalizedEmail,
      subject: 'Verify your SessionForge account',
      html: `
        <!DOCTYPE html>
        <html>
          <head><meta charset="utf-8"></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #09090b; color: #e4e4e7; margin: 0; padding: 40px 20px;">
            <div style="max-width: 480px; margin: 0 auto; background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 40px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <div style="font-size: 24px; font-weight: 700; color: #fff; letter-spacing: -0.5px;">SessionForge</div>
                <div style="font-size: 12px; color: #71717a; margin-top: 4px;">Remote AI Session Management</div>
              </div>
              <h1 style="font-size: 20px; font-weight: 600; color: #fff; margin: 0 0 12px;">Verify your email</h1>
              <p style="font-size: 14px; color: #a1a1aa; line-height: 1.6; margin: 0 0 24px;">
                Hi${name ? ` ${name}` : ''}, thanks for signing up! Click the button below to verify your email address and get started.
              </p>
              <a href="${verifyUrl}" style="display: block; text-align: center; background: #7c3aed; color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 8px; margin-bottom: 24px;">
                Verify Email Address
              </a>
              <p style="font-size: 12px; color: #52525b; margin: 0;">
                This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
              </p>
            </div>
          </body>
        </html>
      `,
    })

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
