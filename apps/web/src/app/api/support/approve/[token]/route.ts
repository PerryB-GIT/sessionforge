import { NextRequest, NextResponse } from 'next/server'
import { db, supportTickets, users } from '@/db'
import { eq } from 'drizzle-orm'
import { sendSupportResponseEmail } from '@/lib/email'

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const { token } = params

  if (!token) {
    return new NextResponse(errorHtml('Invalid approval link.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const [ticket] = await db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.approvalToken, token))
    .limit(1)

  if (!ticket) {
    return new NextResponse(errorHtml('Approval link not found or already used.'), {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  if (ticket.status === 'approved' || ticket.approvedAt) {
    return new NextResponse(errorHtml('This support response has already been sent.'), {
      status: 409,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  if (!ticket.aiDraft) {
    return new NextResponse(errorHtml('No draft response found for this ticket.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  // Fetch user email
  const [user] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, ticket.userId))
    .limit(1)

  if (!user) {
    return new NextResponse(errorHtml('User not found.'), {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  // Mark approved
  await db
    .update(supportTickets)
    .set({ status: 'approved', approvedAt: new Date() })
    .where(eq(supportTickets.id, ticket.id))

  // Send response to client
  try {
    await sendSupportResponseEmail(user.email, user.name, ticket.aiDraft)
  } catch (err) {
    console.error('[Support] Failed to send client response email:', err)
    return new NextResponse(errorHtml('Response approved but failed to send email. Check logs.'), {
      status: 500,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  return new NextResponse(successHtml(user.email, ticket.subject), {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  })
}

function successHtml(clientEmail: string, subject: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Response Sent — SessionForge</title></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
  <div style="text-align:center;padding:40px;background:#0f0f14;border:1px solid #1e1e2e;border-radius:16px;max-width:480px">
    <div style="font-size:48px;margin-bottom:16px">✅</div>
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#ffffff">Response Sent</h1>
    <p style="margin:0 0 8px;font-size:14px;color:#9ca3af">Your response to <strong style="color:#d1d5db">${subject}</strong></p>
    <p style="margin:0 0 24px;font-size:14px;color:#9ca3af">has been sent to <strong style="color:#d1d5db">${clientEmail}</strong>.</p>
    <a href="https://sessionforge.dev/dashboard" style="display:inline-block;padding:10px 24px;background:#7c3aed;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">Back to Dashboard</a>
  </div>
</body>
</html>`
}

function errorHtml(message: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Error — SessionForge</title></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
  <div style="text-align:center;padding:40px;background:#0f0f14;border:1px solid #1e1e2e;border-radius:16px;max-width:480px">
    <div style="font-size:48px;margin-bottom:16px">⚠️</div>
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#ffffff">Something went wrong</h1>
    <p style="margin:0 0 24px;font-size:14px;color:#9ca3af">${message}</p>
    <a href="https://sessionforge.dev/dashboard" style="display:inline-block;padding:10px 24px;background:#1e1e2e;color:#d1d5db;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">Back to Dashboard</a>
  </div>
</body>
</html>`
}
