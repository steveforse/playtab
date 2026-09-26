import { expect, test, type Page } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';

async function selectBeat(page: Page, measure: string, voice: string, event: string) {
  const firstFret = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  if (!(await page.getByRole('button', { name: 'Done editing' }).count())) await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('combobox', { name: 'Selection measure' }).selectOption(measure);
  await page.getByRole('combobox', { name: 'Selection voice' }).selectOption(voice);
  await page.getByRole('combobox', { name: 'Selection beat' }).selectOption(event);
}

test('ED-18 anchors a chord, section and annotation at the selected beat and keeps them after reopening', async ({ page }, testInfo) => {
  let savedSource = '';
  await page.route('**/api/songs**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: 201, json: { id: 88, title: 'Rich editor exercise', revision: 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-rich.musicxml');
  await selectBeat(page, '2', '2', '3');
  await page.getByRole('button', { name: 'Chord name…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Chord name' });
  await dialog.getByLabel('Quality').selectOption('minor');
  await expect(dialog).toContainText('Shows as Cm');
  await dialog.screenshot({ path: testInfo.outputPath('chord-dialog.png') });
  await dialog.getByRole('button', { name: 'Apply chord' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Chord “Cm” added at measure 2, beat 3.' })).toBeVisible();
  await page.getByRole('button', { name: 'Section label…' }).click();
  dialog = page.getByRole('dialog', { name: 'Section label' });
  await dialog.getByLabel('Text').fill('Chorus');
  await dialog.getByRole('button', { name: 'Apply section' }).click();
  await page.getByRole('button', { name: 'Annotation…' }).click();
  dialog = page.getByRole('dialog', { name: 'Annotation' });
  await dialog.getByLabel('Text').fill('Let ring');
  await dialog.getByRole('button', { name: 'Apply annotation' }).click();
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg text').filter({ hasText: /^Cm$/ })).toHaveCount(1);
  await expect(notation.locator('svg text').filter({ hasText: /Chorus/ })).toHaveCount(1);
  await expect(notation.locator('svg text').filter({ hasText: /^Let ring$/ })).toHaveCount(1);
  await notation.screenshot({ path: testInfo.outputPath('text-score.png') });

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(notation.locator('svg text').filter({ hasText: /^Let ring$/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => savedSource).not.toBe('');
  const second = new DOMParser().parseFromString(savedSource, 'application/xml').getElementsByTagName('measure')[1];
  expect(second.getElementsByTagName('harmony')).toHaveLength(2);
  expect(second.getElementsByTagName('rehearsal')[0].textContent).toBe('Chorus');
  expect(savedSource).toContain('<words>Section A</words>');

  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'reopened.musicxml', mimeType: 'application/xml', buffer: Buffer.from(savedSource) });
  await selectBeat(page, '2', '2', '3');
  await page.getByRole('button', { name: 'Chord name…' }).click();
  dialog = page.getByRole('dialog', { name: 'Chord name' });
  await expect(dialog.getByLabel('Existing item')).toHaveValue('0');
  await expect(dialog.getByLabel('Quality')).toHaveValue('minor');
  await dialog.getByRole('button', { name: 'Remove chord' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Chord “Cm” removed from measure 2, beat 3.' })).toBeVisible();
  await expect(notation.locator('svg text').filter({ hasText: /^Cm$/ })).toHaveCount(0);
  await expect(notation.locator('svg text').filter({ hasText: /^Let ring$/ })).toHaveCount(1);
});

test('ED-18 edits a timed lyric verse and the separate Lyrics & chords text', async ({ page }, testInfo) => {
  let savedSource = '';
  await page.route('**/api/songs**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: 201, json: { id: 89, title: 'Rich editor exercise', revision: 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-rich.musicxml');
  await selectBeat(page, '1', '2', '2');
  await page.getByRole('button', { name: 'Lyric syllable…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Lyric syllable' });
  await expect(dialog.getByLabel('Lyric text')).toHaveValue('Low');
  await dialog.getByLabel('Verse').selectOption('2');
  await dialog.getByLabel('Lyric text').fill('High');
  await dialog.getByLabel('Syllabic').selectOption('begin');
  await dialog.screenshot({ path: testInfo.outputPath('lyric-dialog.png') });
  await dialog.getByRole('button', { name: 'Apply lyric' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Verse 2 lyric “High” applied at measure 1, beat 2.' })).toBeVisible();
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg text').filter({ hasText: /^High/ })).toHaveCount(1);
  await expect(notation.locator('svg text').filter({ hasText: /^Low$/ })).toHaveCount(1);

  await page.getByRole('button', { name: 'Lyrics & chords…' }).click();
  dialog = page.getByRole('dialog', { name: 'Lyrics and chords text' });
  await dialog.getByLabel('Lyrics and chords text').fill('VERSE 1\n  C       G\nLow and high\n\nCHORUS\nSing it again');
  await dialog.getByRole('button', { name: 'Apply text' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Lyrics & chords text updated.' })).toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('tab', { name: 'Lyrics & chords' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Lyrics & chords' })).toContainText('Sing it again');
  await page.getByRole('tab', { name: 'Tablature' }).click();
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => savedSource).not.toBe('');
  expect(savedSource.match(/<lyric number="2"><syllabic>begin<\/syllabic><text>High<\/text><\/lyric>/g)).toHaveLength(2);
  expect(savedSource.match(/<text>Low<\/text>/g)).toHaveLength(2);
  expect(savedSource).toContain('LYRICS &amp; CHORDS\n\nVERSE 1\n  C       G\nLow and high\n\nCHORUS\nSing it again');

  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'reopened.musicxml', mimeType: 'application/xml', buffer: Buffer.from(savedSource) });
  await expect(page.getByTestId('notation').locator('svg text').filter({ hasText: /^High/ })).toHaveCount(1, { timeout: 45000 });
  await page.getByRole('tab', { name: 'Lyrics & chords' }).click();
  await expect(page.locator('#tab-lyrics-content pre')).toHaveText('VERSE 1\n  C       G\nLow and high\n\nCHORUS\nSing it again');
});
