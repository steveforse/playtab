import { expect, test } from '@playwright/test';

test('ED-24 keeps only the newest revision and one player through rapid edits, view changes and song switches', async ({ page, context }) => {
  await context.addInitScript(() => {
    const Original = window.AudioContext;
    const created: AudioContext[] = [];
    (window as unknown as { __audioContexts: AudioContext[] }).__audioContexts = created;
    window.AudioContext = class extends Original {
      constructor(...args: ConstructorParameters<typeof AudioContext>) { super(...args); created.push(this); }
    } as typeof AudioContext;
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-tie.musicxml');
  const notation = page.getByTestId('notation');
  const first = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(first).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await first.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // Two commits without waiting for the first render: 12, then 15.
  for (const key of ['1', '2', 'Enter', '1', '5', 'Enter']) await page.keyboard.press(key);
  await expect(notation.locator('svg text').filter({ hasText: /^15$/ })).toHaveCount(1);
  for (const stale of ['1', '12']) await expect(notation.locator('svg text').filter({ hasText: new RegExp(`^${stale}$`) })).toHaveCount(0);
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 15');
  await expect(page.locator('.save-status')).toHaveText('Unsaved changes');

  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('combobox', { name: 'View' }).selectOption('a4-portrait');
  await page.getByRole('combobox', { name: 'View' }).selectOption('continuous');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(notation.locator('svg text').filter({ hasText: /^15$/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Done editing' }).click();
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-rich.musicxml');
  const guard = page.getByRole('dialog', { name: 'Unsaved changes' });
  await guard.getByRole('button', { name: 'Discard', exact: true }).click();
  const confirm = page.getByRole('dialog').filter({ hasText: /discard/i }).getByRole('button', { name: /^Discard/ });
  if (await confirm.count()) await confirm.last().click();
  await expect(page.getByRole('heading', { name: 'Rich editor exercise', level: 1 })).toBeVisible({ timeout: 45000 });
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.getByRole('button', { name: 'Pause', exact: true }).first().click();

  await expect(page.locator('.at-surface')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Playback settings' })).toHaveCount(1);
  const audio = await page.evaluate(() => (window as unknown as { __audioContexts: AudioContext[] }).__audioContexts.map(context => context.state));
  expect(audio.filter(state => state !== 'closed').length).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
