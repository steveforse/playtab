import { expect, test } from '@playwright/test';

test('ED-11 creates and removes a paired triplet with one undo step each', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/paired-staff.musicxml');
  const firstFret = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('button', { name: 'Triplet', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Selection beat' }).locator('option')).toHaveCount(5);
  await page.getByRole('combobox', { name: 'Selection beat' }).selectOption('2');
  await page.locator('.editor-rhythm-tools').screenshot({ path: testInfo.outputPath('triplet-tools.png') });
  await expect(page.getByRole('button', { name: '1/8 duration' })).toBeDisabled();
  await expect(page.getByText('Edit this triplet as a group.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove triplet' }).click();
  await expect(page.getByRole('combobox', { name: 'Selection beat' }).locator('option')).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Selection beat' }).locator('option')).toHaveCount(5);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('ED-11 will not remove a triplet with a sounding later child', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/paired-staff.musicxml');
  const firstFret = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('button', { name: 'Triplet', exact: true }).click();
  await page.getByRole('combobox', { name: 'Selection beat' }).selectOption('2');
  await page.getByLabel('Fret', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByRole('button', { name: 'Remove triplet' })).toBeDisabled();
  await expect(page.getByText(/Remove the last two notes or protected attachments/)).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Selection beat' }).locator('option')).toHaveCount(5);
});
