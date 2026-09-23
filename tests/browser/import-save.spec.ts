import { expect, test } from '@playwright/test';
import fs from 'node:fs';

test('saves and reopens an imported MusicXML document', async ({ page }) => {
  const originalSource = fs.readFileSync('tests/fixtures/editor-rich.musicxml', 'utf8');
  let savedDocument: Record<string, unknown> | null = null;
  await page.route('**/api/songs', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: '[]' });
      return;
    }
    savedDocument = JSON.parse(route.request().postData() ?? '{}').score as Record<string, unknown>;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 42, title: (savedDocument as Record<string, unknown>).title }) });
  });
  await page.route('**/api/songs/42', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 42, title: savedDocument?.title, score: savedDocument, source_text: null }) });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'editor-rich.musicxml', mimeType: 'application/xml', buffer: Buffer.from(originalSource) });
  await expect(page.getByRole('heading', { name: 'Rich editor exercise' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit score' }).click();
  await page.getByRole('button', { name: 'Done editing' }).click();
  const save = page.getByRole('button', { name: '＋ Save to library' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole('button', { name: '✓ Saved' })).toBeDisabled();
  const persisted: Record<string, unknown> = savedDocument ?? {};
  expect(persisted).toMatchObject({ version: 2, kind: 'musicxml', sourceFormat: 'musicxml' });
  expect(persisted.source).toBe(originalSource);

  await page.getByRole('button', { name: 'Rich editor exercise' }).click();
  await expect(page.getByRole('heading', { name: 'Rich editor exercise' })).toBeVisible();
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '✓ Saved' })).toBeDisabled();
});
