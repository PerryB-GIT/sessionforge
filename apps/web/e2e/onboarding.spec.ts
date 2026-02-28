/**
 * E2E: Onboarding wizard
 *
 * Covers:
 *   - Unauthenticated /onboarding redirects to /login
 *   - Step 1 (Organization): org name input, Create Organization button, short-name error
 *   - Step 2 (API Key): Generate API Key button, key displayed with sf_live_ prefix, copy button
 *   - Step 3 (Install Agent): Linux/macOS/Windows OS list, install curl command, "I ran the command" button
 *   - Step 4 (Verify Connection): polling state shown, "Verify Connection" button, machine connected state
 *   - Step 5 (Done): celebration message, "Go to Dashboard" button navigates to /dashboard
 *
 * Authentication strategy:
 *   All tests that require an authenticated session are marked test.skip.
 *   To enable them, supply a storageState fixture by adding to playwright.config.ts:
 *     use: { storageState: 'e2e/.auth/user.json' }
 *   and creating a globalSetup script that registers + verifies a test user and
 *   serialises the cookie jar to that file.
 *
 * Notes about the wizard:
 *   - Step 1 form uses orgSchema: orgName must be at least 2 characters.
 *   - Step 2 shows a "Generate API Key" button, then after creation displays
 *     the full key in a <code> element. The "I've saved my key" continue button
 *     is disabled until the copy button is clicked (apiKeyCopied === true).
 *   - Step 3 lists supported OSes (Linux, macOS, Windows) and the curl install
 *     command. Advancing requires clicking "I ran the command".
 *   - Step 4 shows a "Verify Connection" button that polls /api/machines. While
 *     polling, the button text changes to "Checking for machine..." and a
 *     "This usually takes a few seconds..." note appears.
 *   - Step 5 renders the PartyPopper icon, "Your first machine is connected!"
 *     heading, and "Go to Dashboard" / "Start a Session" buttons.
 */

import { test, expect } from '@playwright/test'

// ─── Unauthenticated guard ────────────────────────────────────────────────────

test.describe('Onboarding unauthenticated guard', () => {
  test('unauthenticated /onboarding redirects to /login', async ({ page }) => {
    await page.goto('/onboarding')
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  })
})

// ─── Step 1: Organization ─────────────────────────────────────────────────────

test.describe('Onboarding — Step 1 (Organization)', () => {
  test('step 1 renders org name input and Create Organization button', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: global-setup.ts to register+verify a user and serialize cookies
    await page.goto('/onboarding')
    // Step 1 heading from OnboardingWizard.tsx line 200
    await expect(page.getByRole('heading', { name: 'Welcome to SessionForge' })).toBeVisible()
    // Label htmlFor="orgName" → "Organization Name"
    await expect(page.getByLabel('Organization Name')).toBeVisible()
    // Submit button text: "Create Organization"
    await expect(page.getByRole('button', { name: /Create Organization/i })).toBeVisible()
  })

  test('step 1 shows validation error when org name is too short', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: global-setup.ts to register+verify a user and serialize cookies
    // orgSchema: orgName must be at least 2 characters → "Organization name must be at least 2 characters"
    await page.goto('/onboarding')
    await page.getByLabel('Organization Name').fill('X')
    await page.getByRole('button', { name: /Create Organization/i }).click()
    await expect(page.getByText(/at least 2 characters/i)).toBeVisible()
  })

  test('step 1 shows all five step labels in the step indicator', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: global-setup.ts to register+verify a user and serialize cookies
    // STEPS array: Organization, API Key, Install Agent, Verify, Done!
    await page.goto('/onboarding')
    await expect(page.getByText('Organization').first()).toBeVisible()
    await expect(page.getByText('API Key').first()).toBeVisible()
    await expect(page.getByText('Install Agent').first()).toBeVisible()
    await expect(page.getByText('Verify').first()).toBeVisible()
    await expect(page.getByText('Done!').first()).toBeVisible()
  })

  test('step 1 advances to step 2 after successful org creation', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: live /api/orgs POST endpoint
    await page.goto('/onboarding')
    await page.getByLabel('Organization Name').fill('E2E Test Org')
    await page.getByRole('button', { name: /Create Organization/i }).click()
    // After success the wizard transitions to step 2
    await expect(page.getByRole('heading', { name: 'Create Your First API Key' })).toBeVisible()
  })
})

// ─── Step 2: API Key ──────────────────────────────────────────────────────────

