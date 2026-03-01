// BrowserStack Playwright configuration
// Runs your Playwright tests across real browsers and devices
// Docs: https://www.browserstack.com/docs/automate/playwright

exports.default = {
  // BrowserStack credentials (set via env or .env.test)
  userName: process.env.BROWSERSTACK_USERNAME,
  accessKey: process.env.BROWSERSTACK_ACCESS_KEY,

  // Build info — helps identify runs in BrowserStack dashboard
  buildName: `sessionforge-qa-${new Date().toISOString().split('T')[0]}`,
  projectName: 'SessionForge',

  // Browsers and devices to test across
  // Free tier: limited concurrency — start with 2
  browsers: [
    {
      browser: 'chrome',
      browser_version: 'latest',
      os: 'Windows',
      os_version: '11',
    },
    {
      browser: 'safari',
      browser_version: 'latest',
      os: 'OS X',
      os_version: 'Sonoma',
    },
    {
      // Mobile — iPhone 15
      device: 'iPhone 15',
      os_version: '17',
      browser: 'safari',
    },
    {
      // Android — Galaxy S23
      device: 'Samsung Galaxy S23',
      os_version: '13.0',
      browser: 'chrome',
    },
  ],

  // Test files to run on BrowserStack
  // Keep this to critical-path only — BrowserStack minutes are limited
  testPaths: [
    './tests/e2e/auth.spec.ts',
    './tests/e2e/onboarding.spec.ts',
    './tests/visual/visual-regression.spec.ts',
  ],

  // Options
  browserstackLocal: false, // Set true when testing localhost
  networkLogs: true,
  consoleLogs: 'info',
  video: true,            // Record video of every test run
}
