import { expect, test } from '@playwright/test';

test('saves and reopens an imported MusicXML document', async ({ page }) => {
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
    if (route.request().method() === 'PATCH') {
      savedDocument = JSON.parse(route.request().postData() ?? '{}').score as Record<string, unknown>;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 42, title: savedDocument.title }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 42, title: savedDocument?.title, score: savedDocument, source_text: null }) });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/techniques.musicxml');
  await expect(page.getByRole('heading', { name: 'Technique exercise' })).toBeVisible();
  const save = page.getByRole('button', { name: '＋ Save to library' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole('button', { name: '✓ Saved' })).toBeDisabled();
  const persisted: Record<string, unknown> = savedDocument ?? {};
  expect(persisted).toMatchObject({ version: 2, kind: 'musicxml', sourceFormat: 'musicxml' });
  expect(persisted.source).toContain('<score-partwise');

  await page.getByLabel('Score title').fill('Edited technique exercise');
  await page.getByRole('button', { name: 'Apply edits' }).click();
  await expect(page.getByRole('heading', { name: 'Edited technique exercise' })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved to your library.')).toBeVisible();
  const editedDocument = savedDocument as unknown as Record<string, unknown>;
  expect(editedDocument.source).toContain('Edited technique exercise');

  await page.getByRole('button', { name: 'Edited technique exercise' }).click();
  await expect(page.getByRole('heading', { name: 'Edited technique exercise' })).toBeVisible();
  await expect(page.getByText('1 measures')).toBeVisible();
  await expect(page.getByRole('button', { name: '✓ Saved' })).toBeDisabled();
});
