import { expect, test } from '@playwright/test';
import fs from 'node:fs';

test('adds an imported chord tone and rest note on paired staves with an aligned empty caret', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/paired-staff.musicxml');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const firstFret = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const noteBox = (await firstFret.boundingBox())!;
  await page.mouse.click(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2);
  const inspector = page.getByLabel('Selection inspector');
  await expect(inspector).toContainText('String 1');
  await notation.focus();
  await notation.press('ArrowDown');
  await expect(inspector).toContainText('String 2');
  const caret = (await page.locator('.editor-note-selection').boundingBox())!;
  expect(Math.abs(caret.x - noteBox.x)).toBeLessThan(5);

  await page.getByLabel('Fret').fill('1');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(inspector).toContainText('Fret 1');
  await expect(notation.locator('svg text').filter({ hasText: /^1$/ })).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await notation.focus();
  await notation.press('ArrowRight');
  await notation.press('ArrowRight');
  await expect(inspector).toContainText('Event 3');
  await page.getByLabel('Fret').fill('0');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(inspector).toContainText('Fret 0');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('saves an added note to a TEF imported library score and reopens it', async ({ page }) => {
  let saved = {
    version: 2, kind: 'musicxml', title: 'Paired staff exercise', sourceFormat: 'tef',
    sourceName: 'paired.tef', source: fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8'), warnings: [],
  };
  await page.route('**/api/songs', async route => {
    if (route.request().method() === 'GET') await route.fulfill({ json: [{ id: 42, title: saved.title }] });
    else {
      saved = route.request().postDataJSON().score;
      await route.fulfill({ json: { id: 42, title: saved.title } });
    }
  });
  await page.route('**/api/songs/42', route => route.fulfill({ json: { id: 42, title: saved.title, score: saved, source_text: null } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Paired staff exercise', exact: true }).click();
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const firstFret = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await notation.focus();
  await notation.press('ArrowDown');
  await page.getByLabel('Fret').fill('1');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(notation.locator('svg text').filter({ hasText: /^1$/ })).toHaveCount(1);
  await page.getByRole('button', { name: /Save to library/ }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Paired staff exercise', exact: true }).click();
  await expect(notation.locator('svg text').filter({ hasText: /^1$/ })).toHaveCount(1);
  expect(saved.sourceFormat).toBe('tef');
});
