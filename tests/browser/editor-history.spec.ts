import { expect, test } from '@playwright/test';

for (const imported of [false, true]) {
  test(`ED-05 restores ${imported ? 'paired imported' : 'native'} notes, groups digits, and clears redo`, async ({ page }) => {
    await page.goto('/');
    if (imported) {
      await page.getByRole('button', { name: '＋ Import a tab' }).click();
      await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/paired-staff.musicxml');
    }
    const frets = page.getByTestId('notation').locator('svg text').filter({ hasText: /^[0-9]+$/ });
    await expect(frets.first()).toBeVisible({ timeout: 45000 });
    await page.getByRole('button', { name: 'Edit score', exact: true }).click();
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    const redo = page.getByRole('button', { name: 'Redo', exact: true });
    await expect(undo).toBeDisabled();
    const box = (await frets.first().boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await expect(frets.filter({ hasText: /^12$/ })).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(frets.filter({ hasText: /^12$/ })).toHaveCount(0);
    await expect(undo).toBeDisabled();
    await redo.click();
    await expect(frets.filter({ hasText: /^12$/ })).toHaveCount(1);
    await page.keyboard.press('Delete');
    await expect(frets.filter({ hasText: /^12$/ })).toHaveCount(0);
    await undo.click();
    await expect(frets.filter({ hasText: /^12$/ })).toHaveCount(1);
    await page.keyboard.press('7');
    await expect(frets.filter({ hasText: /^7$/ })).toHaveCount(1);
    await expect(redo).toBeDisabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Done editing' }).click();
    await page.getByRole('button', { name: 'Edit score', exact: true }).click();
    await expect(undo).toBeEnabled();
    await page.getByRole('button', { name: '＋ Import a tab' }).click();
    await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/techniques.musicxml');
    await page.getByRole('button', { name: 'Edit score', exact: true }).click();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
  });
}

test('ED-05 keeps history through saves and tracks the saved baseline', async ({ page }) => {
  await page.route('**/api/songs', route => route.fulfill({ json: route.request().method() === 'GET' ? [] : { id: 42, title: 'Saved demo' } }));
  await page.goto('/');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const note = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await note.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('4');
  await page.getByRole('button', { name: /Save to library/ }).click();
  await expect(page.getByRole('button', { name: '✓ Saved' })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: /Save to library/ })).toBeEnabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('button', { name: '✓ Saved' })).toBeDisabled();
});
