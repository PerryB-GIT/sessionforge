import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, users, supportTickets, machines } from '@/db'
import { eq, desc } from 'drizzle-orm'
import { sendSupportReviewEmail } from '@/lib/email'
import { z } from 'zod'

const submitSchema = z.object({
  subject: z.string().min(1).max(255),
  message: z.string().min(1).max(5000),
  agentLogs: z.string().max(20000).optional(),
  browserLogs: z.string().max(5000).optional(),
  machineId: z.string().uuid().optional(),
})

const PERRY_REVIEW_ENABLED =
  process.env.NODE_ENV === 'production' && process.env.SUPPORT_PERRY_REVIEW !== 'false'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = submitSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { subject, message, agentLogs, browserLogs, machineId } = parsed.data

  // Fetch user details
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Call Claude API to draft a response
  let aiDraft: string | null = null
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (anthropicKey) {
      const logContext = [
        agentLogs ? `Agent logs:\n${agentLogs.slice(0, 3000)}` : '',
        browserLogs ? `Browser errors:\n${browserLogs.slice(0, 1000)}` : '',
      ].filter(Boolean).join('\n\n')

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          system: `You are a helpful SessionForge support engineer. SessionForge is a SaaS that lets developers manage Claude Code sessions remotely. Analyze the user's support request and any attached logs, then draft a concise, friendly, and actionable response. Be specific about what might be causing the issue and what steps to try. Keep the response under 300 words.`,
          messages: [
            {
              role: 'user',
              content: `Support request:\n\nSubject: ${subject}\n\nMessage: ${message}${logContext ? '\n\n' + logContext : ''}`,
            },
          ],
        }),
      })

      if (response.ok) {
        const data = await response.json()
        aiDraft = data.content?.[0]?.text ?? null
      }
    }
  } catch (err) {
    console.error('[Support] Claude API error:', err)
  }

  // Generate approval token
  const approvalToken = crypto.randomUUID() + '-' + crypto.randomUUID()

  // Insert ticket
  const [ticket] = await db
    .insert(supportTickets)
    .values({
      userId: user.id,
      machineId: machineId ?? null,
      subject,
      message,
      agentLogs: agentLogs ?? null,
      browserLogs: browserLogs ?? null,
      aiDraft,
      approvalToken,
      status: 'pending',
    })
    .returning()

  if (PERRY_REVIEW_ENABLED) {
    try {
      await sendSupportReviewEmail(ticket, user.name, user.email)
    } catch (err) {
      console.error('[Support] Failed to send Perry review email:', err)
    }
  } else {
    console.log('[Support Debug] Ticket created:', ticket.id)
    console.log('[Support Debug] AI Draft:', aiDraft)
    console.log('[Support Debug] Approve URL:', `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/support/approve/${approvalToken}`)
  }

  return NextResponse.json({
    ticketId: ticket.id,
    message: 'Support request submitted. Our team will review and respond shortly.',
  })
}
