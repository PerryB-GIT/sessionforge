import { NextResponse } from 'next/server'
import { eq, count, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, users, machines, sessions, apiKeys } from '@/db'
import { PLAN_LIMITS } from '@sessionforge/shared-types'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

export interface UsageData {
  plan: PlanTier
  machines: { current: number; limit: number }
  sessions: { current: number; limit: number }
  apiKeys: { current: number }
}

// ─── GET /api/usage ────────────────────────────────────────────────────────────
// Returns current usage counts against plan limits for the authenticated user.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  const userId = session.user.id

  // Fetch plan + all counts in parallel
  const [[userRow], [machineCount], [sessionCount], [keyCount]] = await Promise.all([
    db.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1),
    db.select({ count: count() }).from(machines).where(eq(machines.userId, userId)),
    db.select({ count: count() }).from(sessions).where(
      and(eq(sessions.userId, userId), eq(sessions.status, 'running'))
    ),
    db.select({ count: count() }).from(apiKeys).where(eq(apiKeys.userId, userId)),
  ])

  const plan = (userRow?.plan ?? 'free') as PlanTier
  const limits = PLAN_LIMITS[plan]

  const data: UsageData = {
    plan,
    machines: { current: machineCount?.count ?? 0, limit: limits.machines },
    sessions: { current: sessionCount?.count ?? 0, limit: limits.sessions },
    apiKeys: { current: keyCount?.count ?? 0 },
  }

  return NextResponse.json({ data, error: null } satisfies ApiResponse<UsageData>)
}
