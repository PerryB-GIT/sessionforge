import type { PlanTier } from '@sessionforge/shared-types'

// ---------------------------------------------------------------------------
// Base user fixture shapes
// These are plain-object factories — no DB I/O here.
// Use tests/helpers/db.ts to insert them into a test database.
// ---------------------------------------------------------------------------

export interface TestUserInput {
  email: string
  password: string
  name: string
  plan: PlanTier
}

export const testUser: TestUserInput = {
  email: 'test@sessionforge.dev',
  password: 'TestPassword123!',
  name: 'Test User',
  plan: 'free',
}

export const proUser: TestUserInput = {
  ...testUser,
  email: 'pro@sessionforge.dev',
  name: 'Pro User',
  plan: 'pro',
}

export const teamUser: TestUserInput = {
  ...testUser,
  email: 'team@sessionforge.dev',
  name: 'Team User',
  plan: 'team',
}

export const enterpriseUser: TestUserInput = {
  ...testUser,
  email: 'enterprise@sessionforge.dev',
  name: 'Enterprise User',
  plan: 'enterprise',
}

/** Admin user (owner of the test organisation) */
export const adminUser: TestUserInput = {
  email: 'admin@sessionforge.dev',
  password: 'AdminPassword123!',
  name: 'Admin Owner',
  plan: 'team',
}

/**
 * Factory for generating unique test users during a single test run.
 * Appends a timestamp + random suffix to the email so parallel tests
 * never collide on the unique-email constraint.
 */
export function makeTestUser(overrides: Partial<TestUserInput> = {}): TestUserInput {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  return {
    email: `user-${suffix}@sessionforge.dev`,
    password: 'TestPassword123!',
    name: `User ${suffix}`,
    plan: 'free',
    ...overrides,
  }
}

/** Weak passwords that should be rejected by the API */
export const weakPasswords = [
  'short1!',        // too short
  'alllowercase1!', // no uppercase
  'ALLUPPERCASE1!', // no lowercase
  'NoNumbers!!',    // no digit
  'NoSpecial123',   // no special character
  '        ',       // whitespace only
]

/** Emails that should be rejected as malformed */
export const invalidEmails = [
  'not-an-email',
  '@nodomain.com',
  'no-at-sign.com',
  'double@@at.com',
  '',
]
