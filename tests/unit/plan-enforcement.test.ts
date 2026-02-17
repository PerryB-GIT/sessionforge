/**
 * Unit tests for plan enforcement utilities
 *
 * Tests the three core enforcement functions:
 *   - checkMachineLimit(plan, currentCount)   – blocks adding machines over plan limit
 *   - checkSessionLimit(plan, activeCount)     – blocks starting sessions over plan limit
 *   - requireFeature(plan, feature)            – throws if the feature is not on the plan
 *
 * STUB: The actual implementations are imported from the backend module once
 * the Backend agent builds them.  The import lines below are marked as stubs.
 *
 * The plan data is driven by PLAN_LIMITS and isFeatureAvailable from
 * @sessionforge/shared-types which is already built.
 */

import { describe, it, expect } from 'vitest'
import { PLAN_LIMITS, isFeatureAvailable, type PlanTier } from '@sessionforge/shared-types'

// STUB: import when backend builds [plan-enforcement module]
// import { checkMachineLimit, checkSessionLimit, requireFeature, PlanLimitError } from '@sessionforge/backend/lib/plan-enforcement'

// ---------------------------------------------------------------------------
// Inline stubs — replace with real imports once backend is built
// ---------------------------------------------------------------------------

class PlanLimitError extends Error {
  constructor(
    message: string,
    public limitType: 'machines' | 'sessions' | 'seats' | 'feature',
    public plan: PlanTier,
    public limit: number | null
  ) {
    super(message)
    this.name = 'PlanLimitError'
  }
}

function checkMachineLimit(plan: PlanTier, currentCount: number): void {
  const limit = PLAN_LIMITS[plan].machines
  if (limit === -1) return // unlimited
  if (currentCount >= limit) {
    throw new PlanLimitError(
      `Your ${plan} plan allows a maximum of ${limit} machine${limit === 1 ? '' : 's'}. Upgrade to add more.`,
      'machines',
      plan,
      limit
    )
  }
}

function checkSessionLimit(plan: PlanTier, activeCount: number): void {
  const limit = PLAN_LIMITS[plan].sessions
  if (limit === -1) return // unlimited
  if (activeCount >= limit) {
    throw new PlanLimitError(
      `Your ${plan} plan allows a maximum of ${limit} concurrent session${limit === 1 ? '' : 's'}. Upgrade or stop an existing session.`,
      'sessions',
      plan,
      limit
    )
  }
}

function requireFeature(plan: PlanTier, feature: string): void {
  if (!isFeatureAvailable(plan, feature)) {
    throw new PlanLimitError(
      `Feature '${feature}' is not available on the ${plan} plan. Please upgrade.`,
      'feature',
      plan,
      null
    )
  }
}

// ---------------------------------------------------------------------------
// checkMachineLimit
// ---------------------------------------------------------------------------

