import { expect, test } from '@playwright/test';

test('UX-03 the Properties panel follows the selection and edits the note it shows', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/techniques.musicxml');
  const notation = page.getByTestId('notation');
  const zero = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(zero).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const panel = page.getByRole('complementary', { name: 'Properties' });
  await expect(panel.locator('.properties-kind').first()).toHaveText('Score');
  await expect(panel).toContainText('Select a note or empty string position to begin editing.');

  const box = (await zero.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel.locator('.properties-kind').first()).toHaveText('Note');
  await expect(panel.locator('.properties-where')).toHaveText('Measure 1 · Event 1');
  await expect(panel.locator('.properties-chip')).toContainText('Hammer-on → m1 e2');
  await expect(panel.getByRole('button', { name: 'Remove hammer-on to m1 e2' })).toBeVisible();
  const ribbonFret = page.getByLabel('Fret entry');
  await expect(ribbonFret).toHaveText('0');
  await expect(panel.getByRole('button', { name: 'Lower fret' })).toBeDisabled();

  await panel.getByRole('button', { name: 'Raise fret' }).click();
  await expect(notation.locator('svg text').filter({ hasText: /^1$/ })).toHaveCount(1);
  await expect(ribbonFret).toHaveText('1');
  await expect(panel.getByRole('button', { name: 'Lower fret' })).toBeEnabled();

  await notation.focus();
  await page.keyboard.press('2');
  await expect(ribbonFret).toHaveText('2');
  await expect(ribbonFret).toHaveClass(/typing/);
  await expect(notation.locator('svg text').filter({ hasText: /^2$/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ribbonFret).not.toHaveClass(/typing/);
  await expect(ribbonFret).toHaveText('2');

  await page.keyboard.press('Shift+ArrowRight');
  await expect(panel.locator('.properties-range .properties-kind')).toHaveText('Range');
  await expect(panel.locator('.properties-range')).toContainText('M1 E1 – M1 E2 selected');
  await expect(panel.locator('.properties-range').getByRole('button', { name: 'Copy passage' })).toBeDisabled();
  await expect(panel.locator('.properties-range').getByRole('button', { name: 'Clear to rests…' })).toBeEnabled();
});

test('UX-02 ribbon menus run the shared commands and keep one row at 1080 px', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 800 });
  await page.goto('/');
  const zeros = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ });
  await expect(zeros.first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Editing toolbar' });
  const heights = await toolbar.locator('button').evaluateAll(nodes => new Set(nodes.map(node => Math.round(node.getBoundingClientRect().top))).size);
  expect(heights).toBe(1);
  const box = (await zeros.first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await toolbar.getByRole('button', { name: 'Measure' }).click();
  await page.getByRole('menu', { name: 'Measure' }).getByRole('menuitem', { name: /Insert measure after/ }).click();
  await expect(page.getByRole('status', { name: 'Editor status' })).toContainText('M2 E1 S3 · whole rest');
  await expect(page.getByRole('combobox', { name: 'Selection measure' }).locator('option')).toHaveCount(5);
  await toolbar.getByRole('button', { name: 'Text' }).click();
  await page.getByRole('menu', { name: 'Text' }).getByRole('menuitem', { name: /Section label/ }).click();
  await expect(page.getByRole('dialog', { name: /Section/ })).toBeVisible();
});
