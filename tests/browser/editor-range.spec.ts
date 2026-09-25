import { expect, test } from '@playwright/test';

test('UI-04 extends a blue range band by event and measure from the keyboard', async ({ page }) => {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  const zeros = notation.locator('svg text').filter({ hasText: /^0$/ });
  await expect(zeros.first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const box = (await zeros.first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const summary = page.locator('.editor-range-summary');

  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(summary).toHaveText('M1 E1 – M1 E3 selected');
  await expect(notation.locator('.editor-passage-selection')).toHaveCount(1);
  await expect(notation.locator('.editor-range-endpoint')).toHaveCount(2);
  const band = (await notation.locator('.editor-passage-selection').boundingBox())!;
  expect(band.height).toBeGreaterThan(box.height * 3);

  await page.keyboard.press('Control+Shift+ArrowRight');
  await expect(summary).toHaveText('Measure 1 selected');
  await page.keyboard.press('Control+Shift+ArrowRight');
  await expect(summary).toHaveText('Measures 1–2 selected');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(summary).toContainText('M1 E1 – M2 E');

  await page.keyboard.press('Escape');
  await expect(summary).toHaveCount(0);
  await expect(notation.locator('.editor-passage-selection')).toHaveCount(0);

  await page.keyboard.press('Control+a');
  await expect(summary).toHaveText('Measures 1–4 selected');
});

test('UI-04 clicking above the staff selects the measure and Shift-click extends by measure', async ({ page }) => {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  const frets = notation.locator('svg text').filter({ hasText: /^[0-9]$/ });
  await expect(frets.first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const boxes = (await frets.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })));
  const top = Math.min(...boxes.map(item => item.y));
  const twos = notation.locator('svg text').filter({ hasText: /^2$/ });
  const measureTwo = (await twos.first().boundingBox())!;
  await page.mouse.click(measureTwo.x + measureTwo.width / 2, top - 16);
  const summary = page.locator('.editor-range-summary');
  await expect(summary).toHaveText('Measure 2 selected');
  await expect(page.getByLabel('Selection inspector')).toContainText('Measure 2');

  const first = (await frets.first().boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.click(first.x + first.width / 2, top - 16);
  await page.keyboard.up('Shift');
  await expect(summary).toHaveText('Measures 1–2 selected');
});
