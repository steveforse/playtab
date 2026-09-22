import { expect, test } from '@playwright/test';

test('ED-02 selects a rendered note and keeps its identity through layout changes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();

  const inspector = page.getByLabel('Selection inspector');
  const note = page.getByTestId('notation').locator('svg text').filter({ hasText: /^[0-9]+$/ }).first();
  await note.click({ force: true });
  await expect(inspector).toContainText('Measure 1');
  await expect(inspector).toContainText('Event 1');
  await expect(inspector).toContainText('String 3');
  await expect(inspector).toContainText('Fret 0');
  await expect(page.locator('.editor-note-selection')).toHaveCount(1);

  await page.getByTestId('notation').focus();
  await page.getByTestId('notation').press('ArrowRight');
  await expect(inspector).toContainText('Event 2');

  await page.getByLabel('Selection measure').selectOption('2');
  await expect(inspector).toContainText('Measure 2');
  await page.getByLabel('Selection event').selectOption('1');
  await expect(inspector).toContainText('Event 1');

  await page.getByLabel('Score view', { exact: true }).selectOption('a4-portrait');
  await expect(page.locator('.score-paper')).toHaveClass(/score-paper-paginated/);
  await expect(inspector).toContainText('Measure 2');
  await expect(page.locator('.editor-note-selection')).toHaveCount(1);
  await page.getByLabel('Measures per line', { exact: true }).selectOption('2');
  await expect(inspector).toContainText('Measure 2');
  await page.getByLabel('Scroll direction', { exact: true }).selectOption('horizontal');
  await expect(inspector).toContainText('Measure 2');

  await page.setViewportSize({ width: 790, height: 1050 });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await expect(inspector).toContainText('Measure 2');
});

test('ED-02 edits and deletes the selected fret with keyboard input', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();

  const inspector = page.getByLabel('Selection inspector');
  const note = page.getByTestId('notation').locator('svg text').filter({ hasText: /^[0-9]+$/ }).first();
  await note.click({ force: true });
  const notation = page.getByTestId('notation');
  await notation.press('1');
  // A redraw can return focus to the document body; the selected target
  // should remain keyboard-editable without another score click.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('2');
  await expect(inspector).toContainText('Fret 12');

  await notation.press('Backspace');
  await expect(inspector).not.toContainText('Fret 12');
});

test('ED-02 selects an unoccupied staff string in the same beat', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();

  const inspector = page.getByLabel('Selection inspector');
  const note = page.getByTestId('notation').locator('svg text').filter({ hasText: /^[0-9]+$/ }).first();
  const box = await note.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + 18);
  await expect(inspector).toContainText('Measure 1');
  await expect(inspector).toContainText('Event 1');
  await expect(inspector).toContainText(/String [1245]/);
  await expect(inspector).not.toContainText('String 3');
});
