import { expect, test } from '@playwright/test';

test('playback controls stay available in the fixed sidebar', async ({ page }) => {
  await page.goto('/');
  const sidebar = page.locator('.sidebar');
  const panel = page.getByRole('region', { name: 'Playback settings' });
  const controls = page.getByRole('group', { name: 'Playback controls' });
  await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 45000 });
  const volume = page.getByLabel('Playback volume');
  await expect(volume).toHaveValue('1');
  await volume.fill('0.65');
  await expect(volume).toHaveValue('0.65');
  await expect(panel).toBeInViewport();
  await expect(sidebar).toHaveCSS('position', 'fixed');
  await page.evaluate(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, document.body.scrollHeight); });
  await expect(panel).toBeInViewport();
  await controls.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await controls.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});
