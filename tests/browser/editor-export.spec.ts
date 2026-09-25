import { expect, test, type Page } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';
import fs from 'node:fs';

async function exportAs(page: Page, format: string) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.locator('.export-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Export format').selectOption(format);
  await dialog.getByRole('button', { name: 'Export file', exact: true }).click();
}

test('ED-22 exports exactly the unsaved draft and leaves the draft untouched', async ({ page, context }) => {
  let libraryWrites = 0;
  await page.route('**/api/songs**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    libraryWrites++;
    return route.fulfill({ status: 201, json: { id: 95, title: 'Tie exercise', revision: 0 } });
  });
  await context.addInitScript(() => { window.print = () => {}; });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-tie.musicxml');
  const notation = page.getByTestId('notation');
  const first = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(first).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await first.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('5');
  await page.keyboard.press('Enter');
  await expect(notation.locator('svg text').filter({ hasText: /^5$/ })).toHaveCount(1);

  await page.getByLabel('Fret', { exact: true }).fill('7');
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
  await expect(page.getByText('Apply or clear the pending fret before exporting.')).toBeVisible();
  await page.getByLabel('Fret', { exact: true }).fill('5');
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();

  const musicXml = page.waitForEvent('download');
  await exportAs(page, 'musicxml');
  const musicXmlFile = await musicXml;
  expect(musicXmlFile.suggestedFilename()).toBe('Tie exercise.musicxml');
  const exported = fs.readFileSync((await musicXmlFile.path())!, 'utf8');
  const notes = Array.from(new DOMParser().parseFromString(exported, 'application/xml').getElementsByTagName('note'));
  expect(notes[0].getElementsByTagName('fret')[0].textContent).toBe('5');
  expect(`${notes[0].getElementsByTagName('step')[0].textContent}${notes[0].getElementsByTagName('octave')[0].textContent}`).toBe('G3');

  const midi = page.waitForEvent('download');
  await exportAs(page, 'midi');
  const midiFile = await midi;
  expect(midiFile.suggestedFilename()).toMatch(/\.mid$/);
  expect(fs.readFileSync((await midiFile.path())!).subarray(0, 4).toString()).toBe('MThd');

  const popup = page.waitForEvent('popup');
  await exportAs(page, 'pdf');
  const printPreview = await popup;
  await expect(printPreview.locator('svg text').filter({ hasText: /^5$/ })).toHaveCount(1);
  await expect(printPreview.locator('.editor-note-selection, .editor-passage-selection, .editor-playback-selection')).toHaveCount(0);
  await printPreview.close();

  const tef = page.waitForEvent('download');
  await exportAs(page, 'tef2');
  expect((await tef).suggestedFilename()).toMatch(/\.tef$/);

  await page.route('**/api/tef_exports', route => route.fulfill({ status: 500, json: { error: 'TEF export failed on the server.' } }));
  await exportAs(page, 'tef3');
  await expect(page.getByRole('alert').filter({ hasText: 'TEF export failed on the server.' })).toBeVisible();
  await expect(notation.locator('svg text').filter({ hasText: /^5$/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '＋ Save to library' })).toBeEnabled();
  expect(libraryWrites).toBe(0);
});
