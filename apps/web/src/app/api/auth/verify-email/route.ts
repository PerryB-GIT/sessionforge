import { NextRequest, NextResponse } from 'next/server'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/db'
import { users, verificationTokens } from '@/db/schema'

const APP_URL = process.env.NEXTAUTH_URL ?? 'https://sessionforge.dev'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(`${APP_URL}/auth/verify?error=missing_token`)
  }

  // Look up the token — must exist and not be expired
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
    return NextResponse.redirect(`${APP_URL}/auth/verify?error=invalid_token`)
  }

  // Mark user as verified
  await db
    .update(users)
    .set({ emailVerified: new Date() })
    .where(eq(users.email, record.identifier))

  // Delete the used token
  await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, record.identifier),
        eq(verificationTokens.token, token)
      )
    )

  return NextResponse.redirect(`${APP_URL}/auth/verify?success=true`)
}
