import { expect, test } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';

test('ED-12 inserts an inherited-meter rest measure and undoes it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-rich.musicxml');
  const firstFret = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('combobox', { name: 'Selection measure' }).selectOption('2');
  await page.getByText('Measure', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Insert measure after' }).click();
  await expect(page.getByRole('combobox', { name: 'Selection measure' }).locator('option')).toHaveCount(3);
  await expect(page.getByLabel('Selection inspector')).toContainText('Measure 3');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Selection measure' }).locator('option')).toHaveCount(2);
});

test('ED-12 previews excluded dependencies and duplicates a musical measure', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-rich.musicxml');
  const firstFret = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('combobox', { name: 'Selection measure' }).selectOption('2');
  await page.getByText('Measure', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Duplicate measure…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Duplicate measure' });
  await expect(dialog).toContainText('cross-measure tie');
  await expect(dialog).toContainText('repeat marker');
  await dialog.screenshot({ path: testInfo.outputPath('duplicate-measure-dialog.png') });
  await dialog.getByRole('button', { name: 'Duplicate measure', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Selection measure' }).locator('option')).toHaveCount(3);
  await expect(page.getByLabel('Selection inspector')).toContainText('Measure 3');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Selection measure' }).locator('option')).toHaveCount(2);
});

test('ED-12 keeps original and copied note targets distinct after duplication', async ({ page }) => {
  let savedSource = '';
  await page.route('**/api/songs', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: 201, json: { id: 71, title: 'Rich exercise', revision: 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-rich.musicxml');
  const firstFret = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(firstFret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('combobox', { name: 'Selection measure' }).selectOption('2');
  await page.getByText('Measure', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Duplicate measure…' }).click();
  await page.getByRole('dialog', { name: 'Duplicate measure' }).getByRole('button', { name: 'Duplicate measure', exact: true }).click();
  await page.getByRole('combobox', { name: 'Selection measure' }).selectOption('2');
  await page.getByRole('combobox', { name: 'Selection voice' }).selectOption('2');
  await page.getByRole('combobox', { name: 'Selection string' }).selectOption('4');
  await page.getByRole('combobox', { name: 'Selection event' }).selectOption('2');
  await page.getByLabel('Fret').fill('7');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('combobox', { name: 'Selection measure' }).selectOption('3');
  await page.getByRole('combobox', { name: 'Selection voice' }).selectOption('2');
  await page.getByRole('combobox', { name: 'Selection string' }).selectOption('4');
  await page.getByRole('combobox', { name: 'Selection event' }).selectOption('2');
  await page.getByLabel('Fret').fill('9');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => savedSource).not.toBe('');
  const measures = Array.from(new DOMParser().parseFromString(savedSource, 'application/xml').getElementsByTagName('measure'));
  const fourthStringFrets = (measure: (typeof measures)[number]) => Array.from(measure.getElementsByTagName('technical'))
    .filter(item => item.getElementsByTagName('string')[0]?.textContent === '4')
    .map(item => item.getElementsByTagName('fret')[0]?.textContent);
  expect(fourthStringFrets(measures[1])).toContain('7');
  expect(fourthStringFrets(measures[2])).toContain('9');
  expect(fourthStringFrets(measures[1])).not.toContain('9');
});
