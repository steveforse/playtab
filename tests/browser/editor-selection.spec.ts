import { expect, test } from '@playwright/test';
import fs from 'node:fs';

test('ED-02 selects a rendered note and keeps its identity through layout changes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();

  const inspector = page.getByLabel('Selection inspector');
  const note = page.getByTestId('notation').locator('svg text').filter({ hasText: /^[0-9]+$/ }).first();
  const noteBox = await note.boundingBox();
  expect(noteBox).not.toBeNull();
  await page.mouse.click(noteBox!.x + noteBox!.width / 2, noteBox!.y + noteBox!.height / 2);
  await expect(inspector).toContainText('Measure 1');
  await expect(inspector).toContainText('Event 1');
  await expect(inspector).toContainText('String 3');
  await expect(inspector).toContainText('Fret 0');
  await expect(page.locator('.editor-note-selection')).toHaveCount(1);

  await page.getByTestId('notation').focus();
  await page.getByTestId('notation').press('ArrowRight');
  await expect(inspector).toContainText('Event 2');

  await page.getByLabel('Selection measure').selectOption('2');
  await expect(inspector).toContainText('Measure 2');
  await page.getByLabel('Selection event').selectOption('1');
  await expect(inspector).toContainText('Event 1');

  await page.getByLabel('Score view', { exact: true }).selectOption('a4-portrait');
  await expect(page.locator('.score-paper')).toHaveClass(/score-paper-paginated/);
  await expect(inspector).toContainText('Measure 2');
  await expect(page.locator('.editor-note-selection')).toHaveCount(1);
  await page.getByLabel('Measures per line', { exact: true }).selectOption('2');
  await expect(inspector).toContainText('Measure 2');
  await page.getByLabel('Scroll direction', { exact: true }).selectOption('horizontal');
  await expect(inspector).toContainText('Measure 2');

  await page.setViewportSize({ width: 790, height: 1050 });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await expect(inspector).toContainText('Measure 2');
});

test('ED-02 edits and deletes the selected fret with keyboard input', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();

  const inspector = page.getByLabel('Selection inspector');
  const note = page.getByTestId('notation').locator('svg text').filter({ hasText: /^[0-9]+$/ }).first();
  const noteBox = await note.boundingBox();
  expect(noteBox).not.toBeNull();
  await page.mouse.click(noteBox!.x + noteBox!.width / 2, noteBox!.y + noteBox!.height / 2);
  const notation = page.getByTestId('notation');
  await page.keyboard.press('1');
  // A redraw can return focus to the document body; the selected target
  // should remain keyboard-editable without another score click.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('2');
  await expect(inspector).toContainText('Fret 12');

  await page.keyboard.press('Backspace');
  await expect(inspector).not.toContainText('Fret 12');
});

test('editing a fret keeps the rendered score and page position in place', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  const bars = Array.from({ length: 20 }, () => '0-0-0-0-0-0-0-0').join('|');
  const text = ['D', 'B', 'G', 'D', 'g'].map(label => `${label}|${bars}|`).join('\n');
  await page.getByLabel('Plaintext tablature').fill(text);
  await page.getByRole('button', { name: 'Open in player' }).click();
  const notation = page.getByTestId('notation');
  const fret = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(fret).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const box = (await fret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const before = await page.evaluate(() => {
    window.scrollTo(0, 600);
    const surface = document.querySelector('.at-surface');
    const initial = { y: window.scrollY, height: document.documentElement.scrollHeight };
    const trace = { minY: initial.y, minHeight: initial.height, surface };
    const sample = () => {
      trace.minY = Math.min(trace.minY, window.scrollY);
      trace.minHeight = Math.min(trace.minHeight, document.documentElement.scrollHeight);
    };
    window.addEventListener('scroll', sample, { passive: true });
    new MutationObserver(sample).observe(document.querySelector('[data-testid="notation"]')!, { childList: true, subtree: true });
    (window as typeof window & { __editScrollTrace?: typeof trace }).__editScrollTrace = trace;
    return initial;
  });
  expect(before.y).toBeGreaterThan(0);
  await page.keyboard.press('1');
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 1');
  await expect(notation.locator('svg text').filter({ hasText: /^1$/ }).first()).toBeVisible();
  const after = await page.evaluate(() => {
    const trace = (window as typeof window & { __editScrollTrace?: { minY: number; minHeight: number; surface: Element | null } }).__editScrollTrace!;
    return { minY: trace.minY, minHeight: trace.minHeight, sameSurface: trace.surface === document.querySelector('.at-surface') };
  });
  expect(after.sameSurface).toBe(true);
  expect(after.minHeight).toBeGreaterThanOrEqual(before.height - 20);
  expect(after.minY).toBeGreaterThanOrEqual(before.y - 20);
});

