import { expect, test } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';
import fs from 'node:fs';

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
  await dialog.getByLabel('Grace event 1 fret 1', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Add string to grace event 1' }).click();
  await dialog.getByLabel('Grace event 1 string 2', { exact: true }).selectOption('3');
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

test('ED-16 edits and removes grace notes without disturbing the destination', async ({ page }) => {
  let savedSource = '';
  await page.route('**/api/songs**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200,
      json: { id: 84, title: 'Grace removal', revision: route.request().method() === 'POST' ? 0 : 1 } });
  });
  const firstMeasure = () => Array.from(new DOMParser().parseFromString(savedSource, 'application/xml')
    .getElementsByTagName('measure')[0].getElementsByTagName('note'));
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
  await dialog.getByLabel('Grace event 1 fret 1', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Add string to grace event 1' }).click();
  await dialog.getByLabel('Grace event 1 string 2', { exact: true }).selectOption('3');
  await dialog.getByRole('button', { name: 'Apply grace group' }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 2');
  await expect(page.getByRole('button', { name: 'Make rest' })).toHaveCount(0);

  await page.getByLabel('Fret', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 3');
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => firstMeasure().filter(note => note.getElementsByTagName('grace').length)
    .map(note => note.getElementsByTagName('fret')[0]?.textContent).sort().join(',')).toBe('0,3');
  expect(firstMeasure()[2].getElementsByTagName('fret')[0].textContent).toBe('0');

  await page.getByRole('button', { name: 'Remove note' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Grace note removed.' })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => firstMeasure().filter(note => note.getElementsByTagName('grace').length).length).toBe(1);
  expect(firstMeasure()[0].getElementsByTagName('chord')).toHaveLength(0);

  await page.getByLabel('Selection string').selectOption('3');
  await page.getByRole('button', { name: 'Remove grace' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Grace event removed.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove grace' })).toHaveCount(0);
  await page.getByLabel('Selection string').selectOption('4');
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 0');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => firstMeasure().filter(note => note.getElementsByTagName('grace').length).length).toBe(0);
  expect(firstMeasure()[0].getElementsByTagName('fret')[0].textContent).toBe('0');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove grace' })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => firstMeasure().filter(note => note.getElementsByTagName('grace').length).length).toBe(1);
});

test('ED-16 edits a grace group with a pull-off into the main note and reopens it', async ({ page }, testInfo) => {
  let savedSource = '';
  await page.route('**/api/songs**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200,
      json: { id: 85, title: 'Grace transitions', revision: route.request().method() === 'POST' ? 0 : 1 } });
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
  let dialog = page.getByRole('dialog', { name: 'Add grace group' });
  await dialog.getByLabel('Grace event 1 fret 1', { exact: true }).fill('5');
  await dialog.getByLabel('Grace event 1 transition 1', { exact: true }).selectOption('slide');
  await dialog.getByRole('button', { name: 'Add grace event' }).click();
  await dialog.getByLabel('Grace event 2 fret 1', { exact: true }).fill('2');
  await dialog.getByLabel('Grace event 2 transition 1', { exact: true }).selectOption('hammer-on');
  await expect(dialog.getByRole('alert')).toContainText('Grace event 2, string 4: a hammer-on needs a higher fret on its next note (fret 0).');
  await expect(dialog.getByRole('button', { name: 'Apply grace group' })).toBeDisabled();
  await dialog.getByLabel('Grace event 2 transition 1', { exact: true }).selectOption('pull-off');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.screenshot({ path: testInfo.outputPath('grace-transition-dialog.png') });
  await dialog.getByRole('button', { name: 'Apply grace group' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Grace group added' })).toBeVisible();
  await expect(page.getByTestId('notation').locator('svg text').filter({ hasText: /^PO$/ })).toHaveCount(1);
  await page.getByTestId('notation').screenshot({ path: testInfo.outputPath('grace-transition-score.png') });
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => savedSource).not.toBe('');
  const notes = Array.from(new DOMParser().parseFromString(savedSource, 'application/xml').getElementsByTagName('measure')[0].getElementsByTagName('note'));
  expect(notes.slice(0, 2).map(note => note.getElementsByTagName('fret')[0].textContent)).toEqual(['5', '2']);
  expect(notes[0].getElementsByTagName('slide')[0].getAttribute('type')).toBe('start');
  expect(notes[1].getElementsByTagName('slide')[0].getAttribute('type')).toBe('stop');
  expect(notes[1].getElementsByTagName('pull-off')[0].getAttribute('type')).toBe('start');
  expect(notes[2].getElementsByTagName('pull-off')[0].getAttribute('type')).toBe('stop');
  expect(notes[2].getElementsByTagName('grace')).toHaveLength(0);

  await page.getByRole('button', { name: 'Edit grace…' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit grace group' });
  await expect(dialog.getByLabel('Grace event 1 transition 1', { exact: true })).toHaveValue('slide');
  await expect(dialog.getByLabel('Grace event 2 transition 1', { exact: true })).toHaveValue('pull-off');
  await dialog.getByRole('button', { name: 'Remove grace event 1' }).click();
  await dialog.getByRole('button', { name: 'Apply grace group' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Grace group updated.' })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => new DOMParser().parseFromString(savedSource, 'application/xml').getElementsByTagName('slide').length).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => new DOMParser().parseFromString(savedSource, 'application/xml').getElementsByTagName('slide').length).toBe(2);
});

test('ED-16 keeps an imported grace group read-only until it is removed whole', async ({ page }, testInfo) => {
  const source = fs.readFileSync('tests/fixtures/editor-rich.musicxml', 'utf8')
    .replace('<string>4</string><fret>0</fret></technical></notations></note>\n      <note><grace slash="yes"/><chord/>',
      '<string>4</string><fret>0</fret><other-technical>TEF grace effect 5</other-technical></technical></notations></note>\n      <note><grace slash="yes"/><chord/>');
  expect(source).toContain('TEF grace effect 5');
  let savedSource = '';
  await page.route('**/api/songs**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: 201, json: { id: 86, title: 'Rich editor exercise', revision: 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'rich-tef-grace.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  const lowNote = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(lowNote).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await lowNote.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('combobox', { name: 'Selection voice' }).selectOption('2');
  await page.getByRole('combobox', { name: 'Selection event' }).selectOption('1');
  await page.getByRole('combobox', { name: 'Selection string' }).selectOption('4');
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 0');
  await page.getByText('Techniques', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit grace…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit grace group' });
  await expect(dialog.getByRole('note')).toContainText('Grace event 1, string 4 has the marking “TEF grace effect 5”.');
  await expect(dialog.getByRole('button', { name: 'Apply grace group' })).toHaveCount(0);
  await dialog.screenshot({ path: testInfo.outputPath('grace-read-only-dialog.png') });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => savedSource).toBe(source);
  await page.getByRole('button', { name: 'Edit grace…' }).click();
  await dialog.getByRole('button', { name: 'Remove grace group' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Grace group removed.' })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => savedSource.includes('<grace')).toBe(false);
  expect(savedSource).toContain('<opaque:keep data="unchanged">');
});
