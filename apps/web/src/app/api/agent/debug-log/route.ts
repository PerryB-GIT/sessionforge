export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, and, count, asc } from 'drizzle-orm'
import { z } from 'zod'
import { validateApiKey } from '@/lib/api-keys'
import { db, machines, machineDebugLogs } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

// ─── In-memory rate limiter (per machineId) ────────────────────────────────────

const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT_MAX = 100
const RATE_LIMIT_WINDOW_MS = 60_000

function isRateLimited(machineId: string): boolean {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const timestamps = (rateLimitMap.get(machineId) ?? []).filter((t) => t > windowStart)
  if (timestamps.length >= RATE_LIMIT_MAX) return true
  timestamps.push(now)
  rateLimitMap.set(machineId, timestamps)
  return false
}

// ─── Metadata sanitiser ────────────────────────────────────────────────────────

function stripApiKeys(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.includes('sf_live_') ? '[REDACTED]' : value
  }
  if (Array.isArray(value)) {
    return value.map(stripApiKeys)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripApiKeys(v)])
    )
  }
  return value
}

// ─── Validation ────────────────────────────────────────────────────────────────

const debugLogSchema = z.object({
  machineId: z.string().uuid(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  component: z.string().min(1).max(255),
  message: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  agentVersion: z.string().max(64).optional(),
})

// ─── POST /api/agent/debug-log ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer sf_live_')) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Invalid API key', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  const apiKeyRecord = await validateApiKey(authHeader.slice(7))
  if (!apiKeyRecord) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Invalid API key', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  const body = await req.json()
  const parsed = debugLogSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message ?? 'Invalid input',
          statusCode: 400,
        },
      } satisfies ApiError,
      { status: 400 }
    )
  }

  const { machineId, level, component, message, metadata, agentVersion } = parsed.data

  // Verify machine belongs to authenticated user
  const [machine] = await db
    .select({ id: machines.id })
    .from(machines)
    .where(and(eq(machines.id, machineId), eq(machines.userId, apiKeyRecord.userId)))
    .limit(1)

  if (!machine) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Machine not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  if (isRateLimited(machineId)) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many debug log requests',
          statusCode: 429,
        },
      } satisfies ApiError,
      { status: 429 }
    )
  }

  // Cap at 500 rows per machine — delete oldest 50 if at limit
  const [countResult] = await db
    .select({ count: count() })
    .from(machineDebugLogs)
    .where(eq(machineDebugLogs.machineId, machineId))

  if ((countResult?.count ?? 0) >= 500) {
    const oldest = await db
      .select({ id: machineDebugLogs.id })
      .from(machineDebugLogs)
      .where(eq(machineDebugLogs.machineId, machineId))
      .orderBy(asc(machineDebugLogs.createdAt))
      .limit(50)

    if (oldest.length > 0) {
      // Delete them one by one via in-clause equivalent
      for (const row of oldest) {
        await db.delete(machineDebugLogs).where(eq(machineDebugLogs.id, row.id))
      }
    }
  }

  const sanitisedMetadata = metadata ? (stripApiKeys(metadata) as Record<string, unknown>) : null

  const [inserted] = await db
    .insert(machineDebugLogs)
    .values({
      machineId,
      level,
      component,
      message,
      metadata: sanitisedMetadata,
      agentVersion: agentVersion ?? null,
    })
    .returning({ id: machineDebugLogs.id })

  return NextResponse.json(
    { data: { id: inserted?.id }, error: null } satisfies ApiResponse<{ id: string | undefined }>,
    { status: 201 }
  )
}
