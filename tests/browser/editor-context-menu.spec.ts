import { expect, test, type Page } from '@playwright/test';

async function editDemo(page: Page) {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  const zeros = notation.locator('svg text').filter({ hasText: /^0$/ });
  await expect(zeros.first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  return { notation, zeros };
}
const center = async (locator: import('@playwright/test').Locator) => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test('UI-03 right-clicking a note opens a keyboard-operable menu that runs commands', async ({ page }) => {
  const { notation, zeros } = await editDemo(page);
  const point = await center(zeros.first());
  await page.mouse.click(point.x, point.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Score actions' });
  await expect(menu).toBeVisible();
  await expect(page.getByLabel('Selection inspector')).toContainText('Event 1');
  await expect(menu.getByRole('menuitem', { name: /Edit fret/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: /Remove note/ })).toBeFocused();
  await page.keyboard.press('d');
  await expect(menu.getByRole('menuitem', { name: /^Duration/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const durations = page.getByRole('menu', { name: 'Duration' });
  await expect(durations.getByRole('menuitem', { name: /Whole note duration/ })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(durations).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /^Duration/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(durations.getByRole('menuitem', { name: /1\/8 duration/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(notation).toBeFocused();
  await expect(page.getByRole('button', { name: '1/8 duration' })).toHaveAttribute('aria-pressed', 'true');
});

test('UI-03 range, keyboard and dismissal behaviour', async ({ page }) => {
  const { notation, zeros } = await editDemo(page);
  const first = await center(zeros.first());
  await page.mouse.click(first.x, first.y);
  await page.keyboard.press('Shift+ArrowRight');
  const inRange = await center(zeros.nth(1));
  await page.mouse.click(inRange.x, inRange.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Score actions' });
  await expect(menu.getByRole('menuitem', { name: /Copy passage/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(menu.getByRole('menuitem', { name: /Copy passage/ })).toContainText('Select whole measures first');
  await expect(menu.getByRole('menuitem', { name: /Clear to rests/ })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.editor-range-summary')).toHaveText('M1 E1 – M1 E2 selected');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(notation).toBeFocused();

  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await page.mouse.click(5, 5);
  await expect(menu).toHaveCount(0);

  const heading = await center(page.getByRole('heading', { level: 1 }));
  await page.mouse.click(heading.x, heading.y, { button: 'right' });
  await expect(menu).toHaveCount(0);
});

test('UI-03 the menu stays on screen near the viewport corner', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  const { zeros } = await editDemo(page);
  const last = zeros.last();
  await last.scrollIntoViewIfNeeded();
  const point = await center(last);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Score actions' });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1100);
  expect(box.y + box.height).toBeLessThanOrEqual(700);
});
