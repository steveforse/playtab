import { expect, test } from '@playwright/test';

test('ED-08 guards leaving an edited score and saves the final draft before continuing', async ({ page }, testInfo) => {
  let saved: Record<string, any> | null = null;
  let revision = 0;
  await page.route('**/api/songs/1', route => {
    if (route.request().method() === 'PATCH') {
      saved = route.request().postDataJSON().score;
      revision++;
      return route.fulfill({ json: { id: 1, title: saved?.title, revision } });
    }
    return route.fulfill({ json: { id: 1, title: saved?.title, score: saved, source_text: null, revision } });
  });
  await page.route('**/api/songs', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    saved = route.request().postDataJSON().score;
    return route.fulfill({ status: 201, json: { id: 1, title: saved?.title, revision } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await expect(page.getByRole('button', { name: '✓ Saved' })).toBeDisabled();
  await page.getByRole('button', { name: 'Edit score' }).click();
  const first = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await first.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('4');
  await page.getByRole('button', { name: '＋ New score' }).click();
  await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('unsaved-navigation.png') });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: '＋ New score' })).toBeFocused();
  await expect(page.getByTestId('notation').locator('svg text').filter({ hasText: /^4$/ })).toHaveCount(1);
  await page.getByRole('button', { name: '＋ New score' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toHaveCount(0);
  await expect(page.getByText('Not saved to library')).toBeVisible();
  expect((saved as Record<string, any> | null)?.measures[0].beats[0].notes[0].fret).toBe(4);
  expect(revision).toBe(1);
});

test('ED-08 rejects a stale save and reloads only after discard confirmation', async ({ page }, testInfo) => {
  let saved: Record<string, any> | null = null;
  let saves = 0;
  await page.route('**/api/songs/1', route => {
    if (route.request().method() === 'PATCH') {
      saves++;
      return route.fulfill({ status: 409, json: { error: 'Changed in another tab. Reopen the score before saving.' } });
    }
    return route.fulfill({ json: { id: 1, title: saved?.title, score: saved, source_text: null, revision: 2 } });
  });
  await page.route('**/api/songs', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    saved = route.request().postDataJSON().score;
    return route.fulfill({ status: 201, json: { id: 1, title: saved?.title, revision: 1 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await page.getByRole('button', { name: 'Edit score' }).click();
  const first = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await first.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('4');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Score changed in another tab' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('revision-conflict.png') });
  await page.getByRole('button', { name: 'Reload saved version…' }).click();
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('notation').locator('svg text').filter({ hasText: /^4$/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Resolve conflict…' }).click();
  await page.getByRole('button', { name: 'Reload saved version…' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('button', { name: '✓ Saved' })).toBeDisabled();
  await expect(page.getByTestId('notation').locator('svg text').filter({ hasText: /^4$/ })).toHaveCount(0);
  expect(saves).toBe(1);
});

test('ED-08 can keep a conflicted draft as a new copy without overwriting the original', async ({ page }) => {
  let original: Record<string, any> | null = null;
  let copy: Record<string, any> | null = null;
  let postCount = 0;
  await page.route('**/api/songs/1', route => route.fulfill({ status: 409, json: { error: 'Changed in another tab.' } }));
  await page.route('**/api/songs', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    const document = route.request().postDataJSON().score;
    postCount++;
    if (postCount === 1) original = document;
    else copy = document;
    return route.fulfill({ status: 201, json: { id: postCount, title: document.title, revision: 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Save to library' }).click();
  await page.getByRole('button', { name: 'Edit score' }).click();
  const first = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await first.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('4');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Score changed in another tab' })).toBeVisible();
  await page.getByRole('button', { name: 'Save as copy…' }).click();
  await expect(page.getByRole('dialog', { name: 'Save a copy' })).toBeVisible();
  await page.getByLabel('Copy title').fill('Conflict copy');
  await page.getByRole('button', { name: 'Save copy' }).click();
  await expect(page.getByRole('heading', { name: 'Conflict copy' })).toBeVisible();
  expect((original as Record<string, any> | null)?.measures[0].beats[0].notes[0].fret).toBe(0);
  expect((copy as Record<string, any> | null)?.measures[0].beats[0].notes[0].fret).toBe(4);
  expect(postCount).toBe(2);
});
