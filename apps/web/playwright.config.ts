import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for SessionForge E2E tests.
 *
 * Base URL defaults to https://sessionforge.dev (production).
 * Override via the BASE_URL environment variable, e.g.:
 *   BASE_URL=http://localhost:3000 npx playwright test
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
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
