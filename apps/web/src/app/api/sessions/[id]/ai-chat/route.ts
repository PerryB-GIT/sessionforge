export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, sessions, machines } from '@/db'
import { redis, RedisKeys } from '@/lib/redis'
import { decodeLogsForLlm } from '@/lib/ansi-strip'

// ─── POST /api/sessions/:id/ai-chat ──────────────────────────────────────────
// Returns a JSON response from Claude Haiku with terminal context baked in.
// Note: SSE streaming is not used here because Cloud Run buffers responses;
// a single JSON response is more reliable in this environment.

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Guard: ANTHROPIC_API_KEY must be configured
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Billing is not configured' }, { status: 503 })
  }

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: { message?: string; contextLines?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { message, contextLines = 100 } = body
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  // Verify session ownership and load session metadata
  const [sessionRecord] = await db
    .select({
      id: sessions.id,
      processName: sessions.processName,
      workdir: sessions.workdir,
      machineId: sessions.machineId,
      userId: sessions.userId,
    })
    .from(sessions)
    .where(and(eq(sessions.id, params.id), eq(sessions.userId, session.user.id)))
    .limit(1)

  if (!sessionRecord) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Load machine OS for context
  let machineOs = 'linux'
  if (sessionRecord.machineId) {
    const [machine] = await db
      .select({ os: machines.os })
      .from(machines)
      .where(eq(machines.id, sessionRecord.machineId))
      .limit(1)
    if (machine?.os) machineOs = machine.os
  }

  // Fetch recent terminal output from Redis ring buffer
  const logKey = RedisKeys.sessionLogs(params.id)
  const rawLines = await redis.lrange(logKey, -contextLines, -1)
  const terminalContext = decodeLogsForLlm(rawLines as string[], contextLines)

  const systemPrompt = [
    `You are an expert terminal assistant embedded inside SessionForge, a Claude Code session manager.`,
    ``,
    `Session context:`,
    `- Process: ${sessionRecord.processName}`,
    `- OS: ${machineOs}`,
    `- Working directory: ${sessionRecord.workdir ?? 'unknown'}`,
    ``,
    terminalContext.length > 0
      ? `Recent terminal output (last ${contextLines} non-empty lines):\n\`\`\`\n${terminalContext}\n\`\`\``
      : `No terminal output available yet.`,
    ``,
    `Respond ONLY with valid JSON in this exact format (no markdown, no preamble):`,
    `{"reply": "<your explanation or answer>", "suggestedCommand": "<optional single command or empty string>"}`,
    ``,
    `Rules:`,
    `- reply: clear, concise explanation (1-3 sentences max)`,
    `- suggestedCommand: a single shell command the user can run, or "" if not applicable`,
    `- Never suggest destructive commands (rm -rf, format, etc.) without a warning in reply`,
  ].join('\n')

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''

    // Try to parse as JSON; fall back to wrapping raw text
    try {
      const parsed = JSON.parse(text) as { reply?: string; suggestedCommand?: string }
      return NextResponse.json({
        reply: parsed.reply ?? text,
        suggestedCommand: parsed.suggestedCommand ?? '',
      })
    } catch {
      return NextResponse.json({ reply: text, suggestedCommand: '' })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ai-chat] Anthropic error:', msg)
    return NextResponse.json({ error: 'AI service error', detail: msg }, { status: 500 })
  }
}
