import { expect, test } from '@playwright/test';

test('ED-10 changes a paired imported duration and undoes it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/paired-staff.musicxml');
  const notation = page.getByTestId('notation');
  const firstFret = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('button', { name: '1/8 duration' }).click();
  await expect(page.getByRole('button', { name: '1/8 duration' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: '1/4 duration' })).toHaveAttribute('aria-pressed', 'true');
});

test('ED-10 splits a paired rest while keeping earlier onsets', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/paired-staff.musicxml');
  const firstFret = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('combobox', { name: 'Selection event' }).selectOption('3');
  await expect(page.getByRole('button', { name: 'Split rest' })).toBeEnabled();
  await page.getByRole('button', { name: 'Split rest' }).click();
  await expect(page.getByRole('combobox', { name: 'Selection event' }).locator('option')).toHaveCount(4);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
