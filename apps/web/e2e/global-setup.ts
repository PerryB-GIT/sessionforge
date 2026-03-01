import { chromium, type FullConfig } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'https://sessionforge.dev'
const E2E_TEST_SECRET = process.env.E2E_TEST_SECRET ?? ''
const E2E_USER_EMAIL = `e2e+${Date.now()}@sessionforge.dev`
const E2E_USER_PASSWORD = 'E2eTest1!'
const E2E_USER_NAME = 'E2E Test User'

async function globalSetup(_config: FullConfig) {
  if (!E2E_TEST_SECRET) {
    console.warn('[global-setup] E2E_TEST_SECRET not set — skipping auth fixture creation. Authenticated tests will be skipped.')
    return
  }

  // 1. Register a fresh test user — get verification token back via test bypass header
  const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-e2e-test-secret': E2E_TEST_SECRET,
    },
    body: JSON.stringify({
      name: E2E_USER_NAME,
      email: E2E_USER_EMAIL,
      password: E2E_USER_PASSWORD,
    }),
  })

  if (!registerRes.ok) {
    const body = await registerRes.text()
    throw new Error(`[global-setup] Registration failed (${registerRes.status}): ${body}`)
  }

  const { verificationToken } = await registerRes.json()
  if (!verificationToken) {
    throw new Error('[global-setup] No verificationToken returned — check E2E_TEST_SECRET is correct and set in the app')
  }

  // 2. Verify email via the verify-email API route
  const verifyRes = await fetch(`${BASE_URL}/api/auth/verify-email?token=${verificationToken}`, {
    redirect: 'manual', // Don't follow redirects — just verify the token was consumed
  })
  // Expect a 307/302 redirect to /login?verified=1
  if (verifyRes.status !== 307 && verifyRes.status !== 302 && verifyRes.status !== 200) {
    throw new Error(`[global-setup] Email verification failed (${verifyRes.status})`)
  }

  // 3. Log in via browser to get a real session cookie
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: BASE_URL })
  const page = await context.newPage()

  await page.goto('/login')
  await page.getByLabel('Email').fill(E2E_USER_EMAIL)
  await page.getByLabel('Password').fill(E2E_USER_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Should redirect to /onboarding (new user) — wait for navigation
  await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 15000 })

  // 4. Complete onboarding via API so tests start at /dashboard
  const cookies = await context.cookies()
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  const onboardRes = await fetch(`${BASE_URL}/api/onboarding/complete`, {
    method: 'POST',
    headers: { Cookie: cookieHeader },
  })

  if (!onboardRes.ok) {
    console.warn(`[global-setup] Onboarding complete returned ${onboardRes.status} — user may already be onboarded`)
  }

  // 5. Re-login so the JWT is reissued with onboardingCompletedAt populated.
  //    The JWT is minted at sign-in time, so onboarding must complete first,
  //    then a fresh sign-in bakes the flag into the token.
  //    Clear session cookies manually rather than going through the signout UI.
  await context.clearCookies()

  await page.goto('/login')
  await page.waitForSelector('label', { timeout: 10000 })
  await page.getByLabel('Email').fill(E2E_USER_EMAIL)
  await page.getByLabel('Password').fill(E2E_USER_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // After fresh login with onboardingCompletedAt set, should go to /dashboard
  await page.waitForURL(/\/dashboard/, { timeout: 15000 })

  // 6. Save storage state (cookies) for use by authenticated tests
  await context.storageState({ path: 'e2e/.auth/user.json' })

  // Save test user credentials for reference
  process.env.E2E_USER_EMAIL = E2E_USER_EMAIL
  process.env.E2E_USER_PASSWORD = E2E_USER_PASSWORD

  await browser.close()
  console.log(`[global-setup] Auth fixture created for ${E2E_USER_EMAIL}`)
}

export default globalSetup