test('ED-02 selects an unoccupied staff string in the same beat', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();

  const inspector = page.getByLabel('Selection inspector');
  const note = page.getByTestId('notation').locator('svg text').filter({ hasText: /^[0-9]+$/ }).first();
  const box = await note.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + 18);
  await expect(inspector).toContainText('Measure 1');
  await expect(inspector).toContainText('Event 1');
  await expect(inspector).toContainText(/String [1245]/);
  await expect(inspector).not.toContainText('String 3');
  const caret = (await page.locator('.editor-note-selection').boundingBox())!;
  expect(caret.width).toBeGreaterThan(8);
  expect(caret.width).toBeLessThanOrEqual(20);
  expect(caret.height).toBeLessThanOrEqual(18);
  expect(Math.abs(caret.y + caret.height / 2 - (box!.y + 18))).toBeLessThan(12);
});

test('ED-02 edits and deletes an existing imported note', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8')
    .replace('<hammer-on type="start">', '<fingering>3</fingering><hammer-on type="start">');
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'stacked.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();

  const inspector = page.getByLabel('Selection inspector');
  // The hammer-on destination (fret 3) can become fret 12 and keep its span
  // valid; editing the origin to 12 would be rejected until the span is removed.
  const note = page.getByTestId('notation').locator('svg text').filter({ hasText: /^3$/ }).first();
  const noteBox = await note.boundingBox();
  expect(noteBox).not.toBeNull();
  await page.mouse.click(noteBox!.x + noteBox!.width / 2, noteBox!.y + noteBox!.height / 2);
  await page.keyboard.press('1');
  await page.keyboard.press('2');
  await expect(inspector).toContainText('Fret 12');
  await expect(page.getByTestId('notation').locator('svg text').filter({ hasText: /^12$/ })).toHaveCount(1);
  await page.keyboard.press('Backspace');
  const confirm = page.getByRole('dialog', { name: 'Confirm note removal' });
  await expect(confirm).toContainText('hammer-on');
  await confirm.getByRole('button', { name: 'Remove note' }).click();
  await expect(inspector).not.toContainText('Fret 12');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('edits a private multi-row import through direct pointer and keyboard input', async ({ page }) => {
  test.skip(!process.env.PLAYTAB_EDITOR_XML, 'Optional private score; never checked in.');
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles(process.env.PLAYTAB_EDITOR_XML!);
  const frets = page.getByTestId('notation').locator('svg text').filter({ hasText: /^[0-9]+$/ });
  await expect(frets.first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score' }).click();
  const box = (await frets.first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('7');
  await expect(frets.first()).toHaveText('7');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Delete');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.editor-selection-summary')).not.toContainText('Fret 7');
});

test('edits paired notation in a saved TEF library document and reopens the correction', async ({ page }) => {
  let revision = 0;
  let saved = {
    version: 2, kind: 'musicxml', title: 'Paired staff exercise', sourceFormat: 'tef',
    sourceName: 'paired.tef', source: fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8'), warnings: [],
  };
  await page.route('**/api/songs', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [{ id: 42, title: saved.title }] });
    } else {
      saved = route.request().postDataJSON().score;
      await route.fulfill({ json: { id: 42, title: saved.title } });
    }
  });
  await page.route('**/api/songs/42', route => {
    if (route.request().method() === 'PATCH') {
      saved = route.request().postDataJSON().score;
      revision++;
      return route.fulfill({ json: { id: 42, title: saved.title, revision } });
    }
    return route.fulfill({ json: { id: 42, title: saved.title, score: saved, source_text: null, revision } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Paired staff exercise', exact: true }).click();
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const note = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await note.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('7');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('notation').locator('svg text').filter({ hasText: /^7$/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Paired staff exercise', exact: true }).click();
  await expect(page.getByTestId('notation').locator('svg text').filter({ hasText: /^7$/ })).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(saved.sourceFormat).toBe('tef');
});
