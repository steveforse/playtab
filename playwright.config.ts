import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 60000,
  globalSetup: './tests/browser/auth.setup.ts',
  use: { baseURL: process.env.PLAYTAB_URL ?? 'http://localhost:3000', storageState: 'tmp/playwright-auth.json', viewport: { width: 1440, height: 1050 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
