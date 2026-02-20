import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { users, passwordResetTokens } from '@/db/schema'
import { eq } from 'drizzle-orm'
import crypto from 'crypto'
import { sendPasswordResetEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email required' }, { status: 400 })
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
