import { expect, test } from '@playwright/test';

test('ED-12 inserts an inherited-meter rest measure and undoes it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-rich.musicxml');
  const firstFret = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('combobox', { name: 'Selection measure' }).selectOption('2');
  await page.getByText('Measure', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Insert measure after' }).click();
  await expect(page.getByRole('combobox', { name: 'Selection measure' }).locator('option')).toHaveCount(3);
  await expect(page.getByLabel('Selection inspector')).toContainText('Measure 3');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Selection measure' }).locator('option')).toHaveCount(2);
});
