import { expect, test } from '@playwright/test';

test('editing leaves the page where it is, and playback keeps the playing line below the edit toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  const bars = Array.from({ length: 24 }, () => '0-0-0-0-0-0-0-0').join('|');
  await page.getByLabel('Plaintext tablature').fill(['D', 'B', 'G', 'D', 'g'].map(label => `${label}|${bars}|`).join('\n'));
  await page.getByRole('button', { name: 'Open in player' }).click();
  const zeros = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ });
  await expect(zeros.first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  await page.evaluate(() => window.scrollTo(0, 300));
  const target = zeros.nth(150);
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('3');
  await expect(page.getByRole('status', { name: 'Editor status' })).toContainText('fret 3');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);

  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled({ timeout: 45000 });
  await play.click();
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 20000 }).not.toBe(before);
  await page.waitForTimeout(800);
  const layout = await page.evaluate(() => ({
    cursor: document.querySelector('.at-cursor-bar')!.getBoundingClientRect().top,
    chrome: document.querySelector('.edit-chrome')!.getBoundingClientRect().bottom,
  }));
  expect(layout.cursor).toBeGreaterThanOrEqual(layout.chrome);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
});
