import { expect, test } from '@playwright/test';

test('renders H and PO on technique slurs and retains them after resize and printing', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/techniques.musicxml');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg text').filter({ hasText: /^H$/ })).toHaveCount(1);
  await expect(notation.locator('svg text').filter({ hasText: /^PO$/ })).toHaveCount(1);
  await expect(notation.locator('svg text').filter({ hasText: /^sl\.?$/i })).toHaveCount(0);
  await page.setViewportSize({ width: 900, height: 1000 });
  await expect(notation.locator('svg text').filter({ hasText: /^PO$/ })).toHaveCount(1);
  await page.screenshot({ path: 'tmp/techniques.png', fullPage: true });
  await context.addInitScript(() => { window.print = () => {}; });
  const popup = page.waitForEvent('popup');
  await page.getByLabel('Export score').selectOption('pdf');
  const printPreview = await popup;
  await expect(printPreview.locator('svg text').filter({ hasText: /^H$/ })).toHaveCount(1);
  await expect(printPreview.locator('svg text').filter({ hasText: /^PO$/ })).toHaveCount(1);
  await printPreview.close();
  expect(errors).toEqual([]);
});
