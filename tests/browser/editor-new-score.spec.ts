import { expect, test } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';

test('ED-21 creates a blank score, edits it, saves it, and reopens it from the library', async ({ page }, testInfo) => {
  let saved: { title: string; source: string; sourceName: string; sourceFormat: string } | null = null;
  await page.route('**/api/songs**', route => {
    const request = route.request();
    if (request.method() === 'GET' && /\/api\/songs\/\d+/.test(request.url())) {
      return route.fulfill({ json: { id: 94, title: saved!.title, score: saved, source_text: null, revision: 0 } });
    }
    if (request.method() === 'GET') return route.fulfill({ json: saved ? [{ id: 94, title: saved.title }] : [] });
    saved = request.postDataJSON().score;
    return route.fulfill({ status: 201, json: { id: 94, title: saved!.title, revision: 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /New score/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New score' });
  await expect(dialog.getByLabel('New score title')).toHaveValue('Untitled');
  await dialog.getByLabel('New score title').fill('Blank waltz');
  await dialog.getByLabel('New score beats').selectOption('3');
  await dialog.getByLabel('New score measures').fill('4');
  await dialog.screenshot({ path: testInfo.outputPath('new-score-dialog.png') });
  await dialog.getByRole('button', { name: 'Create score' }).click();
  await expect(page.getByRole('heading', { name: 'Blank waltz', level: 1 })).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole('button', { name: 'Done editing' })).toBeVisible();
  const inspector = page.getByLabel('Selection inspector');
  await expect(inspector).toContainText('Measure 1');
  await expect(inspector).toContainText('String 1');
  await expect(page.getByRole('combobox', { name: 'Selection measure' }).locator('option')).toHaveCount(4);

  await page.getByRole('combobox', { name: 'Selection string' }).selectOption('4');
  await page.getByLabel('Fret', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(inspector).toContainText('Fret 2');
  await page.getByRole('button', { name: '1/4 duration' }).click();
  await expect(page.getByTestId('notation').locator('svg text').filter({ hasText: /^2$/ })).toHaveCount(1);
  await page.getByTestId('notation').screenshot({ path: testInfo.outputPath('new-score.png') });

  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => saved?.title).toBe('Blank waltz');
  expect(saved!.sourceName).toBe('Blank waltz.musicxml');
  expect(saved!.sourceFormat).toBe('musicxml');
  const measures = new DOMParser().parseFromString(saved!.source, 'application/xml').getElementsByTagName('measure');
  expect(measures).toHaveLength(4);
  expect(measures[0].getElementsByTagName('beats')[0].textContent).toBe('3');
  expect(measures[0].getElementsByTagName('fret')[0].textContent).toBe('2');

  await page.goto('/');
  await page.getByRole('button', { name: 'Blank waltz' }).click();
  await expect(page.getByRole('heading', { name: 'Blank waltz', level: 1 })).toBeVisible({ timeout: 45000 });
  await expect(page.getByTestId('notation').locator('svg text').filter({ hasText: /^2$/ })).toHaveCount(1);
});
