import { expect, test } from '@playwright/test';

test('loads and plays every locally available comparison sound bank', async ({ page }) => {
  await page.goto('/');
  const selector = page.getByLabel('Sound bank');
  test.skip(await selector.count() === 0, 'Optional comparison sound banks are not present in this checkout.');

  const options = await selector.locator('option').evaluateAll(elements => elements.map(option => ({ id: (option as HTMLOptionElement).value, label: option.textContent })));
  expect(options.length).toBeGreaterThan(1);
  if (options.some(option => option.id === 'philharmonia-banjo-f')) expect(options[0].id).toBe('philharmonia-banjo-f');
  for (const option of options) {
    await selector.selectOption(option.id);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 60000 });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(page.locator('.player-status span')).toContainText('0:01 /', { timeout: 15000 });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
  }
});
