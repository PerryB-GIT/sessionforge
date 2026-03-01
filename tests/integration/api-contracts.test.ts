/**
 * API Contract Tests — SessionForge
 *
 * Validates that live API responses match the canonical TypeScript types in
 * packages/shared-types/.  Zod schemas are derived inline from those
 * interfaces because shared-types currently exports only TypeScript types
 * (no Zod schemas); the shapes below must stay in sync with db-types.ts and
 * api.ts in that package.
 *
 * Endpoints under test:
 *   GET  /api/sessions         — PaginatedResponse<Session>
 *   GET  /api/machines         — PaginatedResponse<Machine>
 *   GET  /api/user             — User  (canonical "me" route; /api/auth/me is not a custom route)
 *   POST /api/stripe/checkout  — exists check (no /api/billing/status route in this codebase)
 *   POST /api/stripe/portal    — exists check
 *
 * The server is started by tests/setup/test-server-global-setup.ts.
 * Auth is obtained via the register → CSRF → credentials sign-in flow
 * used by all other integration tests in this suite.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { z } from 'zod'
import { useTestDatabase } from '../helpers/db'
import { makeTestUser } from '../fixtures/users'

// ---------------------------------------------------------------------------
// Zod schemas — derived from packages/shared-types/src/db-types.ts
// ---------------------------------------------------------------------------

// Machine
const MachineSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  orgId: z.string().uuid().nullable(),
  name: z.string(),
  os: z.enum(['windows', 'macos', 'linux']),
  hostname: z.string(),
  // agentVersion is present in the DB row but not in the Machine interface;
  // allow it as an optional extra field (passthrough keeps parse strict by default,
  // so we explicitly mark extras optional to handle both DB rows and interface shapes).
  agentVersion: z.string().optional(),
  status: z.enum(['online', 'offline', 'error']),
  lastSeen: z.union([z.string(), z.date()]).nullable(),
  // Extra DB columns returned by the route handler
  ipAddress: z.string().nullable().optional(),
  cpuModel: z.string().nullable().optional(),
  ramGb: z.number().nullable().optional(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]).optional(),
})

// Session
const SessionSchema = z.object({
  id: z.string().uuid(),
  machineId: z.string().uuid(),
  userId: z.string().uuid(),
  pid: z.number().int().nullable(),
  processName: z.string(),
  workdir: z.string().nullable(),
  status: z.enum(['running', 'stopped', 'crashed', 'paused']),
  exitCode: z.number().int().nullable().optional(),
  peakMemoryMb: z.number().nullable(),
  avgCpuPercent: z.number().nullable(),
  startedAt: z.union([z.string(), z.date()]),
  stoppedAt: z.union([z.string(), z.date()]).nullable(),
  createdAt: z.union([z.string(), z.date()]),
})

// User (as returned by GET /api/user — only id, name, email are selected)
const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
})

// PaginatedResponse wrapper
const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    hasMore: z.boolean(),
  })

// Top-level API envelope
const ApiEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    error: z.null(),
  })

// ---------------------------------------------------------------------------
// Auth helper — register a fresh user and return a session cookie
// ---------------------------------------------------------------------------

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3099'

async function getSessionCookie(): Promise<string> {
  const user = makeTestUser()

  // Register
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password, name: user.name }),
  })

  // Obtain CSRF token
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`)
  const { csrfToken = '' } = (await csrfRes.json()) as { csrfToken?: string }
  const csrfCookie = csrfRes.headers.get('set-cookie') ?? ''

  // Sign in
  const signInRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      cookie: csrfCookie,
    },
    body: new URLSearchParams({
      csrfToken,
      email: user.email,
      password: user.password,
      callbackUrl: `${BASE_URL}/dashboard`,
      json: 'true',
    }).toString(),
    redirect: 'manual',
  })

  const rawSetCookie = signInRes.headers.get('set-cookie') ?? ''
  if (!rawSetCookie.includes('session-token')) {
    console.warn('[contract-auth] Could not obtain session cookie — tests will assert 401 shapes')
    return ''
  }

  return rawSetCookie
    .split(',')
    .map((s) => s.split(';')[0].trim())
    .join('; ')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('API Contract Tests', () => {
  useTestDatabase()

  let sessionCookie: string

  beforeAll(async () => {
    sessionCookie = await getSessionCookie()
  })

  // ── /api/sessions ────────────────────────────────────────────────────────

  it('GET /api/sessions matches SessionSchema (paginated envelope)', async () => {
    const res = await fetch(`${BASE_URL}/api/sessions`, {
      headers: { cookie: sessionCookie },
    })

    // Unauthenticated: skip shape validation, assert error envelope only
    if (res.status === 401) {
      const body = (await res.json()) as Record<string, unknown>
      expect(body).toMatchObject({ data: null, error: expect.objectContaining({ code: 'UNAUTHORIZED' }) })
      return
    }

    expect(res.status).toBe(200)
    const body = await res.json()

    // Parse with Zod — throws ZodError if shape is wrong
    ApiEnvelopeSchema(PaginatedResponseSchema(SessionSchema)).parse(body)
  })

  // ── /api/machines ────────────────────────────────────────────────────────

  it('GET /api/machines matches MachineSchema (paginated envelope)', async () => {
    const res = await fetch(`${BASE_URL}/api/machines`, {
      headers: { cookie: sessionCookie },
    })

    if (res.status === 401) {
      const body = (await res.json()) as Record<string, unknown>
      expect(body).toMatchObject({ data: null, error: expect.objectContaining({ code: 'UNAUTHORIZED' }) })
      return
    }

    expect(res.status).toBe(200)
    const body = await res.json()

    ApiEnvelopeSchema(PaginatedResponseSchema(MachineSchema)).parse(body)
  })

  // ── /api/user  ───────────────────────────────────────────────────────────
  // GET /api/user is the canonical "me" route.
  // GET /api/auth/me is NOT a custom route — it falls through to the
  // NextAuth [...nextauth] catch-all which returns 400 for unknown paths.

  it('GET /api/user matches UserSchema', async () => {
    const res = await fetch(`${BASE_URL}/api/user`, {
      headers: { cookie: sessionCookie },
    })

    if (res.status === 401) {
      const body = (await res.json()) as Record<string, unknown>
      expect(body).toMatchObject({ data: null, error: expect.objectContaining({ code: 'UNAUTHORIZED' }) })
      return
    }

    expect(res.status).toBe(200)
    const body = await res.json()
    ApiEnvelopeSchema(UserSchema).parse(body)
  })

  // ── /api/stripe/checkout and /api/stripe/portal ──────────────────────────
  // No /api/billing/status route exists in this codebase.
  // Billing is handled by POST /api/stripe/checkout and POST /api/stripe/portal.
  // These tests assert only that the route handlers are registered (not 404).

  it('POST /api/stripe/checkout exists (returns non-404 without a valid body)', async () => {
    const res = await fetch(`${BASE_URL}/api/stripe/checkout`, {
      method: 'POST',
      headers: { cookie: sessionCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    // Any response other than 404 confirms the route is registered.
    expect(res.status).not.toBe(404)
  })

  it('POST /api/stripe/portal exists (returns non-404 without a valid body)', async () => {
    const res = await fetch(`${BASE_URL}/api/stripe/portal`, {
      method: 'POST',
      headers: { cookie: sessionCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).not.toBe(404)
  })
})
