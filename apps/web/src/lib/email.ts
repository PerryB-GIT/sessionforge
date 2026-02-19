import { Resend } from 'resend'

const FROM = process.env.EMAIL_FROM ?? 'noreply@sessionforge.dev'
const APP_URL = process.env.NEXTAUTH_URL ?? 'https://sessionforge.dev'
const PERRY_EMAIL = process.env.PERRY_EMAIL ?? 'perry.bailes@gmail.com'

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
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0f0f14;border:1px solid #1e1e2e;border-radius:12px;overflow:hidden">
        <!-- Header -->
        <tr>
          <td style="padding:32px 40px 24px;border-bottom:1px solid #1e1e2e">
            <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">Session<span style="color:#8b5cf6">Forge</span></span>
          </td>
        </tr>
        <!-- Body -->
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
              This link expires in 60 minutes. If you didn't request a password reset, you can safely ignore this email — your password won't change.
            </p>
            <p style="margin:16px 0 0;font-size:12px;color:#4b5563;word-break:break-all">
              Or copy this link: <a href="${resetUrl}" style="color:#8b5cf6">${resetUrl}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #1e1e2e">
            <p style="margin:0;font-size:12px;color:#4b5563">
              SessionForge LLC · You're receiving this because a password reset was requested for your account.
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

export async function sendSupportReviewEmail(
  ticket: { id: string; subject: string; message: string; agentLogs: string | null; browserLogs: string | null; aiDraft: string | null; approvalToken: string | null },
  userName: string | null,
  userEmail: string,
) {
  const resend = new Resend(process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY)
  const approveUrl = `${APP_URL}/api/support/approve/${ticket.approvalToken}`
  const editUrl = `${APP_URL}/dashboard/support/${ticket.id}`
  const displayName = userName ?? userEmail

  const logSummary = [
    ticket.agentLogs ? `**Agent Logs:**\n\`\`\`\n${ticket.agentLogs.slice(0, 2000)}\n\`\`\`` : '',
    ticket.browserLogs ? `**Browser Errors:**\n\`\`\`\n${ticket.browserLogs.slice(0, 1000)}\n\`\`\`` : '',
  ].filter(Boolean).join('\n\n') || 'No logs attached.'

  await resend.emails.send({
    from: FROM,
    to: PERRY_EMAIL,
    subject: `[Support Review] ${ticket.subject} — from ${displayName}`,
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#0f0f14;border:1px solid #1e1e2e;border-radius:12px;overflow:hidden">
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid #1e1e2e;background:#111118">
            <span style="font-size:18px;font-weight:700;color:#ffffff">Session<span style="color:#8b5cf6">Forge</span></span>
            <span style="margin-left:12px;font-size:12px;color:#9ca3af;background:#1e1e2e;padding:3px 8px;border-radius:4px">Support Review</span>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px">
            <p style="margin:0 0 4px;font-size:20px;font-weight:600;color:#ffffff">${ticket.subject}</p>
            <p style="margin:0 0 20px;font-size:13px;color:#6b7280">From: ${displayName} &lt;${userEmail}&gt;</p>

            <div style="background:#0a0a0f;border:1px solid #1e1e2e;border-radius:8px;padding:16px;margin-bottom:20px">
              <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Client Message</p>
              <p style="margin:0;font-size:14px;color:#d1d5db;line-height:1.6">${ticket.message}</p>
            </div>

            <div style="background:#0a0a0f;border:1px solid #1e1e2e;border-radius:8px;padding:16px;margin-bottom:20px">
              <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">AI Draft Response</p>
              <p style="margin:0;font-size:14px;color:#d1d5db;line-height:1.6;white-space:pre-wrap">${ticket.aiDraft ?? 'No draft generated.'}</p>
            </div>

            ${logSummary !== 'No logs attached.' ? `
            <div style="background:#0a0a0f;border:1px solid #1e1e2e;border-radius:8px;padding:16px;margin-bottom:20px">
              <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Debug Logs</p>
              <pre style="margin:0;font-size:11px;color:#9ca3af;overflow-x:auto;white-space:pre-wrap">${(ticket.agentLogs ?? '').slice(0, 2000)}${ticket.browserLogs ? '\n\n[Browser]\n' + ticket.browserLogs.slice(0, 800) : ''}</pre>
            </div>` : ''}

            <table cellpadding="0" cellspacing="0" style="margin-top:8px">
              <tr>
                <td style="padding-right:12px">
                  <a href="${approveUrl}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">
                    Approve &amp; Send to Client
                  </a>
                </td>
                <td>
                  <a href="${editUrl}" style="display:inline-block;padding:12px 24px;background:#1e1e2e;color:#d1d5db;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;border:1px solid #2d2d3e">
                    Edit in Dashboard
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #1e1e2e">
            <p style="margin:0;font-size:11px;color:#4b5563">Ticket ID: ${ticket.id} · SessionForge Support System</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}

export async function sendSupportResponseEmail(
  to: string,
  name: string | null,
  draftBody: string,
) {
  const resend = new Resend(process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY)
  const displayName = name ?? to

  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Re: Your SessionForge support request',
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
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
            <p style="margin:0 0 20px;font-size:14px;color:#9ca3af">Hi ${displayName},</p>
            <div style="font-size:14px;color:#d1d5db;line-height:1.7;white-space:pre-wrap">${draftBody}</div>
            <p style="margin:24px 0 0;font-size:13px;color:#6b7280">
              — The SessionForge Support Team
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #1e1e2e">
            <p style="margin:0;font-size:12px;color:#4b5563">SessionForge LLC · This is a response to your support request.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}
