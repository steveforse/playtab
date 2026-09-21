import { expect, test } from '@playwright/test';

test('ED-01 enters explicit edit mode above playback and returns to practice mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'An open-G kind of morning' })).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '300px');

  const editButton = page.getByRole('button', { name: 'Edit score' });
  await expect(editButton).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByLabel('Edit tools')).toHaveCount(0);
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });

  await editButton.click();
  await expect(page.getByRole('button', { name: 'Done editing' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Edit tools')).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '300px');
  await expect(page.getByText('Select a note in the score to begin editing.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Practice demo/ })).toHaveCount(0);
  await expect(page.locator('#playback-controls')).toBeVisible();
  const editorBeforePlayback = await page.locator('.editor-sidebar').evaluate(element => {
    const playback = document.querySelector('#playback-controls');
    return Boolean(playback && element.compareDocumentPosition(playback) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(editorBeforePlayback).toBe(true);

  await page.getByRole('button', { name: 'Done editing' }).click();
  await expect(page.getByRole('button', { name: 'Edit score' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.sidebar')).toHaveCSS('width', '300px');
  await expect(page.getByLabel('Edit tools')).toHaveCount(0);
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible();
});
