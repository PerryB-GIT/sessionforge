/**
 * Integration tests for the authentication API
 *
 * Tests the full HTTP request/response cycle for:
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   POST /api/auth/logout
 *   POST /api/auth/forgot-password
 *   GET  /api/auth/me
 *
 * STUB: These tests are written against the expected API shape.
 * When the Backend agent builds the Next.js API routes, replace the
 * supertest import and app reference below with the real handler.
 *
 * import { createTestApp } from '@sessionforge/backend/test-utils'
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { useTestDatabase, seedUser } from '../helpers/db'
import { hashTestPassword, makeAuthHeaders } from '../helpers/auth'
import { testUser, proUser, makeTestUser, weakPasswords, invalidEmails } from '../fixtures/users'

// STUB: import when backend builds API routes
// import request from 'supertest'
// import { app } from '../../../apps/web/src/app'

// ---------------------------------------------------------------------------
// Lightweight HTTP stub
// Replace this object with: const api = request(app)
// STUB: import when backend builds [api routes]
// ---------------------------------------------------------------------------

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

interface StubResponse {
  status: number
  body: Record<string, unknown>
  headers: Record<string, string>
}

/**
 * Stub HTTP client.
 * Returns predefined responses so these tests act as living API specs.
 * Once the backend is built, replace with real supertest calls.
 */
