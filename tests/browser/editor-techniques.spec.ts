import { expect, test } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';

test('ED-17 edits picking, fretting and bend independently on a hammer-on note', async ({ page }, testInfo) => {
  let savedSource = '';
  await page.route('**/api/songs**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200,
      json: { id: 87, title: 'Rich editor exercise', revision: route.request().method() === 'POST' ? 0 : 1 } });
  });
  const technical = () => {
    const note = Array.from(new DOMParser().parseFromString(savedSource, 'application/xml').getElementsByTagName('note'))
      .find(item => item.getElementsByTagName('staff')[0]?.textContent === '2' && !item.getElementsByTagName('grace').length)!;
    return Array.from(note.getElementsByTagName('technical')[0].childNodes).filter(item => item.nodeType === 1)
      .map(node => node as unknown as Element).map(item => `${item.localName}=${item.textContent}`);
  };
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-rich.musicxml');
  const notation = page.getByTestId('notation');
  const firstFret = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('combobox', { name: 'Selection voice' }).selectOption('2');
  await page.getByRole('combobox', { name: 'Selection beat' }).selectOption('2');
  await page.getByRole('combobox', { name: 'Selection string' }).selectOption('4');
  await expect(page.getByLabel('Picking hand', { exact: true })).toHaveValue('T');
  await expect(page.getByLabel('Fretting hand', { exact: true })).toHaveValue('1');
  await page.getByLabel('Fretting hand', { exact: true }).selectOption('3');
  await expect(page.getByRole('status').filter({ hasText: 'Fretting hand set to 3.' })).toBeVisible();
  await page.getByLabel('Picking hand', { exact: true }).selectOption('I');
  await expect(page.getByRole('status').filter({ hasText: 'Picking hand set to I.' })).toBeVisible();
  await expect(notation.locator('svg text').filter({ hasText: /③/ })).toHaveCount(1);
  await expect(notation.locator('svg text').filter({ hasText: /^I$/ })).toHaveCount(1);
  await expect(notation.locator('svg text').filter({ hasText: /^H$/ })).toHaveCount(1);

  await page.getByRole('button', { name: 'Bend…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Bend' });
  await expect(dialog.getByRole('button', { name: 'Remove bend' })).toHaveCount(0);
  await dialog.getByLabel('Amount').selectOption('2');
  await dialog.getByLabel('Shape').selectOption('release');
  await dialog.screenshot({ path: testInfo.outputPath('bend-dialog.png') });
  await dialog.getByRole('button', { name: 'Apply bend' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Bend and release Whole step applied.' })).toBeVisible();
  await notation.screenshot({ path: testInfo.outputPath('techniques-score.png') });
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => savedSource).not.toBe('');
  expect(technical()).toEqual(['string=4', 'fret=0', 'hammer-on=H', 'fingering=3', 'other-technical=TEF fingering I', 'bend=2', 'bend=2']);

  await page.getByRole('button', { name: 'Bend…' }).click();
  await expect(dialog.getByLabel('Shape')).toHaveValue('release');
  await dialog.getByRole('button', { name: 'Remove bend' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Bend removed.' })).toBeVisible();
  await page.getByLabel('Picking hand', { exact: true }).selectOption('none');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => technical().join('|')).toBe('string=4|fret=0|hammer-on=H|fingering=3');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Picking hand', { exact: true })).toHaveValue('I');
});
