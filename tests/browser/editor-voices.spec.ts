import { expect, test } from '@playwright/test';

test('adds a second voice to a measure, enters a note in it, and removes it again', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/paired-staff.musicxml');
  const notation = page.getByTestId('notation');
  const firstFret = notation.locator('svg text').filter({ hasText: /^\d+$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const voice = page.getByRole('combobox', { name: 'Selection voice' });
  const before = await voice.inputValue();
  await page.getByText('Measure', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Add second voice' }).click();
  await expect(page.getByText(/Measure 1 has a second voice/)).toBeVisible();
  await expect(voice).not.toHaveValue(before);
  await expect(page.getByLabel('Selection inspector')).toContainText(/rest/i);

  await page.getByRole('combobox', { name: 'Selection string' }).selectOption('3');
  const frets = await notation.locator('svg text').filter({ hasText: /^7$/ }).count();
  await page.getByLabel('Fret', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(notation.locator('svg text').filter({ hasText: /^7$/ })).toHaveCount(frets + 1);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('button', { name: 'Remove second voice' }).click();
  await expect(page.getByRole('alert')).toContainText('Clear the second voice to rests');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(voice).toHaveValue(before);
});