function stubRequest(method: HttpMethod, path: string, _headers: Record<string, string> = {}) {
  return {
    send: async (body?: Record<string, unknown>): Promise<StubResponse> => {
      // ---------------------------------------------------------------------------
      // POST /api/auth/register
      // ---------------------------------------------------------------------------
      if (method === 'POST' && path === '/api/auth/register') {
        if (!body?.email || !body?.password || !body?.name) {
          return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Missing required fields' } }, headers: {} }
        }
        const emailStr = body.email as string
        if (!emailStr.includes('@')) {
          return { status: 400, body: { error: { code: 'INVALID_EMAIL', message: 'Invalid email address' } }, headers: {} }
        }
        const passwordStr = body.password as string
        if (passwordStr.length < 8 || !/[A-Z]/.test(passwordStr) || !/[a-z]/.test(passwordStr) || !/[0-9]/.test(passwordStr) || !/[^A-Za-z0-9]/.test(passwordStr)) {
          return { status: 400, body: { error: { code: 'WEAK_PASSWORD', message: 'Password does not meet requirements' } }, headers: {} }
        }
        if (emailStr === testUser.email) {
          return { status: 409, body: { error: { code: 'EMAIL_TAKEN', message: 'A user with that email already exists' } }, headers: {} }
        }
        return {
          status: 201,
          body: { data: { id: 'stub-new-user-id', email: emailStr, name: body.name, plan: 'free' } },
          headers: {},
        }
      }

      // ---------------------------------------------------------------------------
      // POST /api/auth/login
      // ---------------------------------------------------------------------------
      if (method === 'POST' && path === '/api/auth/login') {
        if (!body?.email || !body?.password) {
          return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Email and password required' } }, headers: {} }
        }
        if (body.email === testUser.email && body.password === testUser.password) {
          return {
            status: 200,
            body: { data: { id: 'stub-user-id', email: testUser.email, plan: 'free' } },
            headers: { 'set-cookie': 'next-auth.session-token=stub-token; Path=/; HttpOnly' },
          }
        }
        return { status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }, headers: {} }
      }

      // ---------------------------------------------------------------------------
      // POST /api/auth/logout
      // ---------------------------------------------------------------------------
      if (method === 'POST' && path === '/api/auth/logout') {
        return {
          status: 200,
          body: { data: { success: true } },
          headers: { 'set-cookie': 'next-auth.session-token=; Max-Age=0; Path=/' },
        }
      }

      // ---------------------------------------------------------------------------
      // POST /api/auth/forgot-password
      // ---------------------------------------------------------------------------
      if (method === 'POST' && path === '/api/auth/forgot-password') {
        // Always return 200 to avoid leaking whether an email exists
        return {
          status: 200,
          body: { data: { message: 'If that email exists, a reset link has been sent.' } },
          headers: {},
        }
      }

      // ---------------------------------------------------------------------------
      // GET /api/auth/me
      // ---------------------------------------------------------------------------
      if (method === 'GET' && path === '/api/auth/me') {
        const authHeader = _headers['authorization'] ?? ''
        if (!authHeader.startsWith('Bearer ')) {
          return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } }, headers: {} }
        }
        return {
          status: 200,
          body: { data: { id: 'stub-user-id', email: testUser.email, plan: 'free', name: testUser.name } },
          headers: {},
        }
      }

      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Route not found' } }, headers: {} }
    },
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('POST /api/auth/register', () => {
  // STUB: useTestDatabase() — enable once DB is wired up
  // useTestDatabase()

  it('returns 201 and creates a user with valid data', async () => {
    const newUser = makeTestUser()
    const res = await stubRequest('POST', '/api/auth/register').send({
      email: newUser.email,
      password: newUser.password,
      name: newUser.name,
    })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ email: newUser.email, plan: 'free' })
  })

  it('returns 409 when the email is already registered', async () => {
    // testUser.email is treated as already-registered by the stub
    const res = await stubRequest('POST', '/api/auth/register').send({
      email: testUser.email,
      password: testUser.password,
      name: testUser.name,
    })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('returns 400 for an invalid email address', async () => {
    const res = await stubRequest('POST', '/api/auth/register').send({
      email: 'not-an-email',
      password: 'ValidPassword1!',
      name: 'Bad Email User',
    })
    expect(res.status).toBe(400)
  })

  it.each(weakPasswords)('returns 400 for weak password: %s', async (password) => {
    const res = await stubRequest('POST', '/api/auth/register').send({
      email: makeTestUser().email,
      password,
      name: 'Test User',
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await stubRequest('POST', '/api/auth/register').send({ email: 'x@y.com' })
    expect(res.status).toBe(400)
  })

  it('does not return a password hash in the response body', async () => {
    const newUser = makeTestUser()
    const res = await stubRequest('POST', '/api/auth/register').send({
      email: newUser.email,
      password: newUser.password,
      name: newUser.name,
    })
    expect(JSON.stringify(res.body)).not.toContain('passwordHash')
    expect(JSON.stringify(res.body)).not.toContain('password')
  })
})

describe('POST /api/auth/login', () => {
  it('returns 200 and sets a session cookie for valid credentials', async () => {
    const res = await stubRequest('POST', '/api/auth/login').send({
      email: testUser.email,
      password: testUser.password,
    })
    expect(res.status).toBe(200)
    expect(res.headers['set-cookie']).toMatch(/session-token/i)
  })

  it('returns 401 for a wrong password', async () => {
    const res = await stubRequest('POST', '/api/auth/login').send({
      email: testUser.email,
      password: 'WrongPassword!99',
    })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('returns 401 for an unregistered email', async () => {
    const res = await stubRequest('POST', '/api/auth/login').send({
      email: 'nobody@sessionforge.dev',
      password: 'AnyPassword1!',
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 when email is missing', async () => {
    const res = await stubRequest('POST', '/api/auth/login').send({ password: 'x' })
    expect(res.status).toBe(400)
  })

  it('does not leak whether the email exists in the 401 response body', async () => {
    const res = await stubRequest('POST', '/api/auth/login').send({
      email: 'nosuchuser@sessionforge.dev',
      password: 'whatever',
    })
    // Error message must not say "user not found" — only "invalid credentials"
    expect(res.body.error?.message?.toLowerCase()).not.toMatch(/not found|no account|doesn.t exist/i)
  })
})

describe('POST /api/auth/logout', () => {
  it('returns 200 and clears the session cookie', async () => {
    const res = await stubRequest('POST', '/api/auth/logout').send()
    expect(res.status).toBe(200)
    expect(res.headers['set-cookie']).toMatch(/Max-Age=0|Expires/i)
  })
})

describe('POST /api/auth/forgot-password', () => {
  it('always returns 200 even for unknown emails (do not leak existence)', async () => {
    const res = await stubRequest('POST', '/api/auth/forgot-password').send({
      email: 'ghost@sessionforge.dev',
    })
    expect(res.status).toBe(200)
    expect(res.body.data?.message).toBeTruthy()
  })

  it('returns 200 for a known email too', async () => {
    const res = await stubRequest('POST', '/api/auth/forgot-password').send({
      email: testUser.email,
    })
    expect(res.status).toBe(200)
  })
})

describe('GET /api/auth/me', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await stubRequest('GET', '/api/auth/me').send()
    expect(res.status).toBe(401)
  })

  it('returns 200 and user data when authenticated', async () => {
    const headers = await makeAuthHeaders('stub-user-id', 'free')
    const res = await stubRequest('GET', '/api/auth/me', headers).send()
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ email: testUser.email, plan: 'free' })
  })
})
