import { expect, test, type Page } from '@playwright/test';

async function openTieExercise(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/editor-tie.musicxml');
  const first = page.getByTestId('notation').locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(first).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  return first;
}
async function tap(page: Page, target: import('@playwright/test').Locator) {
  await target.scrollIntoViewIfNeeded();
  // Opening a sheet can re-lay out the score; tap only once the note is still.
  let previous = '';
  await expect.poll(async () => {
    const current = JSON.stringify(await target.boundingBox());
    const settled = current === previous;
    previous = current;
    return settled;
  }, { intervals: [150] }).toBe(true);
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('ED-23 edits on a phone through the Properties sheet and title-bar playback', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const first = await openTieExercise(page);
  const toggle = page.getByRole('button', { name: 'Properties' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await tap(page, first);
  await toggle.click();
  const sheet = page.getByRole('complementary', { name: 'Properties' });
  await expect(sheet).toBeVisible();
  const sheetBox = (await sheet.boundingBox())!;
  expect(sheetBox.height).toBeLessThanOrEqual(844 / 2 + 1);
  expect(sheetBox.y + sheetBox.height).toBeGreaterThanOrEqual(843);
  await expect(sheet.getByLabel('Selection inspector')).toContainText('Fret 0');
  await sheet.getByLabel('Fret', { exact: true }).fill('5');
  await sheet.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByTestId('notation').locator('svg text').filter({ hasText: /^5$/ })).toHaveCount(1);
  await expect(page.getByLabel('Selection inspector')).toHaveCount(1);
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled({ timeout: 45000 });
  await play.click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const target = await sheet.getByRole('button', { name: 'Close' }).boundingBox();
  expect(target!.height).toBeGreaterThanOrEqual(32);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('phone-sheet.png') });
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test('ED-23 uses a side sheet on short screens and keeps the score operable at 200% zoom', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 720, height: 525 });
  const first = await openTieExercise(page);
  await page.getByRole('button', { name: 'Properties' }).click();
  const sheet = page.getByRole('complementary', { name: 'Properties' });
  const box = (await sheet.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(301);
  expect(box.x).toBeGreaterThan(300);
  await tap(page, first);
  await expect(sheet.getByLabel('Selection inspector')).toContainText('Fret 0');
  const settings = sheet.getByRole('button', { name: 'Score settings…' });
  await settings.scrollIntoViewIfNeeded();
  await expect(settings).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('side-sheet.png') });
});

test('ED-23 keeps selection, draft, range and history when crossing the 800 px breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const first = await openTieExercise(page);
  const tools = page.getByRole('complementary', { name: 'Properties' });
  const small = await tools.locator('button:visible, select:visible, input:visible').evaluateAll(nodes => nodes
    .map(node => ({ name: node.getAttribute('aria-label') || node.textContent?.trim() || node.tagName, height: node.getBoundingClientRect().height }))
    .filter(item => item.height > 0 && item.height < 32));
  expect(small).toEqual([]);
  await tap(page, first);
  await page.keyboard.press('4');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.locator('summary', { hasText: /^Select passage$/ }).click();
  await page.getByRole('button', { name: 'Set range start' }).click();
  await page.getByLabel('Fret', { exact: true }).fill('9');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Properties' }).click();
  const sheet = page.getByRole('complementary', { name: 'Properties' });
  await expect(page.getByLabel('Selection inspector')).toHaveCount(1);
  await expect(sheet.getByLabel('Fret', { exact: true })).toHaveValue('9');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await expect(page.locator('.editor-range-summary').first()).toContainText('Measure 1');
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole('button', { name: 'Properties' })).toHaveCount(0);
  await expect(page.getByLabel('Selection inspector')).toHaveCount(1);
  await expect(page.getByLabel('Fret', { exact: true })).toHaveValue('9');
  await expect(page.getByRole('group', { name: 'Playback controls' })).toHaveCount(1);
});

test('ED-23 completes correction, audition, a technique and save with the keyboard only', async ({ page }) => {
  let saved = '';
  await page.route('**/api/songs**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    saved = route.request().postDataJSON().score.source;
    return route.fulfill({ status: 201, json: { id: 96, title: 'Tie exercise', revision: 0 } });
  });
  const source = (await import('node:fs')).readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8')
    .replace(/(<measure number="2">[\s\S]*?<step>)D(<\/step>[\s\S]*?<fret>)0(<\/fret>)/, '$1E$2' + '2$3');
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'keyboard.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg text').filter({ hasText: /^0$/ })).toHaveCount(1, { timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).focus();
  await page.keyboard.press('Enter');
  for (let index = 0; index < 120 && !(await notation.evaluate(node => node === document.activeElement)); index++) await page.keyboard.press('Tab');
  await expect(notation).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const inspector = page.getByLabel('Selection inspector');
  await expect(inspector.locator('.editor-selection-summary')).toContainText('Measure 1');
  await expect(inspector.locator('.editor-selection-summary')).toContainText('String 1');
  for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowDown');
  await expect(inspector.locator('.editor-selection-summary')).toContainText('String 4');
  await expect(inspector.locator('.editor-selection-summary')).toContainText('Fret 0');
  await expect(inspector.locator('.editor-selection-summary')).toHaveAttribute('aria-live', 'polite');
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await expect(notation.locator('svg text').filter({ hasText: /^1$/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeEnabled({ timeout: 45000 });
  await expect(notation).toBeFocused();
  await page.keyboard.press(' ');
  await expect(page.getByRole('button', { name: 'Pause', exact: true }).first()).toBeVisible({ timeout: 45000 });
  await page.keyboard.press(' ');
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible();

  // Techniques is open by default in the Properties panel.
  await expect(page.locator('details.editor-technique-tools')).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Bend…' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Bend' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Bend' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Bend…' })).toBeFocused();
  await page.getByRole('button', { name: 'Hammer-on', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Selection measure' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(inspector.locator('.editor-selection-summary')).toContainText('Measure 2');
  await page.getByRole('button', { name: 'Use selected note' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Hammer-on added between the selected notes.' })).toBeVisible();
  await expect(notation.locator('svg text').filter({ hasText: /^H$/ })).toHaveCount(1);

  await page.getByLabel('Fret', { exact: true }).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('7 ');
  await expect(notation.locator('svg text').filter({ hasText: /^7$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('2');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(saved).toContain('<hammer-on type="start">H</hammer-on>');
  expect(saved).toContain('<fret>1</fret>');
});
