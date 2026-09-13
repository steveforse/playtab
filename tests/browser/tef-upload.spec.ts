import { test, expect } from '@playwright/test';
import { importer } from '@coderline/alphatab';

test('unavailable converter errors allow retry without losing the score', async ({ page }) => {
  await page.route('**/api/tef_imports', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'TEF converter is unavailable or timed out. Please try again.' }) }));
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'test.tef', mimeType: 'application/octet-stream', buffer: Buffer.alloc(300) });
  await expect(page.getByRole('alert')).toContainText('unavailable or timed out');
  await expect(page.getByLabel('Choose tablature file')).toBeEnabled();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('An open-G kind of morning');
});

test('invalid TEF uploads display an error and leave the current score intact', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'broken.tef', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') });
  await expect(page.getByRole('alert')).toContainText('incomplete or invalid');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('An open-G kind of morning');
});

test('uploads the private TEF directly, converts, renders and plays', async ({ page }) => {
  test.skip(!process.env.PLAYTAB_TEFSOURCE, 'Set PLAYTAB_TEFSOURCE for the private end-to-end conversion.');
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  const converted = page.waitForResponse(r => r.url().endsWith('/api/tef_imports'));
  await page.getByLabel('Choose tablature file').setInputFiles(process.env.PLAYTAB_TEFSOURCE!);
  const response = await converted;
  expect(response.status()).toBe(200);
  const { musicxml, warnings } = await response.json();
  expect(warnings.length).toBeGreaterThan(0);
  const decoded = importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(musicxml));
  const tab = decoded.tracks[0].staves.find(s => s.tuning.length === 5)!;
  expect(tab.bars[3].voices.flatMap(v => v.beats.flatMap(b => b.notes.map(n => n.fret)))).toEqual([1, 0, 5, 5, 0, 1, 0]);
  expect(tab.bars[7].voices.flatMap(v => v.beats.flatMap(b => b.notes.map(n => n.fret))).slice(0, 2)).toEqual([0, 5]);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/wellerman/i);
  await expect(page.locator('.subtitle')).toContainText('34 measures');
  await expect(page.getByRole('button', { name: 'Play (top)', exact: true })).toBeEnabled({ timeout: 45000 });
  await page.getByRole('button', { name: 'Play (top)', exact: true }).click();
  await expect(page.locator('.player-status span')).toContainText('0:01 /');
  await page.getByRole('button', { name: 'Pause (top)', exact: true }).click();
  await page.screenshot({ path: 'tmp/tef-spike/direct-upload.png' });
});
