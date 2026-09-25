import { expect, test } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';

test('ED-14 connects a cross-bar tie by pointer, blocks pitch edits, removes it, and undoes removal', async ({ page }, testInfo) => {
  let savedSource = '';
  await page.route('**/api/songs', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: 201, json: { id: 73, title: 'Tie exercise', revision: 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-tie.musicxml');
  const frets = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ });
  await expect(frets).toHaveCount(2, { timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const origin = (await frets.nth(0).boundingBox())!;
  await page.mouse.click(origin.x + origin.width / 2, origin.y + origin.height / 2);
  await page.getByRole('button', { name: 'Tie', exact: true }).click();
  await expect(page.getByText(/Origin: measure 1, event 1, string 4, fret 0/)).toBeVisible();
  await page.locator('.editor-technique-tools').screenshot({ path: testInfo.outputPath('tie-pending-sidebar.png') });
  const destination = (await frets.nth(1).boundingBox())!;
  await page.mouse.click(destination.x + destination.width / 2, destination.y + destination.height / 2);
  await expect(page.getByText('Tie added between the selected notes.')).toBeVisible();
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => savedSource).not.toBe('');
  expect(new DOMParser().parseFromString(savedSource, 'application/xml').getElementsByTagName('tie')).toHaveLength(2);
  await page.getByLabel('Fret', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This note is tied');
  await page.getByLabel('Fret', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Remove tie' }).click();
  await expect(page.getByText('Tie removed.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove tie' })).toBeVisible();
});

test('ED-14 connects the same tie through inspector navigation and can cancel pending mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-tie.musicxml');
  const fret = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(fret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await fret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('button', { name: 'Tie', exact: true }).click();
  await page.getByRole('combobox', { name: 'Selection measure' }).selectOption('2');
  await page.getByRole('button', { name: 'Use selected note' }).click();
  await expect(page.getByText('Tie added between the selected notes.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('combobox', { name: 'Selection measure' }).selectOption('1');
  await page.getByRole('button', { name: 'Tie', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel tie' }).click();
  await expect(page.getByText('Tie cancelled.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tie', exact: true })).toBeEnabled();
});
