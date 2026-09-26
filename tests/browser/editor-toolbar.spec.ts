import { expect, test } from '@playwright/test';

test('UI-02 the editing toolbar reflects the selection and runs the shared commands', async ({ page }) => {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  const zeros = notation.locator('svg text').filter({ hasText: /^0$/ });
  await expect(zeros.first()).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole('toolbar', { name: 'Editing toolbar' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit score' }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Editing toolbar' });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Copy' })).toBeDisabled();
  await expect(toolbar.getByRole('button', { name: 'Copy' })).toHaveAttribute('title', 'Copy passage — Select a range first');
  await toolbar.getByRole('button', { name: 'Techniques' }).click();
  const techniques = page.getByRole('menu', { name: 'Techniques' });
  await expect(techniques.getByRole('menuitem', { name: /^Tie/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(techniques.getByRole('menuitem', { name: /^Tie/ })).toContainText('Select a note first');
  await page.keyboard.press('Escape');
  await expect(techniques).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'Techniques' })).toBeFocused();
  const box = (await zeros.first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(toolbar.getByRole('button', { name: '1/8 duration' })).toHaveAttribute('aria-pressed', 'true');
  await toolbar.getByRole('button', { name: '1/16 duration' }).click();
  await expect(toolbar.getByRole('button', { name: '1/16 duration' })).toHaveAttribute('aria-pressed', 'true');
  await toolbar.getByRole('button', { name: 'Whole note duration' }).focus();
  for (let step = 0; step < 5; step++) await page.keyboard.press('ArrowRight');
  await expect(toolbar.getByRole('button', { name: '1/32 duration' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toolbar.getByRole('button', { name: '1/32 duration' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(toolbar.getByRole('button', { name: '1/8 duration' })).toHaveAttribute('aria-pressed', 'true');
});

test('UI-02 the ribbon scrolls sideways on a phone without widening the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('notation').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Editing toolbar' });
  await expect(toolbar).toBeVisible();
  const size = await toolbar.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(size.scroll).toBeGreaterThan(size.client);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
