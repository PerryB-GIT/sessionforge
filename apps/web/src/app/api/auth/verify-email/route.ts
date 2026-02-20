import { NextRequest, NextResponse } from 'next/server'
import { and, eq, gt } from 'drizzle-orm'
import { db, users, verificationTokens } from '@/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/login?error=invalid-token', req.url))
  }

  try {
    // Find valid token — token alone identifies the record (no email param needed)
    const [record] = await db
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.token, token),
          gt(verificationTokens.expires, new Date())
        )
      )
      .limit(1)

    if (!record) {
      return NextResponse.redirect(new URL('/login?error=expired-token', req.url))
    }

    // Mark user as verified and delete token atomically
    await Promise.all([
      db
        .update(users)
        .set({ emailVerified: new Date() })
        .where(eq(users.email, record.identifier)),
      db
        .delete(verificationTokens)
        .where(
          and(
            eq(verificationTokens.identifier, record.identifier),
            eq(verificationTokens.token, token)
          )
        ),
    ])

    const appUrl = process.env.NEXTAUTH_URL ?? 'https://sessionforge.dev'
    return NextResponse.redirect(new URL('/login?verified=1', appUrl))
  } catch (err) {
    console.error('[verify-email] error:', err)
    return NextResponse.redirect(new URL('/login?error=server-error', req.url))
  }
}
