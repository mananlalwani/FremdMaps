import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      // Gate modules that enforce navigation correctness. DOM-heavy UI and
      // developer tooling are exercised by Playwright rather than unit coverage.
      include: [
        'src/utils/**/*.ts',
        'src/map/map-init.ts',
        'src/map/map-state.ts',
        'src/map/graph-controller.ts',
      ],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
})
