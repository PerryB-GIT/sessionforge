import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { users, passwordResetTokens } from '@/db/schema'
import { eq } from 'drizzle-orm'
import crypto from 'crypto'
import { sendPasswordResetEmail } from '@/lib/email'

const RATE_LIMIT_REQUESTS = 3
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email required' }, { status: 400 })
    }

    // Redis rate limit: 3 requests per email per hour
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN
    if (redisUrl && redisToken) {
      const { Ratelimit } = await import('@upstash/ratelimit')
      const { Redis } = await import('@upstash/redis')
      const ratelimit = new Ratelimit({
        redis: new Redis({ url: redisUrl, token: redisToken }),
        limiter: Ratelimit.slidingWindow(RATE_LIMIT_REQUESTS, `${RATE_LIMIT_WINDOW_MS}ms`),
        prefix: 'rl:forgot-password',
      })
      const { success } = await ratelimit.limit(email.toLowerCase().trim())
      if (!success) {
        return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
      }
    }

    // Always return 200 to prevent email enumeration
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1)
    if (!user) {
      return NextResponse.json({ ok: true })
    }

    // Users who signed up via OAuth have no password — skip reset for them
    if (!user.passwordHash) {
      return NextResponse.json({ ok: true })
    }

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await db.insert(passwordResetTokens).values({
      userId: user.id,
      token,
      expiresAt,
    })

    await sendPasswordResetEmail(email, user.name, token)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[forgot-password]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
