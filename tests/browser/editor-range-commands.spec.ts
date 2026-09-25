import { expect, test } from '@playwright/test';

async function editDemo(page: import('@playwright/test').Page) {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  const zeros = notation.locator('svg text').filter({ hasText: /^0$/ });
  await expect(zeros.first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const box = (await zeros.first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return notation;
}

test('UI-05 copies, cuts and pastes whole-measure ranges with shortcuts', async ({ page }) => {
  await editDemo(page);
  await page.keyboard.press('Control+Shift+ArrowRight');
  await expect(page.locator('.editor-range-summary')).toHaveText('Measure 1 selected');
  await page.keyboard.press('Control+c');
  await expect(page.getByRole('status').filter({ hasText: 'Copied 1 measure (1).' })).toBeVisible();

  await page.keyboard.press('Control+Shift+ArrowRight');
  await expect(page.locator('.editor-range-summary')).toHaveText('Measures 1–2 selected');
  await page.keyboard.press('Control+x');
  const cut = page.getByRole('dialog', { name: 'Cut passage' });
  await expect(cut).toContainText('Cut measures 1–2?');
  await cut.getByRole('button', { name: 'Cancel' }).click();

  await page.keyboard.press('Control+v');
  const paste = page.getByRole('dialog', { name: 'Paste passage' });
  await expect(paste).toBeVisible();
  await paste.getByRole('button', { name: 'Cancel' }).click();
});

test('UI-05 Delete clears a partial range to rests as one undo step', async ({ page }) => {
  const notation = await editDemo(page);
  const before = await notation.locator('svg text').filter({ hasText: /^[0-9]+$/ }).count();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog', { name: 'Clear range' });
  await expect(dialog).toContainText('Clear M1 E1 – M1 E3?');
  await expect(dialog).toContainText('3 notes');
  await dialog.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cleared M1 E1 – M1 E3; it now holds rests.' })).toBeVisible();
  await expect(page.locator('.editor-range-summary')).toHaveCount(0);
  await expect(notation.locator('svg text').filter({ hasText: /^[0-9]+$/ })).toHaveCount(before - 3);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveAttribute('title', /Undo: Clear M1 E1 – M1 E3/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(notation.locator('svg text').filter({ hasText: /^[0-9]+$/ })).toHaveCount(before);
});
