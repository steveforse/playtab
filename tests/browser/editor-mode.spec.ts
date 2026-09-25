import { expect, test } from '@playwright/test';

test('ED-01 enters a focused edit workspace and returns to practice mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'An open-G kind of morning' })).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '300px');

  const editButton = page.getByRole('button', { name: 'Edit score' });
  await expect(editButton).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('complementary', { name: 'Properties' })).toHaveCount(0);
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });
  const width = (await page.getByTestId('notation').boundingBox())!.width;

  await editButton.click();
  await expect(page.getByRole('button', { name: 'Done editing' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'An open-G kind of morning', level: 1 })).toBeVisible();
  const titlebar = page.locator('.edit-titlebar');
  await expect(titlebar.getByRole('group', { name: 'Playback controls' }).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(titlebar.getByRole('button', { name: 'Export' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Editing toolbar' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
  await expect(page.getByText('Select a note or empty string position to begin editing.')).toBeVisible();
  await expect(page.locator('.score-toolbar')).toHaveCount(0);
  // The score keeps its width, so entering edit mode does not re-lay it out.
  expect((await page.getByTestId('notation').boundingBox())!.width).toBe(width);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'View options' }).getByLabel('Score view', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'View options' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Done editing' }).click();
  await expect(page.getByRole('button', { name: 'Edit score' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.sidebar')).toHaveCSS('width', '300px');
  await expect(page.locator('#playback-controls').getByRole('region', { name: 'Playback settings' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Properties' })).toHaveCount(0);
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible();
});
