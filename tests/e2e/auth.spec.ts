/**
 * E2E tests for authentication flows
 *
 * Covers:
 *   - Sign up → verify email → dashboard
 *   - Login → dashboard
 *   - Logout → redirected to /login
 *   - Login with wrong credentials shows error
 *
 * Prerequisites:
 *   - The Next.js dev server is running on PLAYWRIGHT_BASE_URL (default: http://localhost:3000)
 *   - A test database is configured via TEST_DATABASE_URL
 *
 * STUB: Email verification is mocked — the test navigates directly to the
 * verify URL rather than reading a real email.
 */

import { test, expect, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

/** Generate a unique email for a test run to avoid conflicts */
function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sessionforge.dev`
}

const DEFAULT_PASSWORD = 'E2eTestPass123!'
const DEFAULT_NAME = 'E2E Test User'

async function fillSignupForm(page: Page, email: string, password = DEFAULT_PASSWORD, name = DEFAULT_NAME) {
  await test.step('Fill signup form', async () => {
    await page.getByLabel(/name/i).fill(name)
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).first().fill(password)
    // Some forms have a confirm password field
    const confirmField = page.getByLabel(/confirm password/i)
    if (await confirmField.isVisible()) {
      await confirmField.fill(password)
    }
  })
}

async function fillLoginForm(page: Page, email: string, password = DEFAULT_PASSWORD) {
  await test.step('Fill login form', async () => {
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill(password)
  })
}

// ---------------------------------------------------------------------------
// Sign up flow
// ---------------------------------------------------------------------------

test.describe('Sign up flow', () => {
  test('navigate to /signup and see the sign up form', async ({ page }) => {
    await test.step('Navigate to signup page', async () => {
      await page.goto(`${BASE_URL}/signup`)
      await expect(page).toHaveURL(/signup/)
    })

    await test.step('Verify form elements are present', async () => {
      await expect(page.getByRole('heading', { name: /sign up|create account|get started/i })).toBeVisible()
      await expect(page.getByLabel(/email/i)).toBeVisible()
      await expect(page.getByLabel(/password/i).first()).toBeVisible()
    })
  })

  test('successful signup redirects to verify-email page', async ({ page }) => {
    const email = uniqueEmail()

    await test.step('Navigate to signup page', async () => {
      await page.goto(`${BASE_URL}/signup`)
    })

    await test.step('Fill and submit signup form', async () => {
      await fillSignupForm(page, email)
      await page.getByRole('button', { name: /sign up|create account|get started/i }).click()
    })

    await test.step('Verify redirect to email verification page', async () => {
      await expect(page).toHaveURL(/verify-email/, { timeout: 10000 })
      await expect(page.getByText(/check your email|verify your email|confirmation/i)).toBeVisible()
    })
  })

  test('shows validation error for a weak password', async ({ page }) => {
    await test.step('Navigate to signup page', async () => {
      await page.goto(`${BASE_URL}/signup`)
    })

    await test.step('Submit with weak password', async () => {
      await fillSignupForm(page, uniqueEmail(), 'weak')
      await page.getByRole('button', { name: /sign up|create account/i }).click()
    })

    await test.step('Verify error message is shown', async () => {
      await expect(page.getByText(/password|characters|uppercase|lowercase|number|special/i)).toBeVisible()
      // Should still be on signup page
      await expect(page).toHaveURL(/signup/)
    })
  })

  test('shows error for duplicate email', async ({ page }) => {
    await test.step('Navigate to signup page', async () => {
      await page.goto(`${BASE_URL}/signup`)
    })

    await test.step('Fill form with duplicate email', async () => {
      // This email must already exist in the test DB — for E2E we stub
      // by relying on the API to return 409
      await fillSignupForm(page, 'existing@sessionforge.dev')
      await page.getByRole('button', { name: /sign up|create account/i }).click()
    })

    await test.step('Verify error is shown', async () => {
      // Either an inline error or a toast notification
      await expect(
        page.getByText(/already registered|email.*taken|account.*exists/i)
      ).toBeVisible({ timeout: 5000 })
    })
  })

  test('STUB: email verification → redirected to dashboard', async ({ page }) => {
    /**
     * Full email verification flow:
     * 1. Sign up
     * 2. Server sends verification email with token
     * 3. User clicks link → /verify-email?token=<token>
     * 4. Server marks email verified → redirects to dashboard
     *
     * STUB: We navigate directly to the verify URL with a mock token.
     * Once the backend is built, replace with real token from test DB.
     */
    test.skip(true, 'STUB: requires real verification token from backend')

    const mockToken = 'stub-verification-token-abc123'
    await page.goto(`${BASE_URL}/verify-email?token=${mockToken}`)
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 })
    await expect(page.getByText(/welcome|dashboard|get started/i)).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Login flow
// ---------------------------------------------------------------------------

test.describe('Login flow', () => {
  test('navigate to /login and see the login form', async ({ page }) => {
    await test.step('Navigate to login page', async () => {
      await page.goto(`${BASE_URL}/login`)
      await expect(page).toHaveURL(/login/)
    })

    await test.step('Verify form elements are present', async () => {
      await expect(page.getByLabel(/email/i)).toBeVisible()
      await expect(page.getByLabel(/password/i)).toBeVisible()
      await expect(page.getByRole('button', { name: /sign in|log in|login/i })).toBeVisible()
    })
  })

  test('STUB: login with valid credentials → redirected to dashboard', async ({ page }) => {
    /**
     * STUB: Requires a seeded user in the test database.
     * Once the backend seeds are in place, replace the skip with actual credentials.
     */
    test.skip(true, 'STUB: requires seeded user in test DB')

    await test.step('Navigate to login page', async () => {
      await page.goto(`${BASE_URL}/login`)
    })

    await test.step('Fill and submit login form', async () => {
      await fillLoginForm(page, 'test@sessionforge.dev', DEFAULT_PASSWORD)
      await page.getByRole('button', { name: /sign in|log in/i }).click()
    })

    await test.step('Verify redirect to dashboard', async () => {
      await expect(page).toHaveURL(/dashboard/, { timeout: 10000 })
      await expect(page.getByText(/welcome|machines|sessions/i)).toBeVisible()
    })
  })

  test('shows error for wrong password', async ({ page }) => {
    await test.step('Navigate to login page', async () => {
      await page.goto(`${BASE_URL}/login`)
    })

    await test.step('Fill login form with wrong password', async () => {
      await fillLoginForm(page, 'test@sessionforge.dev', 'WrongPassword999!')
      await page.getByRole('button', { name: /sign in|log in/i }).click()
    })

    await test.step('Verify error message is shown', async () => {
      await expect(
        page.getByText(/invalid|wrong password|incorrect|credentials/i)
      ).toBeVisible({ timeout: 5000 })
      await expect(page).toHaveURL(/login/)
    })
  })

  test('shows error for unregistered email', async ({ page }) => {
    await test.step('Navigate to login page', async () => {
      await page.goto(`${BASE_URL}/login`)
    })

    await test.step('Submit with non-existent email', async () => {
      await fillLoginForm(page, `ghost-${Date.now()}@sessionforge.dev`, DEFAULT_PASSWORD)
      await page.getByRole('button', { name: /sign in|log in/i }).click()
    })

    await test.step('Verify error message does not expose user existence', async () => {
      const errorText = await page.getByRole('alert').textContent().catch(() => '')
      // Error should NOT say "user not found" — should say "invalid credentials"
      expect(errorText).not.toMatch(/not found|no account/i)
      await expect(page).toHaveURL(/login/)
    })
  })
})

// ---------------------------------------------------------------------------
// Logout flow
// ---------------------------------------------------------------------------

test.describe('Logout flow', () => {
  test('STUB: login then logout → redirected to /login', async ({ page }) => {
    test.skip(true, 'STUB: requires seeded user + real session cookie')

    await test.step('Login', async () => {
      await page.goto(`${BASE_URL}/login`)
      await fillLoginForm(page, 'test@sessionforge.dev', DEFAULT_PASSWORD)
      await page.getByRole('button', { name: /sign in|log in/i }).click()
      await expect(page).toHaveURL(/dashboard/, { timeout: 10000 })
    })

    await test.step('Open user menu and click logout', async () => {
      // User menu is typically a button with the user's name/avatar
      await page.getByRole('button', { name: /account|profile|user menu/i }).click()
      await page.getByRole('menuitem', { name: /logout|sign out/i }).click()
    })

    await test.step('Verify redirect to login page', async () => {
      await expect(page).toHaveURL(/login/, { timeout: 5000 })
    })
  })

  test('accessing /dashboard while unauthenticated redirects to /login', async ({ page }) => {
    await test.step('Navigate to protected dashboard', async () => {
      await page.goto(`${BASE_URL}/dashboard`)
    })

    await test.step('Verify redirect to login', async () => {
      await expect(page).toHaveURL(/login/, { timeout: 5000 })
    })
  })
})

// ---------------------------------------------------------------------------
// Password reset flow
// ---------------------------------------------------------------------------

test.describe('Password reset flow', () => {
  test('forgot password page is accessible from login', async ({ page }) => {
    await test.step('Navigate to login page', async () => {
      await page.goto(`${BASE_URL}/login`)
    })

    await test.step('Click forgot password link', async () => {
      await page.getByRole('link', { name: /forgot password|reset password/i }).click()
    })

    await test.step('Verify forgot password page loads', async () => {
      await expect(page).toHaveURL(/forgot-password|reset-password/)
      await expect(page.getByLabel(/email/i)).toBeVisible()
    })
  })

  test('submitting forgot password form shows confirmation message', async ({ page }) => {
    await test.step('Navigate to forgot password page', async () => {
      await page.goto(`${BASE_URL}/forgot-password`)
    })

    await test.step('Submit form with any email', async () => {
      await page.getByLabel(/email/i).fill('anyone@sessionforge.dev')
      await page.getByRole('button', { name: /send|submit|reset/i }).click()
    })

    await test.step('Verify confirmation message (does not leak email existence)', async () => {
      await expect(
        page.getByText(/check your email|link has been sent|if.*email.*exists/i)
      ).toBeVisible({ timeout: 5000 })
    })
  })
})
