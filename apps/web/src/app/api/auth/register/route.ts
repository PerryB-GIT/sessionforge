import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, users } from '@/db'
import { verificationTokens } from '@/db/schema'
import { sendVerificationEmail } from '@/lib/email'

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^a-zA-Z0-9]/, 'Password must contain at least one special character')
  .refine((p) => p.trim().length > 0, 'Password cannot be whitespace only')

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: passwordSchema,
  name: z.string().min(1).max(255).optional(),
})

const RATE_LIMIT_REQUESTS = 5
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export async function POST(req: NextRequest) {
  try {
    // Redis rate limit: 5 registrations per IP per hour
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN
    if (redisUrl && redisToken) {
      const { Ratelimit } = await import('@upstash/ratelimit')
      const { Redis } = await import('@upstash/redis')
      const ratelimit = new Ratelimit({
        redis: new Redis({ url: redisUrl, token: redisToken }),
        limiter: Ratelimit.slidingWindow(RATE_LIMIT_REQUESTS, `${RATE_LIMIT_WINDOW_MS}ms`),
        prefix: 'rl:register',
      })
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
      const { success } = await ratelimit.limit(ip)
      if (!success) {
        return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
      }
    }

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
        },
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
        { error: 'An account with this email already exists' },
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

    // Generate and store email verification token
    const token = randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    await db.insert(verificationTokens).values({
      identifier: normalizedEmail,
      token,
      expires,
    })

    // Send verification email — non-blocking, don't fail registration if this errors
    sendVerificationEmail(normalizedEmail, name ?? null, token).catch((err) => {
      console.error('[register] failed to send verification email:', err)
    })

    // In E2E test mode: return the verification token so the test runner can
    // verify the email without needing a real inbox. Gated by a secret header
    // so this is safe to ship to production.
    const testSecret = process.env.E2E_TEST_SECRET
    const isTestRequest =
      testSecret && req.headers.get('x-e2e-test-secret') === testSecret

    return NextResponse.json(
      {
        success: true,
        userId: newUser.id,
        ...(isTestRequest ? { verificationToken: token } : {}),
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('[register] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
