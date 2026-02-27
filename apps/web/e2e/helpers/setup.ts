/**
 * Shared helpers and page-object wrappers for the SessionForge E2E suite.
 *
 * Design notes:
 * - BASE_URL is read from process.env.BASE_URL, falling back to
 *   https://sessionforge.dev. It is also set as playwright baseURL so
 *   page.goto('/login') works without the helper everywhere. The constant
 *   here is used for direct API calls via page.request.
 * - Page objects wrap only the actions that are reused across multiple
 *   spec files; they are not exhaustive wrappers.
 */

import { type Page, type BrowserContext, expect } from '@playwright/test'

// ─── Base URL ─────────────────────────────────────────────────────────────────

export const BASE_URL = process.env.BASE_URL ?? 'https://sessionforge.dev'

// ─── Unique-value generators ──────────────────────────────────────────────────

/**
 * Returns a unique e-mail address that is safe to use for test registrations.
 * Uses a timestamp + random suffix so concurrent workers don't collide.
 */
export function uniqueEmail(): string {
  const suffix = Math.random().toString(36).slice(2, 8)
  return `e2e+${Date.now()}_${suffix}@sessionforge-test.dev`
}

/** Strong password that satisfies the signup schema (8+ chars, uppercase, number). */
export const TEST_PASSWORD = 'E2eTest1!'

// ─── API helpers ──────────────────────────────────────────────────────────────

/**
 * Calls POST /api/auth/register directly and returns the raw response.
 * Useful when a test needs a fresh account without going through the UI.
 */
export async function apiRegister(
  page: Page,
  payload: { email: string; password: string; name?: string },
) {
  const res = await page.request.post(`${BASE_URL}/api/auth/register`, {
    data: { name: 'E2E User', ...payload },
    headers: { 'Content-Type': 'application/json' },
  })
  return { status: res.status(), body: await res.json() }
}

// ─── Page Objects ─────────────────────────────────────────────────────────────

/**
 * LoginPage — wraps /login interactions.
 */
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/login')
  }

  async fillEmail(email: string) {
    await this.page.getByLabel('Email').fill(email)
  }

  async fillPassword(password: string) {
    await this.page.getByLabel('Password').first().fill(password)
  }

  async submit() {
    await this.page.getByRole('button', { name: 'Sign in' }).click()
  }

  /** Fills credentials and submits the login form. */
  async login(email: string, password: string) {
    await this.fillEmail(email)
    await this.fillPassword(password)
    await this.submit()
  }
}

/**
 * SignupPage — wraps /signup interactions.
 */
export class SignupPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/signup')
  }

  async fillForm(opts: {
    name?: string
    email: string
    password: string
    confirmPassword?: string
    acceptTerms?: boolean
  }) {
    const { name = 'E2E User', email, password, confirmPassword = password, acceptTerms = true } = opts

    await this.page.getByLabel('Full Name').fill(name)
    await this.page.getByLabel('Email').fill(email)
    // Label "Password" appears twice; pick the first (Password field)
    await this.page.locator('#password').fill(password)
    await this.page.locator('#confirmPassword').fill(confirmPassword)
    if (acceptTerms) {
      const termsCheckbox = this.page.locator('#terms')
      if (!(await termsCheckbox.isChecked())) {
        await termsCheckbox.check()
      }
    }
  }

  async submit() {
    await this.page.getByRole('button', { name: 'Create Account' }).click()
  }
}

/**
 * DashboardPage — wraps common dashboard navigation.
 */
export class DashboardPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/dashboard')
  }

  /** Waits for the dashboard "Overview" heading to appear. */
  async waitForLoad() {
    await expect(this.page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  }

  /** Navigates to a sidebar item by its label. */
  async navigateTo(label: 'Dashboard' | 'Machines' | 'Sessions' | 'API Keys' | 'Settings') {
    await this.page.getByRole('link', { name: label, exact: true }).first().click()
  }
}

/**
 * Waits for the Sonner toast with the given text to appear.
 * Sonner renders toasts in a <ol data-sonner-toaster> element.
 */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator('[data-sonner-toaster]')).toContainText(
    typeof text === 'string' ? text : text,
    { timeout: 8_000 },
  )
}
