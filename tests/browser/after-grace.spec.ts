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

test('edits, removes and adds a grace group after the last chord of a measure', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-after-grace.musicxml');
  const notation = page.getByTestId('notation');
  const text = (value: RegExp) => notation.locator('svg text').filter({ hasText: value });
  await expect(text(/^3$/)).toHaveCount(1, { timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const chordTop = (await text(/^1$/).last().boundingBox())!;
  await page.mouse.click(chordTop.x + chordTop.width / 2, chordTop.y + chordTop.height / 2);
  const panel = page.getByRole('complementary', { name: 'Properties' });
  await expect(panel.getByRole('button', { name: 'Edit grace…' })).toBeVisible();
  await panel.getByRole('button', { name: 'Edit grace…' }).click();
  // The chord only has a group after it, so the dialog opens on that side.
  const dialog = page.getByRole('dialog', { name: 'Edit grace group after' });
  await expect(dialog.getByLabel('Grace position')).toHaveValue('after');
  await expect(dialog).toContainText('Grace notes play at the end of it');
  await expect(dialog.getByLabel('Grace note 1 transition 1')).toHaveValue('slide');
  await expect(dialog.getByLabel('Grace note 1 transition 2')).toHaveValue('slide');
  await dialog.getByLabel('Grace note 1 fret 1').fill('4');
  await dialog.getByRole('button', { name: 'Apply grace group' }).click();
  await expect(page.getByRole('status', { name: 'Editor status' })).toContainText('Grace group updated.');
  const grace = (await text(/^4$/).boundingBox())!;
  const nextMeasure = (await text(/^0$/).last().boundingBox())!;
  expect(grace.x).toBeGreaterThan(chordTop.x + 30);
  expect(grace.x).toBeLessThan(nextMeasure.x);

  await page.mouse.click(chordTop.x + chordTop.width / 2, chordTop.y + chordTop.height / 2);
  await panel.getByRole('button', { name: 'Edit grace…' }).click();
  await dialog.getByRole('button', { name: 'Remove grace group' }).click();
  await expect(text(/^4$/)).toHaveCount(0);
  await expect(text(/^3$/)).toHaveCount(0);

  await page.mouse.click(chordTop.x + chordTop.width / 2, chordTop.y + chordTop.height / 2);
  await panel.getByRole('button', { name: 'Add grace…' }).click();
  await expect(page.getByRole('dialog', { name: 'Add grace group' })).toBeVisible();
  await page.getByLabel('Grace position').selectOption('after');
  const add = page.getByRole('dialog', { name: 'Add grace group after' });
  await add.getByLabel('Grace note 1 fret 1').fill('2');
  await add.getByLabel('Grace note 1 transition 1').selectOption('slide');
  await add.getByRole('button', { name: 'Apply grace group' }).click();
  await expect(page.getByRole('status', { name: 'Editor status' })).toContainText('Grace group added after the selected beat.');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveAttribute('title', /Add grace group after a beat in measure 1/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveAttribute('title', /Remove grace group/);
});
