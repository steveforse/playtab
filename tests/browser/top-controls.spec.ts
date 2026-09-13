import { expect, test } from '@playwright/test';

test('top and bottom transports control the same playback', async ({ page }) => {
  await page.goto('/');
  const top = page.getByRole('group', { name: 'Top playback controls' });
  const bottom = page.getByRole('group', { name: 'Bottom playback controls' });
  await expect(top.getByRole('button', { name: 'Play (top)', exact: true })).toBeEnabled({ timeout: 45000 });
  await expect(top).toBeInViewport();
  await top.getByRole('button', { name: 'Play (top)', exact: true }).click();
  await expect(bottom.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await bottom.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(top.getByRole('button', { name: 'Play (top)', exact: true })).toBeVisible();
});
