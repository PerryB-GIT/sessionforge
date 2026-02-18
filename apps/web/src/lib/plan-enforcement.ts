import { eq, count, and } from 'drizzle-orm'
import { db, users, machines, sessions, orgMembers } from '@/db'
import { PLAN_LIMITS, isFeatureAvailable } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'

export class PlanLimitError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly limit: number,
    public readonly current: number,
    public readonly requiredPlan?: PlanTier
  ) {
    super(message)
    this.name = 'PlanLimitError'
  }
}

export class FeatureNotAvailableError extends Error {
  constructor(
    message: string,
    public readonly feature: string,
    public readonly requiredPlan: PlanTier
  ) {
    super(message)
    this.name = 'FeatureNotAvailableError'
  }
}

/**
 * Retrieves the effective plan for a user.
 * If the user belongs to an org, the org plan may apply (future: highest plan wins).
 */
export async function getPlanForUser(userId: string): Promise<PlanTier> {
  const [user] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  return (user?.plan ?? 'free') as PlanTier
}

/**
 * Throws PlanLimitError if the user has reached their machine limit.
 */
export async function checkMachineLimit(userId: string): Promise<void> {
  const plan = await getPlanForUser(userId)
  const limits = PLAN_LIMITS[plan]

  if (limits.machines === -1) return // unlimited

  const [result] = await db
    .select({ count: count() })
    .from(machines)
    .where(eq(machines.userId, userId))

  const current = result?.count ?? 0

  if (current >= limits.machines) {
    throw new PlanLimitError(
      `Your ${plan} plan allows a maximum of ${limits.machines} machine${limits.machines === 1 ? '' : 's'}. ` +
        `You currently have ${current}. Upgrade your plan to add more.`,
      'MACHINE_LIMIT_EXCEEDED',
      limits.machines,
      current,
      plan === 'free' ? 'pro' : plan === 'pro' ? 'team' : 'enterprise'
    )
  }
}

/**
 * Throws PlanLimitError if the user has too many concurrent running sessions.
 * Note: The free plan allows 3 total sessions (not concurrent), so we count all non-stopped sessions.
 */
export async function checkSessionLimit(userId: string): Promise<void> {
  const plan = await getPlanForUser(userId)
  const limits = PLAN_LIMITS[plan]

  if (limits.sessions === -1) return // unlimited

  const [result] = await db
    .select({ count: count() })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.status, 'running')
      )
    )

  const current = result?.count ?? 0

  if (current >= limits.sessions) {
    throw new PlanLimitError(
      `Your ${plan} plan allows a maximum of ${limits.sessions} concurrent session${(limits.sessions as number) === 1 ? '' : 's'}. ` +
        `You currently have ${current} running. Stop a session or upgrade your plan.`,
      'SESSION_LIMIT_EXCEEDED',
      limits.sessions,
      current,
      plan === 'free' ? 'pro' : 'team'
    )
  }
}

/**
 * Throws FeatureNotAvailableError if the user's plan does not include the given feature.
 */
export async function requireFeature(userId: string, feature: string): Promise<void> {
  const plan = await getPlanForUser(userId)

  if (!isFeatureAvailable(plan, feature)) {
    // Determine minimum required plan
    let requiredPlan: PlanTier = 'enterprise'
    const checkPlans: PlanTier[] = ['pro', 'team', 'enterprise']
    for (const tier of checkPlans) {
      if (isFeatureAvailable(tier, feature)) {
        requiredPlan = tier
        break
      }
    }

    throw new FeatureNotAvailableError(
      `The "${feature}" feature requires the ${requiredPlan} plan. Your current plan is ${plan}.`,
      feature,
      requiredPlan
    )
  }
}
