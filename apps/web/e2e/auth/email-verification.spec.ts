/**
 * E2E: Email Verification Flow
 * Sprint 2 — Agent 1
 *
 * Prerequisites:
 *   - App running locally (npm run dev)
 *   - Test DB seeded / migrations applied
 *   - RESEND_API_KEY or AUTH_RESEND_KEY set (or mocked)
 *   - NEXTAUTH_URL=http://localhost:3000
 *
 * Run: npx playwright test e2e/auth/email-verification.spec.ts
 */

import { test, expect, type Page } from '@playwright/test'
import crypto from 'crypto'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

function uniqueEmail() {
  return `test+${Date.now()}@sessionforge-test.dev`
}

/** POST to /api/auth/register and return the parsed JSON response */
async function apiRegister(
  page: Page,
  payload: { email: string; password: string; name?: string }
) {
  const res = await page.request.post(`${BASE}/api/auth/register`, {
    data: payload,
    headers: { 'Content-Type': 'application/json' },
  })
  return { status: res.status(), body: await res.json() }
}

/** GET /api/auth/verify-email?token=... and follow the redirect */
async function apiVerifyEmail(page: Page, token: string) {
  await page.goto(`${BASE}/api/auth/verify-email?token=${token}`)
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

test.describe('Email Verification Flow', () => {
  // ── Registration ────────────────────────────────────────────────────────────

  test('POST /api/auth/register — valid payload returns 201 with userId', async ({ page }) => {
    const email = uniqueEmail()
    const { status, body } = await apiRegister(page, {
      email,
      password: 'Str0ng!Pass',
      name: 'Test User',
    })

    expect(status).toBe(201)
    expect(body.data).toHaveProperty('userId')
    expect(typeof body.data.userId).toBe('string')
    expect(body.error).toBeNull()
  })

  test('POST /api/auth/register — duplicate email returns 409', async ({ page }) => {
    const email = uniqueEmail()

    // First registration
    await apiRegister(page, { email, password: 'Str0ng!Pass' })

    // Second registration with same email
    const { status, body } = await apiRegister(page, { email, password: 'Str0ng!Pass' })

    expect(status).toBe(409)
    expect(body.error.code).toBe('EMAIL_IN_USE')
  })

  test('POST /api/auth/register — invalid email returns 400', async ({ page }) => {
    const { status, body } = await apiRegister(page, {
      email: 'not-an-email',
      password: 'Str0ng!Pass',
    })

    expect(status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  test('POST /api/auth/register — short password returns 400', async ({ page }) => {
    const { status, body } = await apiRegister(page, {
      email: uniqueEmail(),
      password: 'short',
    })

    expect(status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  // ── /auth/verify page ──────────────────────────────────────────────────────

  test('/auth/verify — renders "check your email" by default', async ({ page }) => {
    await page.goto(`${BASE}/auth/verify`)
    await expect(page.getByText('Check your email')).toBeVisible()
    await expect(page.getByText(/verification link/i)).toBeVisible()
  })

  test('/auth/verify?success=true — renders success state', async ({ page }) => {
    await page.goto(`${BASE}/auth/verify?success=true`)
    await expect(page.getByText('Email verified!')).toBeVisible()
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible()
  })

  test('/auth/verify?error=missing_token — renders error state', async ({ page }) => {
    await page.goto(`${BASE}/auth/verify?error=missing_token`)
    await expect(page.getByText('Verification failed')).toBeVisible()
    await expect(page.getByText(/no verification token/i)).toBeVisible()
  })

  test('/auth/verify?error=invalid_token — renders expired/invalid message', async ({ page }) => {
    await page.goto(`${BASE}/auth/verify?error=invalid_token`)
    await expect(page.getByText('Verification failed')).toBeVisible()
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible()
  })

  // ── Verify-email API route ─────────────────────────────────────────────────

  test('GET /api/auth/verify-email — missing token redirects to error=missing_token', async ({
    page,
  }) => {
    await page.goto(`${BASE}/api/auth/verify-email`)
    await expect(page).toHaveURL(/error=missing_token/)
  })

  test('GET /api/auth/verify-email — bogus token redirects to error=invalid_token', async ({
    page,
  }) => {
    const fakeToken = crypto.randomBytes(32).toString('hex')
    await apiVerifyEmail(page, fakeToken)
    await expect(page).toHaveURL(/error=invalid_token/)
  })

  /**
   * HAPPY PATH — requires DB access to retrieve the token after registration.
   *
   * In CI this should use a test-mode Resend interceptor or a DB seeding helper
   * that returns the raw token. Skipped here; manual steps below.
   *
   * Manual E2E happy path:
   *   1. POST /api/auth/register with a real email
   *   2. Open email inbox, click "Verify Email Address"
   *   3. Confirm redirect to /auth/verify?success=true
   *   4. Confirm "Email verified!" UI is shown
   *   5. Attempt to sign in — should succeed
   *   6. Attempt to click the same verification link again — should redirect to invalid_token
   */
  test.skip('happy path — full flow requires DB seed helper or email interceptor', async () => {
    // Implement with: token = await db.select().from(verificationTokens).where(...).then(r => r[0].token)
    // await apiVerifyEmail(page, token)
    // await expect(page).toHaveURL(/success=true/)
  })

  // ── Login guard ────────────────────────────────────────────────────────────

  test('credentials login — unverified user cannot sign in (returns error)', async ({ page }) => {
    const email = uniqueEmail()
    const password = 'Str0ng!Pass'

    // Register (does NOT verify email)
    await apiRegister(page, { email, password, name: 'Unverified User' })

    // Attempt login via NextAuth credentials callback
    const res = await page.request.post(`${BASE}/api/auth/callback/credentials`, {
      form: { email, password, csrfToken: '', json: 'true' },
    })

    // NextAuth returns a redirect or error — user should NOT be signed in
    // A 401 or redirect to /auth/error or /auth/login is acceptable
    const location = res.headers()['location'] ?? ''
    const isBlocked =
      res.status() === 401 ||
      location.includes('error') ||
      location.includes('login')

    expect(isBlocked).toBe(true)
  })
})
