export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, sessions } from '@/db'
import { redis, RedisKeys } from '@/lib/redis'
import Anthropic from '@anthropic-ai/sdk'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

interface SummaryResponse {
  summary: string | null
  reason?: string
  cachedAt: string
}

const SUMMARY_CACHE_TTL = 60 // seconds
const TAIL_LINES = 50

function summaryKey(sessionId: string) {
  return `summary:${sessionId}`
}

// ─── GET /api/sessions/:id/summary ────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authSession = await auth()
  if (!authSession?.user?.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  // Verify session ownership
  const [record] = await db
    .select({ id: sessions.id, status: sessions.status })
    .from(sessions)
    .where(and(eq(sessions.id, params.id), eq(sessions.userId, authSession.user.id)))
    .limit(1)

  if (!record) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Session not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  if (record.status !== 'running') {
    return NextResponse.json(
      {
        data: { summary: null, reason: 'Session not running', cachedAt: new Date().toISOString() },
        error: null,
      } satisfies ApiResponse<SummaryResponse>,
      { status: 200 }
    )
  }

  // Check Redis cache
  const cacheKey = summaryKey(params.id)
  const cached = await redis.get<string>(cacheKey)
  if (cached) {
    return NextResponse.json(
      {
        data: { summary: cached, cachedAt: new Date().toISOString() },
        error: null,
      } satisfies ApiResponse<SummaryResponse>,
      { status: 200 }
    )
  }

  // Get last 50 lines from ring buffer
  const logKey = RedisKeys.sessionLogs(params.id)
  const totalLines = await redis.llen(logKey)
  const start = Math.max(0, totalLines - TAIL_LINES)
  const rawLines = (await redis.lrange(logKey, start, -1)) as string[]

  if (rawLines.length === 0) {
    return NextResponse.json(
      {
        data: {
          summary: null,
          reason: 'No terminal output yet',
          cachedAt: new Date().toISOString(),
        },
        error: null,
      } satisfies ApiResponse<SummaryResponse>,
      { status: 200 }
    )
  }

  // Decode base64-encoded PTY chunks and strip ANSI escape codes
  const decoded = rawLines
    .map((line) => {
      try {
        return Buffer.from(line, 'base64').toString('utf-8')
      } catch {
        return line
      }
    })
    .join('')
    // Strip ANSI/VT100 escape sequences
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[mGKHFABCDJsuhl]/g, '')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, '')
    .trim()

  if (!decoded) {
    return NextResponse.json(
      {
        data: { summary: null, reason: 'No readable output', cachedAt: new Date().toISOString() },
        error: null,
      } satisfies ApiResponse<SummaryResponse>,
      { status: 200 }
    )
  }

  // Truncate to avoid large payloads
  const terminalOutput = decoded.slice(-3000)

  // Call Claude API
  const client = new Anthropic()
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: `Below is the recent terminal output from a Claude Code session. Summarize what Claude is currently working on in 1-2 sentences. Be specific about the task (e.g. "Refactoring the auth middleware to use JWT tokens" not "Writing code"). If the output is mostly noise/escape codes with no clear task, say "Analyzing output...". Output plain text only, no markdown.\n\n${terminalOutput}`,
      },
    ],
  })

  const summary = message.content[0]?.type === 'text' ? message.content[0].text.trim() : null

  // Cache in Redis for 60s
  if (summary) {
    await redis.set(cacheKey, summary, { ex: SUMMARY_CACHE_TTL })
  }

  return NextResponse.json(
    {
      data: { summary, cachedAt: new Date().toISOString() },
      error: null,
    } satisfies ApiResponse<SummaryResponse>,
    { status: 200 }
  )
}
