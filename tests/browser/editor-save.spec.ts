import { expect, test } from '@playwright/test';

test('ED-07 saves changes to the same song and switches to a separately titled copy', async ({ page }) => {
  const songs = new Map<number, { score: Record<string, unknown>; revision: number }>();
  let nextId = 1;
  await page.route('**/api/songs/*', async route => {
    const id = Number(route.request().url().split('/').at(-1));
    const existing = songs.get(id);
    if (!existing) return route.fulfill({ status: 404, json: { error: 'Not found.' } });
    if (route.request().method() === 'GET') return route.fulfill({ json: { id, title: existing.score.title, score: existing.score, revision: existing.revision, source_text: null } });
    const body = route.request().postDataJSON();
    if (body.revision !== existing.revision) return route.fulfill({ status: 409, json: { error: 'Changed in another tab.' } });
    existing.score = body.score;
    existing.revision += 1;
    return route.fulfill({ json: { id, title: existing.score.title, revision: existing.revision } });
  });
  await page.route('**/api/songs', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    const score = route.request().postDataJSON().score as Record<string, unknown>;
    const id = nextId++;
    songs.set(id, { score, revision: 0 });
    return route.fulfill({ status: 201, json: { id, title: score.title, revision: 0 } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect(page.getByRole('button', { name: '✓ Saved' })).toBeDisabled();
  await page.getByRole('button', { name: 'Edit score' }).click();
  const note = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await note.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('4');
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: '✓ Saved' })).toBeDisabled();
  expect(songs.size).toBe(1);
  expect(songs.get(1)?.revision).toBe(1);
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: 'Save a copy…' }).click();
  await expect(page.getByLabel('Copy title')).toHaveValue(/— copy$/);
  await page.getByLabel('Copy title').fill('Separate arrangement');
  await page.getByRole('button', { name: 'Save copy' }).click();
  await expect(page.getByRole('heading', { name: 'Separate arrangement' })).toBeVisible();
  expect(songs.size).toBe(2);
  expect(songs.get(1)?.score.title).not.toBe('Separate arrangement');
  expect(songs.get(2)?.score.title).toBe('Separate arrangement');
  await page.getByRole('button', { name: 'Done editing' }).click();
  await page.getByRole('button', { name: 'An open-G kind of morning' }).click();
  await expect(page.getByRole('heading', { name: 'An open-G kind of morning' })).toBeVisible();
});
