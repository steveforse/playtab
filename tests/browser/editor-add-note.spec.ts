import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

test('adds an imported chord tone and rest note on paired staves with an aligned empty caret', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/paired-staff.musicxml');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const firstFret = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const noteBox = (await firstFret.boundingBox())!;
  await page.mouse.click(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2);
  const inspector = page.getByLabel('Selection inspector');
  await expect(inspector).toContainText('String 1');
  await notation.focus();
  await notation.press('ArrowDown');
  await expect(inspector).toContainText('String 2');
  const caret = (await page.locator('.editor-note-selection').boundingBox())!;
  const currentNoteBox = (await firstFret.boundingBox())!;
  expect(caret.width).toBeGreaterThan(8);
  expect(Math.abs(caret.x + caret.width / 2 - currentNoteBox.x - currentNoteBox.width / 2)).toBeLessThan(3);

  await page.getByLabel('Fret').fill('1');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(inspector).toContainText('Fret 1');
  await expect(notation.locator('svg text').filter({ hasText: /^1$/ })).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await notation.focus();
  await notation.press('ArrowRight');
  await notation.press('ArrowRight');
  await expect(inspector).toContainText('Event 3');
  await page.getByLabel('Fret').fill('0');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(inspector).toContainText('Fret 0');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('clicking an empty string and entering a two-digit fret stays aligned at 200% zoom', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/paired-staff.musicxml');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  await page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
  await page.waitForTimeout(500);
  const firstFret = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  await firstFret.scrollIntoViewIfNeeded();
  const first = (await firstFret.boundingBox())!;
  const second = (await notation.locator('svg text').filter({ hasText: /^0$/ }).nth(1).boundingBox())!;
  const x = first.x + first.width / 2;
  const y = (first.y + first.height / 2 + second.y + second.height / 2) / 2;
  await page.mouse.click(x, y);
  const inspector = page.getByLabel('Selection inspector');
  await expect(inspector.locator('.editor-selection-summary')).toContainText('String 2');
  await expect(page.getByRole('button', { name: 'Add note' })).toBeVisible();
  const emptyCaret = (await page.locator('.editor-note-selection').boundingBox())!;
  expect(emptyCaret.width).toBeGreaterThan(16);
  expect(emptyCaret.width).toBeLessThan(40);
  const currentFirst = (await firstFret.boundingBox())!;
  expect(Math.abs(emptyCaret.x + emptyCaret.width / 2 - currentFirst.x - currentFirst.width / 2)).toBeLessThan(6);
  await page.screenshot({ path: testInfo.outputPath('empty-string-position.png') });
  await notation.press('1');
  await notation.press('2');
  await expect(inspector.locator('.editor-selection-summary')).toContainText('Fret 12');
  await expect(inspector.locator('.editor-selection-summary')).toContainText('String 2');
  const marker = page.locator('.editor-note-selection');
  const addedGlyph = notation.locator('svg text').filter({ hasText: /^12$/ }).first();
  await expect(marker).toBeVisible();
  await expect(addedGlyph).toBeVisible();
  const measureAlignment = async () => {
    const noteMarker = (await marker.boundingBox())!;
    const added = (await addedGlyph.boundingBox())!;
    return { leftGap: added.x - noteMarker.x, rightGap: noteMarker.x + noteMarker.width - added.x - added.width,
      yCenterGap: Math.abs((noteMarker.y + noteMarker.height / 2) - (added.y + added.height / 2)) };
  };
  // alphaTab can publish the new glyph before its renderFinished overlay pass.
  await expect.poll(async () => (await measureAlignment()).yCenterGap).toBeLessThan(6);
  const alignment = await measureAlignment();
  expect(alignment.leftGap).toBeGreaterThan(0);
  expect(alignment.rightGap).toBeGreaterThan(0);
  expect(alignment.yCenterGap).toBeLessThan(6);
  await page.screenshot({ path: testInfo.outputPath('two-digit-fret.png') });
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('saves an added note to a TEF imported library score and reopens it', async ({ page }) => {
  let revision = 0;
  let saved = {
    version: 2, kind: 'musicxml', title: 'Paired staff exercise', sourceFormat: 'tef',
    sourceName: 'paired.tef', source: fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8'), warnings: [],
  };
  await page.route('**/api/songs', async route => {
    if (route.request().method() === 'GET') await route.fulfill({ json: [{ id: 42, title: saved.title }] });
    else {
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
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const firstFret = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await firstFret.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await notation.focus();
  await notation.press('ArrowDown');
  await page.getByLabel('Fret').fill('1');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(notation.locator('svg text').filter({ hasText: /^1$/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Paired staff exercise', exact: true }).click();
  await expect(notation.locator('svg text').filter({ hasText: /^1$/ })).toHaveCount(1);
  expect(saved.sourceFormat).toBe('tef');
});

test('new fret stays on its selected string in a private imported score', async ({ page }) => {
  test.skip(!process.env.PLAYTAB_EDITOR_XML, 'Optional private score; never checked in.');
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles(process.env.PLAYTAB_EDITOR_XML!);
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const bottomIndex = await page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll('[data-testid="notation"] svg text'));
    const zeros = texts.filter(item => item.textContent === '0');
    const group = zeros.find(item => zeros.filter(other => Math.abs(other.getBoundingClientRect().x - item.getBoundingClientRect().x) < 1
      && Math.abs(other.getBoundingClientRect().y - item.getBoundingClientRect().y) < 70).length >= 3);
    if (!group) return -1;
    const row = zeros.filter(item => Math.abs(item.getBoundingClientRect().x - group.getBoundingClientRect().x) < 1
      && Math.abs(item.getBoundingClientRect().y - group.getBoundingClientRect().y) < 35)
      .sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y)[2];
    return texts.indexOf(row);
  });
  expect(bottomIndex).toBeGreaterThanOrEqual(0);
  const bottom = notation.locator('svg text').nth(bottomIndex);
  await bottom.scrollIntoViewIfNeeded();
  const bottomBox = (await bottom.boundingBox())!;
  await page.mouse.click(bottomBox.x + bottomBox.width / 2, bottomBox.y + bottomBox.height / 2 + 14.3);
  await expect(page.getByLabel('Selection inspector')).toContainText('String 4');
  await expect(page.getByRole('button', { name: 'Add note' })).toBeVisible();
  const snapshot = () => page.evaluate(() => {
    const box = document.querySelector('.editor-note-selection')!.getBoundingClientRect();
    const notes = Array.from(document.querySelectorAll('[data-testid="notation"] svg text'))
      .filter(item => /^\d+$/.test(item.textContent || ''));
    const anchor = notes.find(item => item.textContent === '0' && Math.abs(item.getBoundingClientRect().x - box.x) < 15)!.getBoundingClientRect();
    const added = notes.find(item => item.textContent === '12' && Math.abs(item.getBoundingClientRect().x - box.x) < 15)?.getBoundingClientRect();
    return { caretFromAnchor: box.y - anchor.y, addedFromAnchor: added ? added.y - anchor.y : null };
  });
  const before = await snapshot();
  await notation.press('1');
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 1');
  await expect(page.getByLabel('Selection inspector')).toContainText('String 4');
  await notation.press('2');
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 12');
  await expect(page.getByLabel('Selection inspector')).toContainText('String 4');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(notation.locator('svg text').filter({ hasText: /^12$/ })).toHaveCount(1);
  const after = await snapshot();
  expect(Math.abs(after.caretFromAnchor - before.caretFromAnchor)).toBeLessThan(5);
  expect(Math.abs(after.addedFromAnchor! - before.caretFromAnchor)).toBeLessThan(5);
});

test('two digit insertion keeps the selected string in the saved Wellerman', async ({ page }) => {
  test.skip(!process.env.PLAYTAB_STORED_WELLERMAN, 'Optional local library score; no private music is checked in.');
  const saved = JSON.parse(execFileSync('docker', ['compose', '-f', 'compose.yml', 'exec', '-T', 'web', 'bin/rails', 'runner',
    'print Song.where("title ILIKE ?", "%Wellerman%").first.score.to_json'], { encoding: 'utf8' }));
  await page.route('**/api/songs', route => route.fulfill({ json: [{ id: 42, title: saved.title }] }));
  await page.route('**/api/songs/42', route => route.fulfill({ json: { id: 42, title: saved.title, score: saved, source_text: null } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'The Wellerman', exact: true }).click();
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  if (process.env.PLAYTAB_ZOOM) await page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
  const targetPosition = await page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll('[data-testid="notation"] svg text'));
    const zeros = texts.filter(item => item.textContent === '0');
    const group = zeros.find(item => zeros.filter(other => Math.abs(other.getBoundingClientRect().x - item.getBoundingClientRect().x) < 1
      && Math.abs(other.getBoundingClientRect().y - item.getBoundingClientRect().y) < 70).length >= 3);
    if (!group) return null;
    const rows = zeros.filter(item => Math.abs(item.getBoundingClientRect().x - group.getBoundingClientRect().x) < 1
      && Math.abs(item.getBoundingClientRect().y - group.getBoundingClientRect().y) < 70)
      .sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y);
    return { index: texts.indexOf(rows[2]), spacing: rows[2].getBoundingClientRect().y - rows[1].getBoundingClientRect().y };
  });
  expect(targetPosition).not.toBeNull();
  const target = notation.locator('svg text').nth(targetPosition!.index);
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + targetPosition!.spacing * 2);
  await expect(page.getByLabel('Selection inspector')).toContainText('Measure 2');
  await expect(page.getByLabel('Selection inspector')).toContainText('String 5');
  await expect(page.getByRole('button', { name: 'Add note' })).toBeVisible();
  await notation.press('1');
  await notation.press('2');
  await expect(page.getByLabel('Selection inspector')).toContainText('String 5');
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 12');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('captures a two-digit edit inside the saved Wellerman zero chord', async ({ page }, testInfo) => {
  test.skip(!process.env.PLAYTAB_STORED_WELLERMAN, 'Optional local library score; no private music is checked in.');
  const saved = JSON.parse(execFileSync('docker', ['compose', '-f', 'compose.yml', 'exec', '-T', 'web', 'bin/rails', 'runner',
    'print Song.where("title ILIKE ?", "%Wellerman%").first.score.to_json'], { encoding: 'utf8' }));
  await page.route('**/api/songs', route => route.fulfill({ json: [{ id: 42, title: saved.title }] }));
  await page.route('**/api/songs/42', route => route.fulfill({ json: { id: 42, title: saved.title, score: saved, source_text: null } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'The Wellerman', exact: true }).click();
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg').first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const indices = await page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll('[data-testid="notation"] svg text'));
    const zeros = texts.filter(item => item.textContent === '0');
    const top = zeros.find(item => zeros.filter(other => Math.abs(other.getBoundingClientRect().x - item.getBoundingClientRect().x) < 1
      && other.getBoundingClientRect().y >= item.getBoundingClientRect().y
      && other.getBoundingClientRect().y - item.getBoundingClientRect().y < 70).length >= 3);
    if (!top) return null;
    return zeros.filter(item => Math.abs(item.getBoundingClientRect().x - top.getBoundingClientRect().x) < 1
      && item.getBoundingClientRect().y >= top.getBoundingClientRect().y
      && item.getBoundingClientRect().y - top.getBoundingClientRect().y < 70)
      .sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y)
      .slice(0, 3).map(item => texts.indexOf(item));
  });
  expect(indices).toHaveLength(3);
  const middle = notation.locator('svg text').nth(indices![1]);
  await middle.scrollIntoViewIfNeeded();
  const box = (await middle.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.editor-note-selection').scrollIntoViewIfNeeded();
  const markerGap = (value: string) => page.evaluate(value => {
    const marker = document.querySelector('.editor-note-selection')!.getBoundingClientRect();
    const glyph = Array.from(document.querySelectorAll('[data-testid="notation"] svg text'))
      .filter(item => item.textContent === value)
      .map(item => item.getBoundingClientRect())
      .filter(rect => Math.abs(rect.x - marker.x) < 30)
      .sort((a, b) => Math.abs((a.y + a.height / 2) - (marker.y + marker.height / 2))
        - Math.abs((b.y + b.height / 2) - (marker.y + marker.height / 2)))[0];
    return { left: glyph.left - marker.left, right: marker.right - glyph.right,
      y: Math.abs((glyph.y + glyph.height / 2) - (marker.y + marker.height / 2)) };
  }, value);
  const zeroGap = await markerGap('0');
  expect(zeroGap.left).toBeGreaterThan(0);
  expect(zeroGap.right).toBeGreaterThan(0);
  expect(zeroGap.y).toBeLessThan(3);
  const zeroSelection = (await page.locator('.editor-note-selection').boundingBox())!;
  await page.screenshot({ path: testInfo.outputPath('wellerman-zero-selected-detail.png'), clip: {
    x: Math.max(0, zeroSelection.x - 40), y: Math.max(0, zeroSelection.y - 55), width: 140, height: 150,
  } });
  await notation.press('1');
  await notation.press('2');
  await expect(page.getByLabel('Selection inspector').locator('.editor-selection-summary')).toContainText('Fret 12');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.locator('.editor-note-selection').scrollIntoViewIfNeeded();
  const twelveGap = await markerGap('12');
  expect(twelveGap.left).toBeGreaterThan(0);
  expect(twelveGap.right).toBeGreaterThan(0);
  expect(twelveGap.y).toBeLessThan(3);
  const selected = (await page.locator('.editor-note-selection').boundingBox())!;
  const clip = { x: Math.max(0, selected.x - 40), y: Math.max(0, selected.y - 55), width: 140, height: 150 };
  await page.screenshot({ path: testInfo.outputPath('wellerman-zero-to-12-detail.png'), clip });
  await notation.press('ArrowDown');
  await expect(page.getByLabel('Selection inspector').locator('.editor-selection-summary')).toContainText('String 3');
  const adjacentZeroGap = await markerGap('0');
  expect(adjacentZeroGap.left).toBeGreaterThan(0);
  expect(adjacentZeroGap.right).toBeGreaterThan(0);
  expect(adjacentZeroGap.y).toBeLessThan(3);
  const adjacentZero = (await page.locator('.editor-note-selection').boundingBox())!;
  await page.screenshot({ path: testInfo.outputPath('wellerman-zero-after-12-detail.png'), clip: {
    x: Math.max(0, adjacentZero.x - 40), y: Math.max(0, adjacentZero.y - 55), width: 140, height: 150,
  } });
  await notation.press('ArrowDown');
  await expect(page.getByLabel('Selection inspector').locator('.editor-selection-summary')).toContainText('String 4');
  await expect(page.getByRole('button', { name: 'Add note' })).toBeVisible();
  await page.locator('.editor-note-selection').scrollIntoViewIfNeeded();
  const empty = (await page.locator('.editor-note-selection').boundingBox())!;
  await page.screenshot({ path: testInfo.outputPath('wellerman-empty-detail.png'), clip: {
    x: Math.max(0, empty.x - 40), y: Math.max(0, empty.y - 55), width: 140, height: 150,
  } });
  const emptyAlignment = await page.evaluate(() => {
    const caret = document.querySelector('.editor-note-selection')!.getBoundingClientRect();
    const notes = Array.from(document.querySelectorAll('[data-testid="notation"] svg text'))
      .filter(item => ['0', '12'].includes(item.textContent || ''))
      .filter(item => Math.abs(item.getBoundingClientRect().y - caret.y) < 45 && Math.abs(item.getBoundingClientRect().x - caret.x) < 20);
    const above = notes.find(item => item.textContent === '12')!.getBoundingClientRect();
    return Math.abs((caret.x + caret.width / 2) - (above.x + above.width / 2));
  });
  expect(emptyAlignment).toBeLessThan(3);
});
