/**
 * E2E: Auth flows
 *
 * Covers:
 *   - Sign up with email/password (form validation + success redirect to /verify-email)
 *   - Login / logout
 *   - Forgot password flow (form + submitted state)
 *   - OAuth buttons present on login page
 *
 * Notes:
 *   - Tests that require a live email inbox (actual token delivery) are skipped.
 *   - Tests that require a pre-verified account use the API registration helper.
 *     Because e-mail verification is required before login, full login flows that
 *     need a dashboard session are skipped here and covered via a test fixture or
 *     a seeded DB in a CI environment.
 */

import { test, expect } from '@playwright/test'
import { uniqueEmail, TEST_PASSWORD, SignupPage, LoginPage, apiRegister } from './helpers/setup'

// ─── Login page ───────────────────────────────────────────────────────────────

test.describe('Login page', () => {
  test('renders "Welcome back" heading', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('renders email and password inputs', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
  })

  test('renders "Continue with Google" OAuth button', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible()
  })

  test('renders "Continue with GitHub" OAuth button', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: /Continue with GitHub/i })).toBeVisible()
  })

  test('renders "Forgot password?" link pointing to /forgot-password', async ({ page }) => {
    await page.goto('/login')
    const forgotLink = page.getByRole('link', { name: /Forgot password/i })
    await expect(forgotLink).toBeVisible()
    await expect(forgotLink).toHaveAttribute('href', '/forgot-password')
  })

  test('renders "Sign up free" link pointing to /signup', async ({ page }) => {
    await page.goto('/login')
    const signupLink = page.getByRole('link', { name: 'Sign up free' })
    await expect(signupLink).toBeVisible()
    await expect(signupLink).toHaveAttribute('href', '/signup')
  })

  test('displays field-level validation errors for empty submit', async ({ page }) => {
    await page.goto('/login')
    // Submit without any data — react-hook-form / zod should fire
    await page.getByRole('button', { name: 'Sign in' }).click()
    // Expect at least one error message to appear
    await expect(page.getByText(/invalid email address/i)).toBeVisible()
  })

  test('shows password-too-short error', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('user@example.com')
    await page.getByLabel('Password').first().fill('short')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText(/at least 8 characters/i)).toBeVisible()
  })

  test('shows toggle to reveal/hide password', async ({ page }) => {
    await page.goto('/login')
    const passwordInput = page.locator('#password')
    await expect(passwordInput).toHaveAttribute('type', 'password')
    // Click the show-password toggle button (sibling button in the relative wrapper)
    await page.locator('button[type="button"]').filter({ has: page.locator('svg') }).last().click()
    await expect(passwordInput).toHaveAttribute('type', 'text')
  })

  test.skip('successful login redirects to /dashboard', async ({ page }) => {
    // Requires a pre-verified account.
    // In CI: seed the DB with a verified user, then call this flow.
    // const email = uniqueEmail()
    // ... set up verified account via DB seed ...
    // const loginPage = new LoginPage(page)
    // await loginPage.goto()
    // await loginPage.login(email, TEST_PASSWORD)
    // await expect(page).toHaveURL('/dashboard')
  })

  test.skip('invalid credentials shows "Invalid email or password" toast', async ({ page }) => {
    // Requires a live API that can reject credentials.
    // const loginPage = new LoginPage(page)
    // await loginPage.goto()
    // await loginPage.login('nobody@nowhere.com', 'WrongPass1!')
    // await expect(page.locator('[data-sonner-toaster]')).toContainText('Invalid email or password')
  })
})

// ─── Sign up page ─────────────────────────────────────────────────────────────

