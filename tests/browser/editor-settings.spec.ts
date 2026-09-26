import { expect, test } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';
import fs from 'node:fs';

test('ED-19 applies title, opening tempo, tuning and a local tempo intentionally', async ({ page }, testInfo) => {
  const source = fs.readFileSync('tests/fixtures/editor-rich.musicxml', 'utf8')
    .replace('<staff-details number="2"><staff-tuning line="1"><tuning-step>A</tuning-step><tuning-octave>4</tuning-octave></staff-tuning></staff-details>', '');
  let savedSource = '';
  let savedTitle = '';
  await page.route('**/api/songs**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    savedTitle = route.request().postDataJSON().score.title;
    return route.fulfill({ status: 201, json: { id: 90, title: savedTitle, revision: 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'rich-settings.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  const notation = page.getByTestId('notation');
  const firstFret = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  await page.locator('summary', { hasText: /^Score$/ }).click();
  await page.getByRole('button', { name: 'Score settings…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Score settings' });
  await expect(dialog.getByLabel('String 4 note').locator('option:checked')).toHaveText('D3');
  await expect(dialog).not.toContainText('MIDI');
  await dialog.getByLabel('Title', { exact: true }).fill('Rich settings exercise');
  await dialog.getByLabel('Opening tempo').fill('120');
  await dialog.getByLabel('Tuning preset').selectOption('Standard C');
  await expect(dialog.getByLabel('String 4 note').locator('option:checked')).toHaveText('C3');
  await expect(dialog.getByLabel('Tuning preset').locator('option:checked')).toHaveText('Standard C — gCGBD');
  await dialog.getByLabel('Keep pitches (frets change)').check();
  await expect(dialog).toContainText('Tuning applies to measures 1–2.');
  await dialog.screenshot({ path: testInfo.outputPath('settings-dialog.png') });
  await dialog.getByRole('button', { name: 'Apply settings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Score settings applied. Tuning changed for measures 1–2.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rich settings exercise', level: 1 })).toBeVisible();
  await expect(notation.locator('svg text').filter({ hasText: /^6$/ })).toHaveCount(2);
  await expect(notation.locator('svg text').filter({ hasText: /Dropped C/ })).toHaveCount(1);

  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('combobox', { name: 'Selection measure' }).selectOption('2');
  await page.getByRole('combobox', { name: 'Selection voice' }).selectOption('2');
  await page.getByRole('combobox', { name: 'Selection event' }).selectOption('2');
  await page.getByRole('button', { name: 'Set tempo here…' }).click();
  const tempo = page.getByRole('dialog', { name: 'Set tempo here' });
  await expect(tempo).toContainText('108 BPM continues here from earlier in the score.');
  await tempo.getByLabel('Tempo').fill('80');
  await tempo.getByRole('button', { name: 'Apply tempo' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tempo 80 BPM set at measure 2, event 2.' })).toBeVisible();
  await expect(notation.locator('svg text').filter({ hasText: /= 80/ })).toHaveCount(1);
  await notation.screenshot({ path: testInfo.outputPath('settings-score.png') });

  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => savedSource).not.toBe('');
  expect(savedTitle).toBe('Rich settings exercise');
  expect(savedSource).toContain('<work-title>Rich settings exercise</work-title>');
  expect(savedSource).toContain('<sound tempo="120"/>');
  expect(savedSource).toContain('<sound tempo="108"/>');
  expect(savedSource).toContain('<per-minute>80</per-minute>');
  const doc = new DOMParser().parseFromString(savedSource, 'application/xml');
  const line2 = Array.from(doc.getElementsByTagName('staff-tuning')).find(item => item.getAttribute('line') === '2')!;
  expect(`${line2.getElementsByTagName('tuning-step')[0].textContent}${line2.getElementsByTagName('tuning-octave')[0].textContent}`).toBe('C3');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(notation.locator('svg text').filter({ hasText: /= 80/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rich editor exercise', level: 1 })).toBeVisible();
  await expect(notation.locator('svg text').filter({ hasText: /^6$/ })).toHaveCount(0);
});

test('sets a capo, credits and swing feel from Score settings', async ({ page }) => {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg text').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  await page.locator('summary', { hasText: /^Score$/ }).click();
  await page.getByRole('button', { name: 'Score settings…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Score settings' });
  await expect(dialog.getByLabel('Tuning preset')).toHaveValue('Open G');
  await dialog.getByLabel('Capo', { exact: true }).selectOption('2');
  await expect(dialog.getByLabel('5th-string capo')).toHaveValue('7');
  await dialog.getByLabel('5th-string capo').selectOption('9');
  await dialog.getByLabel('Capo', { exact: true }).selectOption('3');
  await expect(dialog.getByLabel('5th-string capo')).toHaveValue('8');
  await dialog.getByLabel('Composer').fill('Traditional');
  await dialog.getByLabel('Feel').selectOption('swing');
  await dialog.getByRole('button', { name: 'Apply settings' }).click();
  await expect(page.getByRole('status', { name: 'Editor status' })).toContainText('Capo at fret 3.');
  await expect(notation.locator('svg text').filter({ hasText: /Capo/ })).toHaveCount(1);
  await expect(notation.locator('svg text').filter({ hasText: /Traditional/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Score settings…' }).click();
  await expect(dialog.getByLabel('Capo', { exact: true })).toHaveValue('3');
  await expect(dialog.getByLabel('Feel')).toHaveValue('swing');
});
