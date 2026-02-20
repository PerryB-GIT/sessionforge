/**
 * Playwright global setup — runs once before all tests in the production suite.
 *
 * Responsibilities:
 *   1. Verify the production site is reachable.
 *   2. Register a disposable test user via the public /api/auth/register endpoint.
 *   3. Log in with credentials to get a real session cookie.
 *   4. Save the browser storage state so tests can reuse the authenticated session
 *      without repeating login for each spec.
 *
 * The test user email/password are written to environment variables that are read
 * by auth-post-deploy.spec.ts.  They are also available via process.env in the
 * worker processes because Playwright merges globalSetup env mutations.
 */

import { chromium, type FullConfig } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://sessionforge.dev'
const AUTH_DIR = path.join(__dirname, '.auth')
export const STORAGE_STATE = path.join(AUTH_DIR, 'user.json')

// Deterministic but unique-per-run test credentials
const RUN_ID = Date.now()
export const TEST_EMAIL = `e2e-pd-${RUN_ID}@sessionforge.dev`
export const TEST_PASSWORD = 'E2eProdPass1!'
export const TEST_NAME = 'E2E Post-Deploy User'

async function globalSetup(config: FullConfig) {
  // Ensure auth directory exists
  fs.mkdirSync(AUTH_DIR, { recursive: true })

  // Write credentials to env so worker processes can read them
  process.env.E2E_TEST_EMAIL = TEST_EMAIL
  process.env.E2E_TEST_PASSWORD = TEST_PASSWORD
  process.env.E2E_TEST_NAME = TEST_NAME

  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: BASE_URL })
  const page = await context.newPage()

  // ------------------------------------------------------------------
  // Step 1: Health-check — fail fast if site is unreachable
  // ------------------------------------------------------------------
  console.log(`[global-setup] Checking site health at ${BASE_URL}/api/health`)
  const healthRes = await context.request.get(`${BASE_URL}/api/health`)
  if (!healthRes.ok()) {
    await browser.close()
    throw new Error(
      `[global-setup] Site health check failed: ${healthRes.status()} ${healthRes.statusText()}`
    )
  }
  console.log('[global-setup] Site is healthy.')

  // ------------------------------------------------------------------
  // Step 2: Register test user
  // ------------------------------------------------------------------
  console.log(`[global-setup] Registering test user: ${TEST_EMAIL}`)
  const registerRes = await context.request.post(`${BASE_URL}/api/auth/register`, {
    data: { name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  })

  if (!registerRes.ok() && registerRes.status() !== 409) {
    const body = await registerRes.text()
    await browser.close()
    throw new Error(
      `[global-setup] Failed to register test user (${registerRes.status()}): ${body}`
    )
  }
  console.log('[global-setup] Test user registered (or already existed).')

  // ------------------------------------------------------------------
  // Step 3: Log in and capture session storage state
  // ------------------------------------------------------------------
  console.log('[global-setup] Logging in to capture session state...')
  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel(/email/i).fill(TEST_EMAIL)
  await page.getByLabel(/password/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /sign in|log in/i }).click()

  // Wait for redirect — new users land on /onboarding before /dashboard
  await page.waitForURL(/dashboard|onboarding/, { timeout: 30_000 })

  // If the user was sent to /onboarding (first-login redirect), complete it
  // via the API so the saved session state has onboarding done and lands on /dashboard
  if (page.url().includes('/onboarding')) {
    console.log('[global-setup] New user redirected to /onboarding — completing via API...')
    const onboardingRes = await context.request.post(`${BASE_URL}/api/onboarding/complete`, {
      headers: { 'Content-Type': 'application/json' },
    })
    if (!onboardingRes.ok()) {
      console.warn(`[global-setup] /api/onboarding/complete returned ${onboardingRes.status()} — continuing anyway`)
    }
    await page.goto(`${BASE_URL}/dashboard`)
    await page.waitForURL(/dashboard/, { timeout: 15_000 })
  }

  console.log('[global-setup] Login successful, on dashboard.')

  // Save auth state
  await context.storageState({ path: STORAGE_STATE })
  console.log(`[global-setup] Storage state saved to ${STORAGE_STATE}`)

  await browser.close()
}

export default globalSetup
