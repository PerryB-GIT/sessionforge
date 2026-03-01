import { defineConfig } from 'checkly'

/**
 * See https://www.checklyhq.com/docs/cli/project-structure/
 */
const config = defineConfig({
  /* A human friendly name for your project */
  projectName: 'SessionForge + Support Forge QA',
  logicalId: 'sessionforge-qa',
  repoUrl: 'https://github.com/PerryB-GIT/sessionforge',
  checks: {
    frequency: 5,
    locations: ['us-east-1', 'eu-west-1'],
    tags: ['sessionforge', 'support-forge', 'production'],
    /** The Checkly Runtime identifier, determining npm packages and the Node.js version available at runtime.
     * See https://www.checklyhq.com/docs/cli/npm-packages/
     */
    runtimeId: '2025.04',
    /* A glob pattern that matches the Checks inside your repo, see https://www.checklyhq.com/docs/constructs/including-checks/#checks-checkmatch */
    checkMatch: '**/__checks__/**/*.check.ts',
    /* Global configuration option for Browser and Multistep checks. See https://www.checklyhq.com/docs/browser-checks/playwright-test/#global-configuration */
    playwrightConfig: {
      timeout: 30000,
      use: {
        baseURL: 'https://sessionforge.dev',
        viewport: { width: 1280, height: 720 },
      }
    },
    browserChecks: {
      /* A glob pattern matches any Playwright .spec.ts files and automagically creates a Browser Check. This way, you
      * can just write Playwright code. See https://www.checklyhq.com/docs/constructs/including-checks/#browserchecks-testmatch
      * */
      testMatch: '**/__checks__/**/*.spec.ts',
    },
  },
  cli: {
    /* The default datacenter location to use when running npx checkly test */
    runLocation: 'us-east-1',
    /* An array of default reporters to use when a reporter is not specified with the "--reporter" flag */
    reporters: ['list'],
    /* How many times to retry a failing test run when running `npx checkly test` or `npx checkly trigger` (max. 3) */
    retries: 1,
  },
})

export default config
