import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      all: true,
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: 'coverage/javascript',
      thresholds: { lines: 85, statements: 85, functions: 85 },
      include: ['app/frontend/**/*.ts', 'app/frontend/**/*.tsx'],
      // This bootstrap only mounts App; the application and player are covered directly.
      exclude: ['app/frontend/entrypoints/**'],
    },
  },
});
