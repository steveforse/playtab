import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      all: true,
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: 'coverage/javascript',
      // Keep the gate high enough to catch regressions while leaving room for
      // browser-only alphaTab integration paths that are not practical to
      // exercise in the jsdom unit suite.
      thresholds: { lines: 90, statements: 90, functions: 90 },
      include: ['app/frontend/**/*.ts', 'app/frontend/**/*.tsx'],
      // This bootstrap only mounts App; the application and player are covered directly.
      exclude: ['app/frontend/entrypoints/**'],
    },
  },
});
