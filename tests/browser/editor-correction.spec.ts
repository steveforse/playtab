import { expect, test } from '@playwright/test';

test('ED-03 applies a fret field edit and moves a note to another string', async ({ page }) => {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const note = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await note.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const fret = page.getByLabel('Fret');
  await fret.fill('12');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 12');
  await expect(notation.locator('svg text').filter({ hasText: /^12$/ })).toHaveCount(1);
  await page.getByLabel('Move to string').selectOption('2');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('String 2');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('ED-03 validates fret field values before mutating the score', async ({ page }) => {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const note = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await note.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByLabel('Fret').fill('37');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('0 to 36');
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 0');
});

test('ED-03 moves an imported note without breaking paired notation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/paired-staff.musicxml');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const note = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await note.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByLabel('Move to string').selectOption('2');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('String 2');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
