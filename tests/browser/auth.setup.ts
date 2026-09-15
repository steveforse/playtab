import { chromium, type FullConfig } from '@playwright/test';
import fs from 'node:fs';

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL ?? 'http://localhost:3000';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const email = `browser-${Date.now()}@example.com`;

  await page.goto('/signup');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('password');
  await page.getByLabel('Repeat password').fill('password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('/');

  fs.mkdirSync('tmp', { recursive: true });
  await context.storageState({ path: 'tmp/playwright-auth.json' });
  await browser.close();
}
