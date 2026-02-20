import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { users, passwordResetTokens } from '@/db/schema'
import { eq, and, isNull, gt } from 'drizzle-orm'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json()
    if (!token || !password || typeof token !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'Token and password required' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const now = new Date()
    const [resetRecord] = await db
      .select()
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
      return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(password, 12)

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, resetRecord.userId))

      await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(eq(passwordResetTokens.id, resetRecord.id))
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[reset-password]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
