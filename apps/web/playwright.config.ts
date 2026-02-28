import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for SessionForge E2E tests.
 *
 * Base URL defaults to https://sessionforge.dev (production).
 * Override via the BASE_URL environment variable, e.g.:
 *   BASE_URL=http://localhost:3000 npx playwright test
 *
 * Authenticated tests require E2E_TEST_SECRET to match the server env var.
 * The global setup will register+verify a user and save cookies to e2e/.auth/user.json.
 */

const BASE_URL = process.env.BASE_URL ?? 'https://sessionforge.dev'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  globalSetup: './e2e/global-setup.ts',

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // Unauthenticated tests — no storage state
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/dashboard.spec.ts', '**/onboarding.spec.ts'],
    },
    // Authenticated tests — uses session cookie from global-setup
    {
      name: 'chromium-auth',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      testMatch: ['**/dashboard.spec.ts', '**/onboarding.spec.ts'],
    },
  ],
})
