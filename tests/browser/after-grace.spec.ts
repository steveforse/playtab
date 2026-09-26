import { expect, test } from '@playwright/test';

test('an end-of-measure after-grace is drawn just before the barline with its slides', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-after-grace.musicxml');
  const notation = page.getByTestId('notation');
  const graceTop = notation.locator('svg text').filter({ hasText: /^3$/ });
  await expect(graceTop).toHaveCount(1, { timeout: 45000 });
  const text = (value: RegExp) => notation.locator('svg text').filter({ hasText: value });
  const chordTop = (await text(/^1$/).last().boundingBox())!;
  const grace = (await graceTop.boundingBox())!;
  const nextMeasure = (await text(/^0$/).last().boundingBox())!;
  // The grace sits between the slide chord and the next measure, nearer the barline.
  expect(grace.x).toBeGreaterThan(chordTop.x + 30);
  expect(grace.x).toBeLessThan(nextMeasure.x);
  expect(nextMeasure.x - grace.x).toBeLessThan(grace.x - chordTop.x);
});
