import { expect, test } from '@playwright/test';
import fs from 'node:fs';

test('ED-14 authors a cross-bar hammer-on by pointer and a slide by keyboard, then removes a named span', async ({ page }, testInfo) => {
  const source = fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8')
    .replace(/(<measure number="2">[\s\S]*?<step>)D(<\/step>[\s\S]*?<fret>)0(<\/fret>)/, '$1E$2' + '2$3');
  let savedSource = '';
  await page.route('**/api/songs**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200, json: { id: 91, title: 'Tie exercise', revision: route.request().method() === 'POST' ? 0 : 1 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'transitions.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  const notation = page.getByTestId('notation');
  const origin = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const destination = notation.locator('svg text').filter({ hasText: /^2$/ }).first();
  await expect(origin).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const click = async (target: typeof origin) => { const box = (await target.boundingBox())!; await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); };
  await click(origin);
  await page.getByRole('button', { name: 'Pull-off', exact: true }).click();
  await click(destination);
  await expect(page.getByRole('alert')).toContainText('A pull-off must go to a lower fret.');
  await expect(page.getByRole('button', { name: 'Cancel pull-off' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel pull-off' }).click();
  await click(origin);
  await page.getByRole('button', { name: 'Hammer-on', exact: true }).click();
  await click(destination);
  await expect(page.getByRole('status').filter({ hasText: 'Hammer-on added between the selected notes.' })).toBeVisible();
  await expect(notation.locator('svg text').filter({ hasText: /^H$/ })).toHaveCount(1);
  await notation.screenshot({ path: testInfo.outputPath('hammer-on.png') });
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect.poll(() => savedSource).toContain('<hammer-on type="start">H</hammer-on>');
  expect(savedSource).toContain('<hammer-on type="stop"/>');

  await expect(page.getByRole('button', { name: 'Remove hammer-on from m1 e1' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove hammer-on from m1 e1' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Hammer-on removed.' })).toBeVisible();
  await expect(notation.locator('svg text').filter({ hasText: /^H$/ })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Selection measure' }).selectOption('1');
  await page.getByRole('combobox', { name: 'Selection string' }).selectOption('4');
  await page.getByRole('button', { name: 'Slide', exact: true }).click();
  await page.getByRole('combobox', { name: 'Selection measure' }).selectOption('2');
  await page.getByRole('button', { name: 'Use selected note' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Slide added between the selected notes.' })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => savedSource).toContain('<slide type="start" number="1"/>');
  expect(savedSource).not.toContain('hammer-on');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(notation.locator('svg text').filter({ hasText: /^H$/ })).toHaveCount(1);
});
