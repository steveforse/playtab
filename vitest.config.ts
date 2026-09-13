import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      all: true,
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: 'coverage/javascript',
      thresholds: { lines: 100, statements: 100, functions: 100 },
      include: ['app/frontend/**/*.ts', 'app/frontend/**/*.tsx'],
      // This bootstrap only mounts App; the application and player are covered directly.
      exclude: ['app/frontend/entrypoints/**'],
    },
  },
});
