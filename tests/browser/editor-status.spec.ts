import { expect, test } from '@playwright/test';

test('UI-06 the status bar summarises the selection, fret buffer, range and last result', async ({ page }) => {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  const zeros = notation.locator('svg text').filter({ hasText: /^0$/ });
  await expect(zeros.first()).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole('status', { name: 'Editor status' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit score' }).click();
  const bar = page.getByRole('status', { name: 'Editor status' });
  await expect(bar).toHaveText('Nothing selected');
  const box = (await zeros.first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(bar).toContainText(/^M1 E1 S3 · fret 0 · [A-G]#?\d · 1\/8$/);
  await page.keyboard.press('7');
  await expect(bar).toContainText('Fret 7 typed — Enter applies, Escape cancels');
  await page.keyboard.press('Escape');
  await expect(bar).not.toContainText('typed');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(bar).toContainText('M1 E1 – M1 E2 selected');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Control+Shift+ArrowRight');
  await page.keyboard.press('Control+c');
  await expect(bar).toContainText('Copied 1 measure (1).');
  await expect(page.locator('p.success')).toHaveCount(0);
});
