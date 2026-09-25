import { expect, test, type Page } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';

async function selectEvent(page: Page, measure: string, voice: string, event: string) {
  const firstFret = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  if (!(await page.getByRole('button', { name: 'Done editing' }).count())) await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('combobox', { name: 'Selection measure' }).selectOption(measure);
  await page.getByRole('combobox', { name: 'Selection voice' }).selectOption(voice);
  await page.getByRole('combobox', { name: 'Selection event' }).selectOption(event);
}

test('ED-18 anchors a chord, section and annotation at the selected event and keeps them after reopening', async ({ page }, testInfo) => {
  let savedSource = '';
  await page.route('**/api/songs**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: 201, json: { id: 88, title: 'Rich editor exercise', revision: 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-rich.musicxml');
  await selectEvent(page, '2', '2', '3');
  await page.getByText('Text', { exact: true }).click();
  await page.getByRole('button', { name: 'Chord name…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Chord name' });
  await dialog.getByLabel('Quality').selectOption('minor');
  await expect(dialog).toContainText('Shows as Cm');
  await dialog.screenshot({ path: testInfo.outputPath('chord-dialog.png') });
  await dialog.getByRole('button', { name: 'Apply chord' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Chord “Cm” added at measure 2, event 3.' })).toBeVisible();
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
  await selectEvent(page, '2', '2', '3');
  await page.getByText('Text', { exact: true }).click();
  await page.getByRole('button', { name: 'Chord name…' }).click();
  dialog = page.getByRole('dialog', { name: 'Chord name' });
  await expect(dialog.getByLabel('Existing item')).toHaveValue('0');
  await expect(dialog.getByLabel('Quality')).toHaveValue('minor');
  await dialog.getByRole('button', { name: 'Remove chord' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Chord “Cm” removed from measure 2, event 3.' })).toBeVisible();
  await expect(notation.locator('svg text').filter({ hasText: /^Cm$/ })).toHaveCount(0);
  await expect(notation.locator('svg text').filter({ hasText: /^Let ring$/ })).toHaveCount(1);
});
