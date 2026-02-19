/**
 * Authentication test helpers
 *
 * Provides utilities to create authenticated HTTP clients and session tokens
 * for use in integration tests.
 *
 * STUB: Actual session/JWT generation depends on the backend auth module
 * being built.  Stubs are clearly marked so they can be wired up once the
 * Backend agent delivers the implementation.
 */

// STUB: import when backend builds auth module
// import { createSessionToken, hashPassword } from '@sessionforge/backend/auth'

import { vi } from 'vitest'
import * as bcrypt from 'bcryptjs'

// ---------------------------------------------------------------------------
// Password utilities
// ---------------------------------------------------------------------------

/**
 * Hash a plaintext password using the same bcrypt cost factor the app uses.
 * Cost factor 10 is used in tests (lower than production's 12) for speed.
 */
export async function hashTestPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

/**
 * Verify a password against a hash (thin wrapper for symmetry with hashTestPassword).
 */
export async function verifyTestPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

/**
 * Generate a test JWT / session token for a given user ID and plan.
 * The token is compatible with how next-auth stores sessions.
 *
 * STUB: replace jose.SignJWT usage with the real app's createSessionToken
 * once the backend auth module is available.
 */
export async function generateTestSessionToken(userId: string, plan = 'free'): Promise<string> {
  // STUB: import { createSessionToken } from '@sessionforge/backend/auth'
  // return createSessionToken({ userId, plan })

  // Minimal JWT for testing purposes using jose
  // STUB: replace with real implementation
  const { SignJWT } = await import('jose')
  const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET ?? 'test-secret')
  return new SignJWT({ sub: userId, plan, email: `user-${userId}@sessionforge.dev` })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret)
}

// ---------------------------------------------------------------------------
// HTTP client helpers
// ---------------------------------------------------------------------------

export interface AuthHeaders {
  cookie: string
  authorization: string
}

/**
 * Create HTTP headers that simulate an authenticated browser session.
 * These headers can be passed to supertest requests.
 *
 * @param userId - The user's UUID
 * @param plan   - The user's plan tier
 */
export async function makeAuthHeaders(userId: string, plan = 'free'): Promise<AuthHeaders> {
  const token = await generateTestSessionToken(userId, plan)
  return {
    // next-auth reads the session from a cookie in production
    cookie: `next-auth.session-token=${token}; Path=/; HttpOnly; SameSite=Lax`,
    // Alternatively an Authorization Bearer header works for API routes
    authorization: `Bearer ${token}`,
  }
}

/**
 * Create an API key string in the same format the app uses.
 * Format: sf_live_<32 hex chars>
 * The hash is NOT stored in the DB by this helper — use seedApiKey() in db.ts.
 */
export function generateTestApiKey(): string {
  const randomHex = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')
  return `sf_live_${randomHex}`
}

// ---------------------------------------------------------------------------
// Mock session factory for unit tests that don't need HTTP
// ---------------------------------------------------------------------------

export interface MockSession {
  user: {
    id: string
    email: string
    plan: string
    name: string
  }
  expires: string
}

export function makeMockSession(overrides: Partial<MockSession['user']> = {}): MockSession {
  return {
    user: {
      id: 'stub-user-id',
      email: 'test@sessionforge.dev',
      plan: 'free',
      name: 'Test User',
      ...overrides,
    },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  }
}
