import { defineConfig, devices } from '@playwright/test'

const isCI = Boolean(process.env.CI)

export default defineConfig({
  // Root directory where test files are located
  testDir: '../e2e',
  testMatch: '**/*.spec.ts',

  // Maximum time a test can run before it is considered failed
  timeout: 30_000,

  // Maximum time an expect() assertion is allowed to wait
  expect: {
    timeout: 8_000,
  },

  // Base URL for all page.goto() calls
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',

    // Collect traces on first retry of a failing test
    trace: 'on-first-retry',

    // Take screenshot on test failure
    screenshot: 'only-on-failure',

    // Record video on test failure
    video: 'on-first-retry',

    // Additional HTTP headers
    extraHTTPHeaders: {
      'x-test-run': 'playwright',
    },
  },

  // Retry failed tests twice in CI to reduce flakiness noise
  retries: isCI ? 2 : 0,

  // Run tests serially in CI to avoid DB conflicts between parallel workers
  workers: isCI ? 1 : undefined,

  // Reporter configuration
  reporter: isCI
    ? [['github'], ['json', { outputFile: 'test-results/results.json' }], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'on-failure' }]],

  // Output directory for screenshots, videos, traces
  outputDir: 'test-results',

  // Global setup / teardown run once for the whole test suite
  // globalSetup: './global-setup.ts',
  // globalTeardown: './global-teardown.ts',

  projects: [
    // Use Chromium only for CI speed. Local devs can add Firefox/WebKit as needed.
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use a persistent auth state file so login is performed once
        // storageState: 'tests/setup/.auth/user.json',
      },
    },
  ],

  // Start the dev server automatically when running tests locally
  webServer: isCI
    ? undefined
    : {
        command: 'npm run dev --workspace=@sessionforge/web',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
        cwd: '../../../',
      },
})
