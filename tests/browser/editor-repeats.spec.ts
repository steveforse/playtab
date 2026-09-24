import { expect, test } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';

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