describe('checkMachineLimit', () => {
  describe('free plan (limit: 1 machine)', () => {
    it('allows the first machine (count=0)', () => {
      expect(() => checkMachineLimit('free', 0)).not.toThrow()
    })

    it('throws PlanLimitError when adding a second machine (count=1)', () => {
      expect(() => checkMachineLimit('free', 1)).toThrow(PlanLimitError)
    })

    it('error message mentions the plan name and limit', () => {
      expect(() => checkMachineLimit('free', 1)).toThrow(/free plan.*1 machine/i)
    })

    it('error has correct limitType and plan fields', () => {
      try {
        checkMachineLimit('free', 1)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(PlanLimitError)
        const e = err as PlanLimitError
        expect(e.limitType).toBe('machines')
        expect(e.plan).toBe('free')
        expect(e.limit).toBe(1)
      }
    })
  })

  describe('pro plan (limit: 5 machines)', () => {
    it('allows up to 4 machines without error', () => {
      expect(() => checkMachineLimit('pro', 4)).not.toThrow()
    })

    it('throws when adding a 6th machine (count=5)', () => {
      expect(() => checkMachineLimit('pro', 5)).toThrow(PlanLimitError)
    })
  })

  describe('team plan (limit: 20 machines)', () => {
    it('allows up to 19 machines without error', () => {
      expect(() => checkMachineLimit('team', 19)).not.toThrow()
    })

    it('throws when adding a 21st machine (count=20)', () => {
      expect(() => checkMachineLimit('team', 20)).toThrow(PlanLimitError)
    })
  })

  describe('enterprise plan (unlimited machines)', () => {
    it('never throws regardless of count', () => {
      expect(() => checkMachineLimit('enterprise', 999)).not.toThrow()
      expect(() => checkMachineLimit('enterprise', 0)).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// checkSessionLimit
// ---------------------------------------------------------------------------

describe('checkSessionLimit', () => {
  describe('free plan (limit: 3 concurrent sessions)', () => {
    it('allows the first session (activeCount=0)', () => {
      expect(() => checkSessionLimit('free', 0)).not.toThrow()
    })

    it('allows the second session (activeCount=1)', () => {
      expect(() => checkSessionLimit('free', 1)).not.toThrow()
    })

    it('allows the third session (activeCount=2)', () => {
      expect(() => checkSessionLimit('free', 2)).not.toThrow()
    })

    it('throws PlanLimitError when starting a 4th session (activeCount=3)', () => {
      expect(() => checkSessionLimit('free', 3)).toThrow(PlanLimitError)
    })

    it('error has correct limitType of sessions', () => {
      try {
        checkSessionLimit('free', 3)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(PlanLimitError)
        const e = err as PlanLimitError
        expect(e.limitType).toBe('sessions')
        expect(e.plan).toBe('free')
        expect(e.limit).toBe(3)
      }
    })
  })

  describe('pro plan (unlimited sessions)', () => {
    it('never throws regardless of active session count', () => {
      expect(() => checkSessionLimit('pro', 0)).not.toThrow()
      expect(() => checkSessionLimit('pro', 100)).not.toThrow()
      expect(() => checkSessionLimit('pro', 999)).not.toThrow()
    })
  })

  describe('team plan (unlimited sessions)', () => {
    it('never throws regardless of active session count', () => {
      expect(() => checkSessionLimit('team', 500)).not.toThrow()
    })
  })

  describe('enterprise plan (unlimited sessions)', () => {
    it('never throws regardless of active session count', () => {
      expect(() => checkSessionLimit('enterprise', 9999)).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// requireFeature
// ---------------------------------------------------------------------------

describe('requireFeature', () => {
  describe('enterprise-only features', () => {
    const enterpriseFeatures = ['sso', 'audit_log', 'session_recording', 'custom_branding', 'ip_allowlist']

    for (const feature of enterpriseFeatures) {
      it(`throws for free plan when requiring '${feature}'`, () => {
        expect(() => requireFeature('free', feature)).toThrow(PlanLimitError)
      })

      it(`throws for pro plan when requiring '${feature}'`, () => {
        expect(() => requireFeature('pro', feature)).toThrow(PlanLimitError)
      })

      it(`throws for team plan when requiring '${feature}'`, () => {
        expect(() => requireFeature('team', feature)).toThrow(PlanLimitError)
      })

      it(`passes for enterprise plan when requiring '${feature}'`, () => {
        expect(() => requireFeature('enterprise', feature)).not.toThrow()
      })
    }
  })

  describe('pro-and-above features', () => {
    const proFeatures = ['webhooks', 'api_access', 'priority_support']

    for (const feature of proFeatures) {
      it(`throws for free plan when requiring '${feature}'`, () => {
        expect(() => requireFeature('free', feature)).toThrow(PlanLimitError)
      })

      it(`passes for pro plan when requiring '${feature}'`, () => {
        expect(() => requireFeature('pro', feature)).not.toThrow()
      })

      it(`passes for team plan when requiring '${feature}'`, () => {
        expect(() => requireFeature('team', feature)).not.toThrow()
      })

      it(`passes for enterprise plan when requiring '${feature}'`, () => {
        expect(() => requireFeature('enterprise', feature)).not.toThrow()
      })
    }
  })

  describe('team-and-above features', () => {
    const teamFeatures = ['rbac', 'team_invites', 'shared_sessions']

    for (const feature of teamFeatures) {
      it(`throws for free plan when requiring '${feature}'`, () => {
        expect(() => requireFeature('free', feature)).toThrow(PlanLimitError)
      })

      it(`throws for pro plan when requiring '${feature}'`, () => {
        expect(() => requireFeature('pro', feature)).toThrow(PlanLimitError)
      })

      it(`passes for team plan when requiring '${feature}'`, () => {
        expect(() => requireFeature('team', feature)).not.toThrow()
      })
    }
  })

  describe('features available on all plans', () => {
    it('does not throw for any plan on a universal feature', () => {
      const plans: PlanTier[] = ['free', 'pro', 'team', 'enterprise']
      for (const plan of plans) {
        expect(() => requireFeature(plan, 'basic_session')).not.toThrow()
      }
    })
  })

  describe('error shape', () => {
    it('error has limitType of feature and plan set correctly', () => {
      try {
        requireFeature('free', 'sso')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(PlanLimitError)
        const e = err as PlanLimitError
        expect(e.limitType).toBe('feature')
        expect(e.plan).toBe('free')
        expect(e.limit).toBeNull()
        expect(e.message).toMatch(/sso/i)
      }
    })
  })
})
