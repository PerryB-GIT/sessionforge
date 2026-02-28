import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./tests/setup/test-server-global-setup.ts'],
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    testTimeout: 30000,
    hookTimeout: 120000,
  },
})
