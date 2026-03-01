import { NextResponse } from 'next/server'
import { eq, and, gt } from 'drizzle-orm'
import { Resend } from 'resend'
import { auth } from '@/lib/auth'
import { db, users, verificationTokens } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

// ─── POST /api/auth/resend-verification ────────────────────────────────────────
// Re-sends the email verification link for the currently authenticated user.

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  if (!user) {
    return NextResponse.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'User not found', statusCode: 404 } } satisfies ApiError,
      { status: 404 }
    )
  }

  if (user.emailVerified) {
    return NextResponse.json(
      { data: null, error: { code: 'ALREADY_VERIFIED', message: 'Email is already verified', statusCode: 400 } } satisfies ApiError,
      { status: 400 }
    )
  }

  // Rate-limit: if a valid (unexpired) token already exists, don't send another
  const [existing] = await db
    .select({ token: verificationTokens.token })
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, user.email),
        gt(verificationTokens.expires, new Date())
      )
    )
    .limit(1)

  let token: string

  if (existing) {
    token = existing.token
  } else {
    // Delete stale tokens and create a fresh one
    await db.delete(verificationTokens).where(eq(verificationTokens.identifier, user.email))
    token = crypto.randomUUID()
    await db.insert(verificationTokens).values({
      identifier: user.email,
      token,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
  }

  const appUrl = process.env.NEXTAUTH_URL ?? 'https://sessionforge.dev'
  const verifyUrl = `${appUrl}/api/auth/verify-email?token=${token}&email=${encodeURIComponent(user.email)}`
  const displayName = user.name ?? user.email

  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? 'noreply@sessionforge.dev',
    to: user.email,
    subject: 'Verify your SessionForge account',
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;padding:40px 0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#18181b;border:1px solid #27272a;border-radius:12px;overflow:hidden">
        <tr>
          <td style="padding:32px 40px 24px;border-bottom:1px solid #27272a">
            <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">Session<span style="color:#8b5cf6">Forge</span></span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px">
            <p style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff">Verify your email</p>
            <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;line-height:1.6">
              Hi ${displayName}, click the button below to verify your email address and get started.
            </p>
            <a href="${verifyUrl}"
               style="display:block;text-align:center;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;margin-bottom:24px">
              Verify Email Address
            </a>
            <p style="margin:0;font-size:12px;color:#52525b;line-height:1.6">
              This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #27272a">
            <p style="margin:0;font-size:12px;color:#3f3f46">SessionForge LLC</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })

  return NextResponse.json({ data: { sent: true }, error: null } satisfies ApiResponse<{ sent: boolean }>)
}
