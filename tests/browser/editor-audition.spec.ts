import { expect, test } from '@playwright/test';
import fs from 'node:fs';

test('ED-06 auditions a selected event and keeps its playback range independent of editing', async ({ page }) => {
  const errors: string[] = [];
  let phase = 'load';
  page.on('pageerror', error => errors.push(`${phase}: ${error.stack ?? error.message}`));
  await page.goto('/');
  const notation = page.getByTestId('notation');
  const notes = notation.locator('svg text').filter({ hasText: /^0$/ });
  await expect(notes.first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const first = (await notes.first().boundingBox())!;
  await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
  await expect(page.getByRole('button', { name: 'Play selection' })).toBeEnabled({ timeout: 45000 });
  phase = 'play selection';
  await page.getByRole('button', { name: 'Play selection' }).click();
  await expect(page.getByText('Playing range: M1 E1–M1 E1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({ timeout: 5000 });
  const second = (await notes.nth(1).boundingBox())!;
  phase = 'select next';
  await page.mouse.click(second.x + second.width / 2, second.y + second.height / 2);
  await expect(page.getByText('Playing range: M1 E1–M1 E1')).toBeVisible();
  phase = 'clear range';
  await page.getByRole('button', { name: 'Clear playback range' }).click();
  await expect(page.getByText('Playing range: M1 E1–M1 E1')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('ED-06 Shift-click selects a written passage and Loop does not change its endpoints', async ({ page }, testInfo) => {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  const notes = notation.locator('svg text').filter({ hasText: /^0$/ });
  await expect(notes.nth(2)).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const first = (await notes.first().boundingBox())!;
  await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
  const third = (await notes.nth(2).boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.click(third.x + third.width / 2, third.y + third.height / 2);
  await page.keyboard.up('Shift');
  await expect(page.getByText('Passage: M1 E1–M1 E3')).toBeVisible();
  await expect(notation.locator('.editor-passage-selection')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('edit-passage.png') });
  await page.getByRole('button', { name: 'Play selection' }).click();
  await expect(page.getByText('Playing range: M1 E1–M1 E3')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('playback-passage.png') });
  await page.getByRole('button', { name: '↻ Loop' }).click();
  await expect(page.getByRole('button', { name: '↻ Loop' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Playing range: M1 E1–M1 E3')).toBeVisible();
});

test('ED-06 sets passage endpoints through keyboard-accessible inspector controls', async ({ page }) => {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  const first = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(first).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const box = (await first.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByText('Select passage').click();
  await page.getByRole('button', { name: 'Set range start' }).click();
  await notation.focus();
  await notation.press('ArrowRight');
  await notation.press('ArrowRight');
  await page.getByRole('button', { name: 'Set range end' }).click();
  await expect(page.getByText('Passage: M1 E1–M1 E3')).toBeVisible();
  await expect(notation.locator('.editor-passage-selection')).toHaveCount(3);
  await page.getByRole('button', { name: 'Play selection' }).click();
  await expect(page.getByText('Playing range: M1 E1–M1 E3')).toBeVisible();
  await page.getByRole('button', { name: 'Clear passage' }).click();
  await expect(page.getByText('Passage: M1 E1–M1 E3')).toHaveCount(0);
  await expect(page.getByText('Playing range: M1 E1–M1 E3')).toBeVisible();
});

test('ED-06 drags a passage only after crossing the pointer threshold', async ({ page }) => {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  const notes = notation.locator('svg text').filter({ hasText: /^0$/ });
  await expect(notes.nth(2)).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const first = (await notes.first().boundingBox())!;
  const third = (await notes.nth(2).boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2 + 3, first.y + first.height / 2);
  await expect(page.getByText(/Passage: M/)).toHaveCount(0);
  await page.mouse.move(third.x + third.width / 2, third.y + third.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByText('Passage: M1 E1–M1 E3')).toBeVisible();
});

test('ED-06 stops selection audio on an edit and retains playback settings and endpoints', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  await page.goto('/');
  const notation = page.getByTestId('notation');
  const first = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(first).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const box = (await first.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('button', { name: '↻ Loop' }).click();
  await page.getByRole('button', { name: 'Play selection' }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await notation.focus();
  await notation.press('4');
  await expect(page.getByText('Score updated. Press Play to listen.')).toBeVisible();
  await expect(page.getByText('Playing range: M1 E1–M1 E1')).toBeVisible();
  await expect(page.getByRole('button', { name: '↻ Loop' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('ED-06 auditions a repeated measure once in written order without audio errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8')
    .replace('</attributes>', '</attributes><barline location="left"><repeat direction="forward"/></barline>')
    .replace('</measure>', '<barline location="right"><repeat direction="backward"/></barline></measure>');
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'repeat.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  const notation = page.getByTestId('notation');
  const first = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(first).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const box = (await first.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('button', { name: 'Play selection' })).toBeEnabled({ timeout: 45000 });
  await page.getByRole('button', { name: 'Play selection' }).click();
  await expect(page.getByText('Playing range: M1 E1–M1 E1')).toBeVisible();
  await page.getByRole('button', { name: 'Clear playback range' }).click();
  expect(errors).toEqual([]);
});
