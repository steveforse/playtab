import { expect, test } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';

test('ED-16 adds a grace chord before a note and saves it without changing the note', async ({ page }, testInfo) => {
  let savedSource = '';
  await page.route('**/api/songs**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200,
      json: { id: 83, title: 'Grace exercise', revision: route.request().method() === 'POST' ? 0 : 1 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-tie.musicxml');
  const firstFret = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByText('Techniques', { exact: true }).click();
  await page.getByRole('button', { name: 'Add grace…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add grace group' });
  await expect(dialog).toContainText('Destination: measure 1, event 1');
  await dialog.getByLabel('Grace fret 1').fill('2');
  await dialog.getByRole('button', { name: 'Add string' }).click();
  await dialog.getByLabel('Grace string 2').selectOption('3');
  await dialog.screenshot({ path: testInfo.outputPath('add-grace-dialog.png') });
  await dialog.getByRole('button', { name: 'Apply grace group' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Grace group added' })).toBeVisible();
  await page.getByTestId('notation').screenshot({ path: testInfo.outputPath('grace-score.png') });
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 2');
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => savedSource).not.toBe('');
  const notes = Array.from(new DOMParser().parseFromString(savedSource, 'application/xml')
    .getElementsByTagName('measure')[0].getElementsByTagName('note'));
  expect(notes.slice(0, 2).every(note => note.getElementsByTagName('grace').length === 1)).toBe(true);
  expect(notes[1].getElementsByTagName('chord')).toHaveLength(1);
  expect(notes[2].getElementsByTagName('grace')).toHaveLength(0);
  expect(notes[2].getElementsByTagName('fret')[0].textContent).toBe('0');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 0');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('combobox', { name: 'Selection event' }).selectOption('2');
  await page.getByLabel('Fret', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => new DOMParser().parseFromString(savedSource, 'application/xml')
    .getElementsByTagName('measure')[0].getElementsByTagName('note')[2].getElementsByTagName('fret')[0]?.textContent).toBe('5');
  const corrected = Array.from(new DOMParser().parseFromString(savedSource, 'application/xml')
    .getElementsByTagName('measure')[0].getElementsByTagName('note'));
  expect(corrected[0].getElementsByTagName('fret')[0].textContent).toBe('2');
  expect(corrected[1].getElementsByTagName('fret')[0].textContent).toBe('0');
});
