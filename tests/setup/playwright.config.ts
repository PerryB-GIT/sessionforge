import { defineConfig, devices } from '@playwright/test'
import { STORAGE_STATE } from './global-setup'

const isCI = Boolean(process.env.CI)
const isPostDeploy = Boolean(process.env.POST_DEPLOY)

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
    baseURL: isPostDeploy
      ? (process.env.PLAYWRIGHT_BASE_URL ?? 'https://sessionforge.dev')
      : (process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'),

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

  // Global setup runs once before all tests.
  // In post-deploy mode it seeds a test user and saves storage state.
  globalSetup: isPostDeploy ? './global-setup.ts' : undefined,

  projects: isPostDeploy
    ? [
        // --- Post-deploy projects ---
        // "setup" project runs global-setup-like login; actual setup is in globalSetup above.
        // "unauthenticated" — no stored session (for redirect tests, OAuth checks)
        {
          name: 'post-deploy-unauthenticated',
          testMatch: '**/auth-post-deploy.spec.ts',
          use: {
            ...devices['Desktop Chrome'],
            baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://sessionforge.dev',
          },
        },
        // "authenticated" — reuses session from global-setup.ts
        {
          name: 'post-deploy-authenticated',
          testMatch: '**/auth-post-deploy.spec.ts',
          use: {
            ...devices['Desktop Chrome'],
            baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://sessionforge.dev',
            storageState: STORAGE_STATE,
          },
        },
      ]
    : [
        // --- Local / CI dev projects ---
        {
          name: 'chromium',
          use: {
            ...devices['Desktop Chrome'],
          },
        },
      ],

  // Start the dev server automatically when running tests locally (not post-deploy)
  webServer: isCI || isPostDeploy
    ? undefined
    : {
        command: 'npm run dev --workspace=@sessionforge/web',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
        cwd: '../../../',
      },
})
