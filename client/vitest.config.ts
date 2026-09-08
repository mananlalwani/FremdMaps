import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      // Gate modules that enforce navigation correctness. DOM-heavy UI and
      // developer tooling are exercised by Playwright rather than unit coverage.
      include: [
        'src/utils/**/*.ts',
        'src/map/map-state.ts',
        'src/navigation/**/*.ts',
      ],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
})
