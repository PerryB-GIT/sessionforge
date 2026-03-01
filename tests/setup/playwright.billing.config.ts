/**
 * Playwright config for billing E2E tests against live sessionforge.dev.
 * Uses pre-seeded test users — no global-setup required.
 */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '../e2e',
  testMatch: '**/billing.spec.ts',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: 1,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://sessionforge.dev',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: { 'x-test-run': 'playwright-billing' },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
