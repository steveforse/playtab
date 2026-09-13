import { expect, test } from '@playwright/test';

test('renders and plays a banjo score, imports text and exports', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'An open-G kind of morning' })).toBeVisible();
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 45000 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(page.locator('.player-status span')).toContainText('0:01 /', { timeout: 10000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: '↻ Loop' }).click();
  await expect(page.getByRole('button', { name: '↻ Loop' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Browser verification tab');
  await page.getByRole('button', { name: 'Open in player' }).click();
  await expect(page.getByRole('heading', { name: 'Browser verification tab' })).toBeVisible();
  await expect(page.getByText(/Rhythm assumed/)).toBeVisible();
  await expect(page.getByLabel('Export score')).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.getByLabel('Export score').selectOption('json');
  expect((await download).suggestedFilename()).toBe('Browser verification tab.playtab.json');
  await page.screenshot({ path: 'tmp/playtab-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('unsupported uploads give an honest message and mobile layout fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('PDF') });
  await expect(page.getByRole('alert')).toContainText('PDF recognition is not available');
  await page.getByRole('button', { name: 'Close import' }).click();
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'tmp/playtab-mobile.png', fullPage: true });
});
