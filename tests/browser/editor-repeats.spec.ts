import { expect, test } from '@playwright/test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';

test('ED-15 adds and saves a two-bar repeat, then undoes it', async ({ page }) => {
  let savedSource = '';
  await page.route('**/api/songs', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: 201, json: { id: 81, title: 'Tie exercise', revision: 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-tie.musicxml');
  const firstFret = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByText('Measure', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Repeat / endings…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Repeat / endings' });
  await expect(dialog).toContainText('Existing repeats: none');
  await dialog.getByLabel('Start measure').fill('1');
  await dialog.getByLabel('End measure').fill('2');
  await dialog.getByRole('button', { name: 'Add repeat' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Repeat added' })).toBeVisible();
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => savedSource).not.toBe('');
  const xml = new DOMParser().parseFromString(savedSource, 'application/xml');
  const repeats = Array.from(xml.getElementsByTagName('repeat'));
  expect(repeats.map(repeat => repeat.getAttribute('direction'))).toEqual(['forward', 'backward']);
  expect(repeats[1].getAttribute('times')).toBe('2');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat / endings…' }).click();
  await expect(page.getByRole('dialog', { name: 'Repeat / endings' })).toContainText('Existing repeats: none');
});

test('ED-15 adds two endings and confirms dependent removal', async ({ page }, testInfo) => {
  const document = new DOMParser().parseFromString(fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8'), 'application/xml');
  const part = document.getElementsByTagName('part')[0];
  const first = document.getElementsByTagName('measure')[0];
  part.removeChild(document.getElementsByTagName('measure')[1]);
  for (let number = 2; number <= 6; number++) {
    const measure = first.cloneNode(true) as typeof first;
    measure.setAttribute('number', String(number)); part.appendChild(measure);
  }
  let savedSource = '';
  await page.route('**/api/songs', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: 201, json: { id: 82, title: 'Repeat exercise', revision: 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'repeat.musicxml', mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(new XMLSerializer().serializeToString(document)) });
  const firstFret = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByText('Measure', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Repeat / endings…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Repeat / endings' });
  await dialog.getByLabel('Start measure').fill('2');
  await dialog.getByLabel('End measure').fill('4');
  await dialog.getByRole('button', { name: 'Add repeat' }).click();
  await page.getByRole('button', { name: 'Repeat / endings…' }).click();
  dialog = page.getByRole('dialog', { name: 'Repeat / endings' });
  await expect(dialog.getByLabel('Repeat region')).toHaveValue('1:3');
  await expect(dialog.getByLabel('First ending start')).toHaveValue('4');
  await expect(dialog.getByLabel('Second ending end')).toHaveValue('5');
  await dialog.screenshot({ path: testInfo.outputPath('repeat-endings-dialog.png') });
  await dialog.getByRole('button', { name: 'Add first/second endings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'First and second endings added' })).toBeVisible();
  const labels = (await page.getByTestId('notation').locator('svg text').allTextContents()).map(value => value.trim());
  expect(labels).toContain('1.');
  expect(labels).toContain('2.');
  await page.getByTestId('notation').screenshot({ path: testInfo.outputPath('repeat-endings-score.png') });
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => savedSource).not.toBe('');
  const saved = new DOMParser().parseFromString(savedSource, 'application/xml');
  expect(Array.from(saved.getElementsByTagName('ending')).map(item => `${item.getAttribute('number')}:${item.getAttribute('type')}`))
    .toEqual(['1:start', '1:stop', '2:start', '2:stop']);
  await page.getByRole('button', { name: 'Repeat / endings…' }).click();
  dialog = page.getByRole('dialog', { name: 'Repeat / endings' });
  await expect(dialog).toContainText('First ending: measures 4–4; second ending: measures 5–5');
  await dialog.getByRole('button', { name: 'Clear selected repeat/ending…' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Clear repeat and endings' });
  await expect(confirmation).toContainText('dependent first ending in measures 4–4 and second ending in measures 5–5');
  await confirmation.getByRole('button', { name: 'Clear repeat and endings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'removed with its dependent endings' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat / endings…' }).click();
  await expect(page.getByRole('dialog', { name: 'Repeat / endings' })).toContainText('First ending: measures 4–4');
});