test.describe('Onboarding — Step 2 (API Key)', () => {
  test('step 2 shows Generate API Key button before key is created', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: authenticated user whose org was already created (advance to step 2 first)
    // Setup: call /api/orgs in beforeEach or use a fixture that has completed step 1
    await page.goto('/onboarding')
    // Assumes reaching step 2 — adjust if a fixture navigates directly
    await expect(page.getByRole('button', { name: /Generate API Key/i })).toBeVisible()
  })

  test('step 2 displays generated key with sf_live_ prefix in a code element', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: live /api/keys POST endpoint
    // After clicking "Generate API Key" the key is returned and shown once.
    await page.goto('/onboarding')
    await page.getByRole('button', { name: /Generate API Key/i }).click()
    // Key is rendered as: <code class="...font-mono...">{apiKey}</code>
    // The API returns a key with the sf_live_ prefix
    await expect(page.locator('code').filter({ hasText: /sf_live_/ })).toBeVisible()
    // "Your API Key (copy now!)" label
    await expect(page.getByText(/Your API Key/i)).toBeVisible()
  })

  test('step 2 copy button is present after key generation', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: live /api/keys POST endpoint
    await page.goto('/onboarding')
    await page.getByRole('button', { name: /Generate API Key/i }).click()
    // Copy button is a plain <button> (not role="button") adjacent to the key code block
    await expect(page.getByText(/^Copy$/).first()).toBeVisible()
  })

  test('step 2 continue button is disabled until copy button is clicked', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: live /api/keys POST endpoint
    // "I've saved my key" button has: disabled={!apiKeyCopied}
    await page.goto('/onboarding')
    await page.getByRole('button', { name: /Generate API Key/i }).click()
    await expect(page.getByRole('button', { name: /I've saved my key/i })).toBeDisabled()
  })
})

// ─── Step 3: Install Agent ────────────────────────────────────────────────────

test.describe('Onboarding — Step 3 (Install Agent)', () => {
  test('step 3 shows Linux, macOS, and Windows in the supported OS list', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: authenticated user advanced to step 3
    // The "Supports:" block lists Linux (...), macOS (...), Windows (...)
    await page.goto('/onboarding')
    // Navigate to step 3 programmatically via state (fixture/seed) or by
    // completing steps 1 and 2 first.
    await expect(page.getByRole('heading', { name: 'Install the Agent' })).toBeVisible()
    await expect(page.getByText(/Linux/i).first()).toBeVisible()
    await expect(page.getByText(/macOS/i).first()).toBeVisible()
    await expect(page.getByText(/Windows/i).first()).toBeVisible()
  })

  test('step 3 shows the curl install command', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: authenticated user advanced to step 3
    // INSTALL_COMMAND = `curl -fsSL https://sessionforge.dev/install.sh | sh`
    await page.goto('/onboarding')
    await expect(page.getByText(/curl -fsSL/)).toBeVisible()
  })

  test('step 3 shows "I ran the command" button to advance to step 4', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: authenticated user advanced to step 3
    await page.goto('/onboarding')
    await expect(page.getByRole('button', { name: /I ran the command/i })).toBeVisible()
  })

  test('clicking "I ran the command" advances wizard to step 4', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: authenticated user advanced to step 3
    await page.goto('/onboarding')
    await page.getByRole('button', { name: /I ran the command/i }).click()
    await expect(page.getByRole('heading', { name: 'Verify Connection' })).toBeVisible()
  })
})

// ─── Step 4: Verify Connection ────────────────────────────────────────────────

test.describe('Onboarding — Step 4 (Verify Connection)', () => {
  test('step 4 shows Verify Connection heading and button', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: authenticated user advanced to step 4
    await page.goto('/onboarding')
    await expect(page.getByRole('heading', { name: 'Verify Connection' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Verify Connection/i })).toBeVisible()
  })

  test('step 4 shows polling state text while verifying', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: authenticated user advanced to step 4
    // While isVerifying === true the button text changes and a note appears:
    //   "This usually takes a few seconds..."
    await page.goto('/onboarding')
    await page.getByRole('button', { name: /Verify Connection/i }).click()
    await expect(page.getByText(/Checking for machine/i)).toBeVisible()
    await expect(page.getByText(/This usually takes a few seconds/i)).toBeVisible()
  })

  test('step 4 advances to step 5 when a machine is detected', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: a real machine running the SessionForge agent that connects
    //           within the polling window (12 × 2500 ms = 30 s).
    await page.goto('/onboarding')
    await page.getByRole('button', { name: /Verify Connection/i }).click()
    // verifyConnection() sets step(5) on success
    await expect(page.getByRole('heading', { name: 'Your first machine is connected!' })).toBeVisible({
      timeout: 35_000,
    })
  })
})

// ─── Step 5: Done ─────────────────────────────────────────────────────────────

test.describe('Onboarding — Step 5 (Done)', () => {
  test('step 5 shows celebration message', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: authenticated user that reached step 5 (machine detected)
    // Heading from OnboardingWizard.tsx line 376: "Your first machine is connected!"
    await page.goto('/onboarding')
    // Advance to step 5 by seeding state or completing the full flow
    await expect(
      page.getByRole('heading', { name: 'Your first machine is connected!' }),
    ).toBeVisible()
    await expect(
      page.getByText(/Head to your dashboard to start managing sessions/i),
    ).toBeVisible()
  })

  test('step 5 Go to Dashboard button navigates to /dashboard', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: authenticated user at step 5
    await page.goto('/onboarding')
    // Advance to step 5 (seeded state or full flow)
    await page.getByRole('button', { name: /Go to Dashboard/i }).click()
    await expect(page).toHaveURL('/dashboard')
  })

  test('step 5 Start a Session button navigates to /sessions', async ({ page }) => {
    // Enable with: use: { storageState: 'e2e/.auth/user.json' }
    // Requires: authenticated user at step 5
    await page.goto('/onboarding')
    // Advance to step 5
    await page.getByRole('button', { name: /Start a Session/i }).click()
    await expect(page).toHaveURL('/sessions')
  })
})
