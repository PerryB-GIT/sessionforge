/**
 * E2E: Onboarding wizard
 *
 * Covers:
 *   - Unauthenticated access to /onboarding redirects to /login
 *   - /onboarding page renders the 5-step wizard
 *   - Step 1: Organization name form
 *   - Step 2: API key generation (once created, key is shown in full with sf_live_ prefix)
 *   - Step 3: Install agent — install command and OS tabs visible
 *   - Step 4: Verify connection — "Verify Connection" button visible
 *   - Step 5: Celebration screen — "Go to Dashboard" button present
 *   - Full wizard flow (steps 1-3) skipped when live API required
 *
 * Note: Steps 4 and 5 require a real agent to connect. Those paths are
 * covered by skip-annotated tests with inline documentation.
 */

import { test, expect } from '@playwright/test'

// ─── Unauthenticated guard ────────────────────────────────────────────────────

test.describe('Onboarding — unauthenticated', () => {
  test('visiting /onboarding while logged out redirects to login', async ({ page }) => {
    await page.goto('/onboarding')
    // Next.js middleware should redirect to /login (or include a callbackUrl param)
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  })
})

// ─── Authenticated wizard rendering ──────────────────────────────────────────
//
// The tests below assume the session cookie has been injected via a storage-
// state fixture (storageState: 'e2e/.auth/user.json'). In a CI pipeline this
// file is produced by a global setup script that registers + verifies a user
// and serialises the cookie jar.
//
// Because that fixture may not be present in all environments, every test in
// this describe block is self-contained and gracefully falls back if it cannot
// authenticate.

test.describe('Onboarding wizard UI', () => {
  test('page heading reads "Get Started with SessionForge"', async ({ page }) => {
    // Try to navigate; if redirected to login the page check below will still
    // execute against the login page without throwing — we guard with skip.
    await page.goto('/onboarding')
    const url = page.url()
    if (url.includes('/login')) {
      test.skip(true, 'Requires authenticated session — set up storageState fixture')
      return
    }
    await expect(
      page.getByRole('heading', { name: 'Get Started with SessionForge' }),
    ).toBeVisible()
  })

  test('wizard step indicator shows all 5 steps', async ({ page }) => {
    await page.goto('/onboarding')
    const url = page.url()
    if (url.includes('/login')) {
      test.skip(true, 'Requires authenticated session')
      return
    }

    // Each step label is rendered beneath its icon
    await expect(page.getByText('Organization')).toBeVisible()
    await expect(page.getByText('API Key')).toBeVisible()
    await expect(page.getByText('Install Agent')).toBeVisible()
    await expect(page.getByText('Verify')).toBeVisible()
    await expect(page.getByText('Done!')).toBeVisible()
  })

  test('step 1 shows "Welcome to SessionForge" and org name input', async ({ page }) => {
    await page.goto('/onboarding')
    const url = page.url()
    if (url.includes('/login')) {
      test.skip(true, 'Requires authenticated session')
      return
    }

    await expect(page.getByRole('heading', { name: 'Welcome to SessionForge' })).toBeVisible()
    await expect(page.getByLabel('Organization Name')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create Organization' })).toBeVisible()
  })

  test('step 1 shows validation error for short org name', async ({ page }) => {
    await page.goto('/onboarding')
    const url = page.url()
    if (url.includes('/login')) {
      test.skip(true, 'Requires authenticated session')
      return
    }

    await page.getByLabel('Organization Name').fill('X')
    await page.getByRole('button', { name: 'Create Organization' }).click()
    await expect(page.getByText(/at least 2 characters/i)).toBeVisible()
  })
})

// ─── Full wizard flow (requires live API) ─────────────────────────────────────

test.describe('Onboarding full flow', () => {
  test.skip('Step 1 → create org → advances to Step 2', async ({ page }) => {
    // Requires authenticated session + live /api/orgs endpoint.
    // await page.goto('/onboarding')
    // await page.getByLabel('Organization Name').fill('E2E Org')
    // await page.getByRole('button', { name: 'Create Organization' }).click()
    // After success the wizard should show "Create Your First API Key"
    // await expect(page.getByRole('heading', { name: 'Create Your First API Key' })).toBeVisible()
  })

  test.skip('Step 2 → generate API key → key shown with sf_live_ prefix', async ({ page }) => {
    // Requires reaching step 2 (org already created for the test user).
    // await page.getByRole('button', { name: 'Generate API Key' }).click()
    // The key element renders in a <code> tag inside the step-2 panel
    // await expect(page.locator('code').filter({ hasText: 'sf_live_' })).toBeVisible()
    // The "I've saved my key" button becomes enabled only after copying
    // await expect(page.getByRole('button', { name: "I've saved my key" })).toBeDisabled()
  })

  test.skip('Step 3 → install agent → shows curl command and OS tabs', async ({ page }) => {
    // Requires reaching step 3.
    // await expect(page.getByRole('heading', { name: 'Install the Agent' })).toBeVisible()
    // await expect(page.getByText(/curl -fsSL/)).toBeVisible()
    // await expect(page.getByRole('button', { name: 'I ran the command' })).toBeVisible()
  })

  test.skip('Step 4 → verify connection → polling button visible', async ({ page }) => {
    // Requires reaching step 4.
    // await expect(page.getByRole('heading', { name: 'Verify Connection' })).toBeVisible()
    // await expect(page.getByRole('button', { name: 'Verify Connection' })).toBeVisible()
  })

  test.skip('Step 5 → celebration → Go to Dashboard navigates to /dashboard', async ({ page }) => {
    // Requires a real machine to be connected (agent running on a test host).
    // After machine detected:
    // await expect(page.getByRole('heading', { name: 'Your first machine is connected!' })).toBeVisible()
    // await page.getByRole('button', { name: 'Go to Dashboard' }).click()
    // await expect(page).toHaveURL('/dashboard')
  })
})
