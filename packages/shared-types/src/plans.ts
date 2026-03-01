export type PlanTier = 'free' | 'pro' | 'team' | 'enterprise'

export const PLAN_LIMITS = {
  free: {
    machines: 1,
    sessions: 3,
    seats: 1,
    historyDays: 1,
    storageGB: 0.5,
  },
  pro: {
    machines: 5,
    sessions: -1, // unlimited
    seats: 1,
    historyDays: 30,
    storageGB: 10,
  },
  team: {
    machines: 20,
    sessions: -1,
    seats: 10,
    historyDays: 90,
    storageGB: 50,
  },
  enterprise: {
    machines: -1,
    sessions: -1,
    seats: -1,
    historyDays: 365,
    storageGB: -1, // unlimited
  },
} as const

export const PLAN_PRICES = {
  free: 0,
  pro: 19,
  team: 49,
  enterprise: 199,
} as const

export function isFeatureAvailable(plan: PlanTier, feature: string): boolean {
  const enterpriseOnly = ['sso', 'audit_log', 'session_recording', 'custom_branding', 'ip_allowlist']
  const teamAndAbove = ['rbac', 'team_invites', 'shared_sessions']
  const proAndAbove = ['webhooks', 'api_access', 'priority_support']

  if (enterpriseOnly.includes(feature)) return plan === 'enterprise'
  if (teamAndAbove.includes(feature)) return plan === 'team' || plan === 'enterprise'
  if (proAndAbove.includes(feature)) return plan !== 'free'
  return true
}
