import { NextResponse } from 'next/server'
import { eq, count, and, gte } from 'drizzle-orm'
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
  agentHoursThisMonth: number
  sessionsThisMonth: number
  crashRateThisMonth: number
  avgSessionDurationMinutes: number
  byMachine: Array<{
    machineId: string
    machineName: string
    sessions: number
    hours: number
    lastActive: Date
  }>
}

// ─── GET /api/usage ────────────────────────────────────────────────────────────
// Returns current usage counts against plan limits for the authenticated user,
// plus monthly stats: agent hours, session count, crash rate, avg duration,
// and a per-machine breakdown.

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          data: null,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
        } satisfies ApiError,
        { status: 401 }
      )
    }

    const userId = session.user.id

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // Fetch plan + all counts in parallel, plus monthly sessions + machines list
    const [[userRow], [machineCount], [sessionCount], [keyCount], monthlySessions, userMachines] =
      await Promise.all([
        db.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1),
        db.select({ count: count() }).from(machines).where(eq(machines.userId, userId)),
        db
          .select({ count: count() })
          .from(sessions)
          .where(and(eq(sessions.userId, userId), eq(sessions.status, 'running'))),
        db.select({ count: count() }).from(apiKeys).where(eq(apiKeys.userId, userId)),
        db
          .select({
            machineId: sessions.machineId,
            status: sessions.status,
            startedAt: sessions.startedAt,
            stoppedAt: sessions.stoppedAt,
          })
          .from(sessions)
          .where(and(eq(sessions.userId, userId), gte(sessions.startedAt, monthStart))),
        db
          .select({ id: machines.id, name: machines.name })
          .from(machines)
          .where(eq(machines.userId, userId)),
      ])

    const plan = (userRow?.plan ?? 'free') as PlanTier
    const limits = PLAN_LIMITS[plan]

    // Build a machineId → name lookup
    const machineNameById = Object.fromEntries(userMachines.map((m) => [m.id, m.name]))

    // Compute monthly stats
    const agentHoursThisMonth = monthlySessions.reduce((acc, s) => {
      if (!s.stoppedAt) return acc
      const ms = new Date(s.stoppedAt).getTime() - new Date(s.startedAt).getTime()
      return acc + ms / (1000 * 60 * 60)
    }, 0)

    const sessionsThisMonth = monthlySessions.length
    const crashed = monthlySessions.filter((s) => s.status === 'crashed').length
    const crashRateThisMonth = sessionsThisMonth > 0 ? (crashed / sessionsThisMonth) * 100 : 0

    const completedSessions = monthlySessions.filter((s) => s.stoppedAt)
    const avgSessionDurationMinutes =
      completedSessions.length > 0
        ? completedSessions.reduce((acc, s) => {
            const ms = new Date(s.stoppedAt!).getTime() - new Date(s.startedAt).getTime()
            return acc + ms / (1000 * 60)
          }, 0) / completedSessions.length
        : 0

    // Per-machine breakdown
    const byMachineMap = monthlySessions.reduce(
      (acc, s) => {
        if (!acc[s.machineId]) {
          acc[s.machineId] = {
            machineId: s.machineId,
            machineName: machineNameById[s.machineId] ?? s.machineId,
            sessions: 0,
            hours: 0,
            lastActive: s.startedAt,
          }
        }
        acc[s.machineId].sessions++
        if (s.stoppedAt) {
          acc[s.machineId].hours +=
            (new Date(s.stoppedAt).getTime() - new Date(s.startedAt).getTime()) / (1000 * 60 * 60)
        }
        if (new Date(s.startedAt) > new Date(acc[s.machineId].lastActive)) {
          acc[s.machineId].lastActive = s.startedAt
        }
        return acc
      },
      {} as Record<
        string,
        {
          machineId: string
          machineName: string
          sessions: number
          hours: number
          lastActive: Date
        }
      >
    )

    const byMachine = Object.values(byMachineMap).sort((a, b) => b.hours - a.hours)

    const data: UsageData = {
      plan,
      machines: { current: machineCount?.count ?? 0, limit: limits.machines },
      sessions: { current: sessionCount?.count ?? 0, limit: limits.sessions },
      apiKeys: { current: keyCount?.count ?? 0 },
      agentHoursThisMonth,
      sessionsThisMonth,
      crashRateThisMonth,
      avgSessionDurationMinutes,
      byMachine,
    }

    return NextResponse.json({ data, error: null } satisfies ApiResponse<UsageData>)
  } catch (err) {
    console.error('[GET /api/usage] unhandled error:', err)
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error',
          statusCode: 500,
        },
      },
      { status: 500 }
    )
  }
}
