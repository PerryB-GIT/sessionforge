/**
 * Integration tests for the authentication API
 *
 * Tests the full HTTP request/response cycle for:
 *   POST /api/auth/register
 *   POST /api/auth/forgot-password
 *
 * The following routes are handled by NextAuth's catch-all handler
 * (/api/auth/[...nextauth]) rather than custom route files.  Standalone
 * login/logout/me tests require a fully-configured NextAuth session which
 * is tested via the Playwright E2E suite instead.
 *
 * HTTP calls use fetch() against the Next.js dev server started by
 * tests/setup/test-server-global-setup.ts (port 3001).
 */

import { describe, it, expect } from 'vitest'
import { useTestDatabase } from '../helpers/db'
import { makeTestUser, testUser, weakPasswords } from '../fixtures/users'

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3001'

// ---------------------------------------------------------------------------
// Thin fetch wrapper that mirrors the old stubRequest().send() interface
// so the assertion layer is unchanged.
// ---------------------------------------------------------------------------

interface ApiResponse {
  status: number
  body: Record<string, unknown>
  headers: Headers
}

async function apiPost(path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<ApiResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  let parsed: Record<string, unknown> = {}
  try {
    parsed = await res.json() as Record<string, unknown>
  } catch {
    // Some responses have no body (204 etc.)
  }

  return { status: res.status, body: parsed, headers: res.headers }
}

async function apiGet(path: string, extraHeaders: Record<string, string> = {}): Promise<ApiResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })

  let parsed: Record<string, unknown> = {}
  try {
    parsed = await res.json() as Record<string, unknown>
  } catch {
    // No body
  }

  return { status: res.status, body: parsed, headers: res.headers }
}

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------

describe('POST /api/auth/register', () => {
  useTestDatabase()

  it('returns 201 and creates a user with valid data', async () => {
    const newUser = makeTestUser()
    const res = await apiPost('/api/auth/register', {
      email: newUser.email,
      password: newUser.password,
      name: newUser.name,
    })
    expect(res.status).toBe(201)
    // Real route returns { success: true, userId: '...' }
    expect(res.body).toMatchObject({ success: true })
    expect(typeof res.body.userId).toBe('string')
  })

  it('returns 409 when the email is already registered', async () => {
    // Register once
    const newUser = makeTestUser()
    await apiPost('/api/auth/register', {
      email: newUser.email,
      password: newUser.password,
      name: newUser.name,
    })
    // Register again with same email
    const res = await apiPost('/api/auth/register', {
      email: newUser.email,
      password: newUser.password,
      name: newUser.name,
    })
    expect(res.status).toBe(409)
  })

  it('returns 400 for an invalid email address', async () => {
    const res = await apiPost('/api/auth/register', {
      email: 'not-an-email',
      password: 'ValidPassword1!',
      name: 'Bad Email User',
    })
    expect(res.status).toBe(400)
  })

  it.each(weakPasswords)('returns 400 for weak password: %s', async (password) => {
    const res = await apiPost('/api/auth/register', {
      email: makeTestUser().email,
      password,
      name: 'Test User',
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await apiPost('/api/auth/register', { email: 'x@y.com' })
    expect(res.status).toBe(400)
  })

  it('does not return a password hash in the response body', async () => {
    const newUser = makeTestUser()
    const res = await apiPost('/api/auth/register', {
      email: newUser.email,
      password: newUser.password,
      name: newUser.name,
    })
    expect(JSON.stringify(res.body)).not.toContain('passwordHash')
    expect(JSON.stringify(res.body)).not.toContain('password')
  })
})

// ---------------------------------------------------------------------------
// POST /api/auth/login
// NOTE: Login is handled by NextAuth at /api/auth/callback/credentials.
// Full login flow (session cookie issuance) is covered by Playwright E2E.
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  it.skip('route not built yet: standalone /api/auth/login — use NextAuth /api/auth/callback/credentials via E2E', async () => {
    // This route does not exist as a standalone handler. Login is negotiated
    // through NextAuth's credentials provider at /api/auth/callback/credentials.
    // Testing requires a browser session and is covered by Playwright E2E tests.
  })

  it.skip('route not built yet: 401 for wrong password — covered by E2E', async () => {})
  it.skip('route not built yet: 401 for unregistered email — covered by E2E', async () => {})
  it.skip('route not built yet: 400 when email is missing — covered by E2E', async () => {})
  it.skip('route not built yet: does not leak email existence — covered by E2E', async () => {})
})

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// NOTE: Logout is handled by NextAuth at /api/auth/signout.
// ---------------------------------------------------------------------------

describe('POST /api/auth/logout', () => {
  it.skip('route not built yet: standalone /api/auth/logout — use NextAuth /api/auth/signout via E2E', async () => {
    // NextAuth handles logout via GET/POST /api/auth/signout.
    // Cookie clearing requires a browser context and is covered by Playwright E2E.
  })
})

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password
// ---------------------------------------------------------------------------

describe('POST /api/auth/forgot-password', () => {
  useTestDatabase()

  it('always returns 200 even for unknown emails (do not leak existence)', async () => {
    const res = await apiPost('/api/auth/forgot-password', {
      email: 'ghost@sessionforge.dev',
    })
    expect(res.status).toBe(200)
    // Real route returns { ok: true }
    expect(res.body).toMatchObject({ ok: true })
  })

  it('returns 200 for a known email too', async () => {
    // Register a user first so we have a real account in the DB
    const newUser = makeTestUser()
    await apiPost('/api/auth/register', {
      email: newUser.email,
      password: newUser.password,
      name: newUser.name,
    })

    const res = await apiPost('/api/auth/forgot-password', {
      email: newUser.email,
    })
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// GET /api/auth/me
// NOTE: No standalone /api/auth/me route exists. User data is available via
// the NextAuth session endpoint (/api/auth/session) or the /api/user route.
// ---------------------------------------------------------------------------

describe('GET /api/auth/me', () => {
  it.skip('route not built yet: /api/auth/me does not exist — session data available at /api/auth/session', async () => {})
  it.skip('route not built yet: authenticated /api/auth/me — covered by E2E', async () => {})
})
