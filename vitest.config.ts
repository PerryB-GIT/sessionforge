import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['../../apps/web/src/**/*.ts', '../../packages/shared-types/src/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
      },
    },
    testTimeout: 15000,
    hookTimeout: 30000,
  },
})