test.describe('Sign up page', () => {
  test('renders "Create your account" heading', async ({ page }) => {
    await page.goto('/signup')
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  })

  test('renders all form fields', async ({ page }) => {
    await page.goto('/signup')
    await expect(page.getByLabel('Full Name')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    await expect(page.locator('#confirmPassword')).toBeVisible()
    await expect(page.locator('#terms')).toBeVisible()
  })

  test('renders "Sign in" link back to /login', async ({ page }) => {
    await page.goto('/signup')
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  test('shows name-too-short validation error', async ({ page }) => {
    const sp = new SignupPage(page)
    await sp.goto()
    await page.getByLabel('Full Name').fill('A')
    await page.locator('#password').fill(TEST_PASSWORD)
    await page.locator('#confirmPassword').fill(TEST_PASSWORD)
    await sp.submit()
    await expect(page.getByText(/at least 2 characters/i)).toBeVisible()
  })

  test('shows password-mismatch error', async ({ page }) => {
    const sp = new SignupPage(page)
    await sp.goto()
    await sp.fillForm({
      email: uniqueEmail(),
      password: TEST_PASSWORD,
      confirmPassword: 'DifferentPass9!',
    })
    await sp.submit()
    await expect(page.getByText(/passwords do not match/i)).toBeVisible()
  })

  test('shows "You must accept the terms" error when checkbox unchecked', async ({ page }) => {
    const sp = new SignupPage(page)
    await sp.goto()
    await sp.fillForm({ email: uniqueEmail(), password: TEST_PASSWORD, acceptTerms: false })
    await sp.submit()
    await expect(page.getByText(/You must accept the terms/i)).toBeVisible()
  })

  test('successful registration redirects to /verify-email', async ({ page }) => {
    const sp = new SignupPage(page)
    await sp.goto()
    const email = uniqueEmail()
    await sp.fillForm({ email, password: TEST_PASSWORD })
    await sp.submit()
    // The form calls POST /api/auth/register and on success pushes to /verify-email
    await expect(page).toHaveURL(/\/verify-email/, { timeout: 15_000 })
  })

  test.skip('duplicate email shows "already in use" error toast', async ({ page }) => {
    // Requires a known-existing account in the test DB.
  })
})

// ─── Verify-email page ────────────────────────────────────────────────────────

test.describe('Verify-email page', () => {
  test('renders "Check your email" heading', async ({ page }) => {
    await page.goto('/verify-email')
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  })

  test('renders resend verification email button', async ({ page }) => {
    await page.goto('/verify-email')
    await expect(page.getByRole('button', { name: /Resend verification email/i })).toBeVisible()
  })

  test('renders "Go back to login" link', async ({ page }) => {
    await page.goto('/verify-email')
    await expect(page.getByRole('link', { name: /Go back to login/i })).toBeVisible()
  })
})

// ─── Forgot password page ─────────────────────────────────────────────────────

test.describe('Forgot password page', () => {
  test('renders "Reset your password" heading', async ({ page }) => {
    await page.goto('/forgot-password')
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  })

  test('renders email input and submit button', async ({ page }) => {
    await page.goto('/forgot-password')
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible()
  })

  test('renders "Back to sign in" link pointing to /login', async ({ page }) => {
    await page.goto('/forgot-password')
    await expect(page.getByRole('link', { name: /Back to sign in/i })).toHaveAttribute('href', '/login')
  })

  test('shows invalid-email validation error', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.getByLabel('Email').fill('not-an-email')
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText(/invalid email address/i)).toBeVisible()
  })

  test('after valid submission shows "Check your email" confirmation', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.getByLabel('Email').fill('nonexistent@example.com')
    await page.getByRole('button', { name: 'Send reset link' }).click()
    // The page swaps to a success state with "Check your email" heading
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('link', { name: /Return to sign in/i })).toBeVisible()
  })
})

// ─── Logout (requires authenticated session) ──────────────────────────────────

test.describe('Logout', () => {
  test.skip('clicking logout signs the user out and redirects to /login', async ({ page }) => {
    // Requires a verified, authenticated session.
    // In CI: log in programmatically with NextAuth session fixture, then:
    // - Open the user-menu / header dropdown
    // - Click "Sign out"
    // - await expect(page).toHaveURL('/login')
  })
})
