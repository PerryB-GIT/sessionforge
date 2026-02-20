import { Resend } from 'resend'

const FROM = process.env.EMAIL_FROM ?? 'noreply@sessionforge.dev'
const APP_URL = process.env.NEXTAUTH_URL ?? 'https://sessionforge.dev'

export async function sendVerificationEmail(to: string, name: string | null, token: string) {
  const resend = new Resend(process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY)
  const verifyUrl = `${APP_URL}/verify-email?token=${token}`
  const displayName = name ?? to

  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Verify your SessionForge email',
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0f0f14;border:1px solid #1e1e2e;border-radius:12px;overflow:hidden">
        <tr>
          <td style="padding:32px 40px 24px;border-bottom:1px solid #1e1e2e">
            <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">Session<span style="color:#8b5cf6">Forge</span></span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px">
            <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#ffffff">Verify your email</p>
            <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6">
              Hi ${displayName}, click the button below to verify your email address.
            </p>
            <a href="${verifyUrl}"
               style="display:inline-block;padding:12px 28px;background:#7c3aed;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">
              Verify Email
            </a>
            <p style="margin:24px 0 0;font-size:13px;color:#6b7280;line-height:1.6">
              This link expires in 24 hours. If you did not create an account, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #1e1e2e">
            <p style="margin:0;font-size:12px;color:#4b5563">
              SessionForge LLC \xb7 You're receiving this because you signed up for SessionForge.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}

export async function sendPasswordResetEmail(to: string, name: string | null, token: string) {
  const resend = new Resend(process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY)
  const resetUrl = `${APP_URL}/reset-password?token=${token}`
  const displayName = name ?? to

  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Reset your SessionForge password',
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0f0f14;border:1px solid #1e1e2e;border-radius:12px;overflow:hidden">
        <tr>
          <td style="padding:32px 40px 24px;border-bottom:1px solid #1e1e2e">
            <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">Session<span style="color:#8b5cf6">Forge</span></span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px">
            <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#ffffff">Reset your password</p>
            <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6">
              Hi ${displayName}, we received a request to reset the password for your SessionForge account.
              Click the button below to choose a new password.
            </p>
            <a href="${resetUrl}"
               style="display:inline-block;padding:12px 28px;background:#7c3aed;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">
              Reset Password
            </a>
            <p style="margin:24px 0 0;font-size:13px;color:#6b7280;line-height:1.6">
              This link expires in 60 minutes. If you didn't request a password reset, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #1e1e2e">
            <p style="margin:0;font-size:12px;color:#4b5563">
              SessionForge LLC \xb7 You're receiving this because a password reset was requested for your account.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}
