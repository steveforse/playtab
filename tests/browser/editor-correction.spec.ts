import { expect, test } from '@playwright/test';
import { exportAscii } from '../../app/frontend/music/ascii';
import { demo } from '../../app/frontend/music/score';
import { DOMParser } from '@xmldom/xmldom';

test('ED-03 applies a fret field edit and moves a note to another string', async ({ page }) => {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const note = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await note.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const fret = page.getByLabel('Fret', { exact: true });
  await fret.fill('12');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 12');
  await expect(notation.locator('svg text').filter({ hasText: /^12$/ })).toHaveCount(1);
  await page.getByLabel('Move to string').selectOption('2');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('String 2');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('ED-03 validates fret field values before mutating the score', async ({ page }) => {
  await page.goto('/');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const note = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await note.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByLabel('Fret', { exact: true }).fill('37');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('0 to 36');
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 0');
});

test('ED-03 moves an imported note without breaking paired notation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/paired-staff.musicxml');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const note = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await note.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByLabel('Move to string').selectOption('2');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('String 2');
  await page.getByLabel('Fret', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 7');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('inspector navigation edits the newly selected imported note, not the previous source ID', async ({ page }) => {
  let savedSource = '';
  await page.route('**/api/songs', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    savedSource = route.request().postDataJSON().score.source;
    return route.fulfill({ status: 201, json: { id: 41, title: 'Selection test', revision: 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/paired-staff.musicxml');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const note = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await note.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByLabel('Selection inspector')).toContainText('String 1');
  await page.getByLabel('Fret', { exact: true }).fill('37');
  await page.getByLabel('Selection event').selectOption('2');
  await expect(page.getByLabel('Selection inspector')).toContainText('Event 1');
  await expect(page.getByRole('alert')).toContainText('0 to 36');
  await page.getByLabel('Fret', { exact: true }).fill('5');
  await page.getByLabel('Selection event').selectOption('2');
  await page.getByLabel('Selection string').selectOption('3');
  await expect(page.getByLabel('Selection inspector')).toContainText('Event 2');
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 0');
  await page.getByLabel('Fret', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 7');
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect(page.getByRole('button', { name: '✓ Saved' })).toBeDisabled();
  const xml = new DOMParser().parseFromString(savedSource, 'application/xml');
  const tabNotes = Array.from(xml.getElementsByTagName('note')).filter(item => item.getElementsByTagName('string').length);
  expect(tabNotes.map(item => [item.getElementsByTagName('string')[0].textContent, item.getElementsByTagName('fret')[0].textContent]))
    .toEqual([['1', '5'], ['3', '0'], ['3', '7']]);
});

test('ED-09 promotes a native high-fret edit as one undoable change and saves MusicXML', async ({ page }) => {
  let saved: { score: Record<string, unknown>; source_text: string | null } | null = null;
  await page.route('**/api/songs', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: saved ? [{ id: 1, title: saved.score.title }] : [] });
    saved = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { id: 1, title: saved!.score.title, revision: 0 } });
  });
  await page.route('**/api/songs/1', async route => {
    if (!saved) return route.fulfill({ status: 404, json: { error: 'Not found' } });
    return route.fulfill({ json: { id: 1, title: saved.score.title, score: saved.score, source_text: saved.source_text, revision: 0 } });
  });
  await page.goto('/');
  const originalText = exportAscii(demo);
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Promoted provenance');
  await page.getByLabel('Plaintext tablature').fill(originalText);
  await page.getByRole('button', { name: /Open in player/ }).click();
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const note = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await note.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByLabel('Fret', { exact: true }).fill('28');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 28');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 0');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 28');
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect(page.getByRole('button', { name: '✓ Saved' })).toBeDisabled();
  const persisted = saved as unknown as { score: Record<string, unknown>; source_text: string | null };
  expect(persisted.score.version).toBe(2);
  expect(persisted.score.kind).toBe('musicxml');
  expect(persisted.source_text).toBe(originalText);
  await page.reload();
  await page.getByRole('button', { name: 'Promoted provenance' }).click();
  await expect(page.getByRole('heading', { name: 'Promoted provenance' })).toBeVisible();
  await expect(notation.locator('svg text').filter({ hasText: /^28$/ })).toHaveCount(1);
});
