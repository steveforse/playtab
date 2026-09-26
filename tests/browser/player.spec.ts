import { expect, test } from '@playwright/test';

async function exportAs(page: import('@playwright/test').Page, format: string) {
  const dialog = page.locator('.export-dialog');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Export format').selectOption(format);
  await dialog.getByRole('button', { name: 'Export file', exact: true }).click();
}

test('renders and plays a banjo score, imports text and exports', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'An open-G kind of morning' })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss practice tip' }).click();
  await expect(page.getByRole('note', { name: 'Practice tip' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss playback tips' }).click();
  await expect(page.getByRole('note', { name: 'Playback tips' })).toHaveCount(0);
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 45000 });
  await page.getByLabel('Score view', { exact: true }).selectOption('a4-portrait');
  await expect(page.locator('.score-paper')).toHaveClass(/score-paper-a4-portrait/);
  await expect(page.locator('.score-paper')).toHaveClass(/score-paper-paginated/);
  await expect(page.locator('.score-page')).toHaveCount(1);
  await page.getByLabel('Score view', { exact: true }).selectOption('letter-portrait');
  const verticalPortraitWidth = await page.locator('.score-paper').evaluate(element => element.getBoundingClientRect().width);
  await page.getByLabel('Scroll direction', { exact: true }).selectOption('horizontal');
  await expect(page.locator('.score-paper')).toHaveClass(/score-paper-horizontal/);
  await expect(page.locator('.score-page')).toHaveCount(1);
  const horizontalPortraitWidth = await page.locator('.score-paper').evaluate(element => element.getBoundingClientRect().width);
  expect(Math.abs(horizontalPortraitWidth - verticalPortraitWidth)).toBeLessThan(1);
  const horizontalPageLeft = await page.locator('.score-page').evaluate(element => element.getBoundingClientRect().left);
  const viewportLeft = await page.locator('.score-viewport').evaluate(element => element.getBoundingClientRect().left);
  expect(Math.abs(horizontalPageLeft - viewportLeft)).toBeLessThan(1);
  await page.getByLabel('Score view', { exact: true }).selectOption('a4-portrait');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Browser verification tab');
  await page.getByRole('button', { name: 'Open in player' }).click();
  await expect(page.getByRole('heading', { name: 'Browser verification tab' })).toBeVisible();
  await expect(page.getByLabel('Score view', { exact: true })).toHaveValue('a4-portrait');
  await expect(page.getByLabel('Scroll direction', { exact: true })).toHaveValue('horizontal');
  await page.getByLabel('Score view', { exact: true }).selectOption('continuous');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(page.locator('.player-status span')).toContainText('0:01 /', { timeout: 10000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Loop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Loop', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Rhythm assumed/)).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss import warnings' }).click();
  await expect(page.getByRole('note', { name: 'Import warnings' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  const download = page.waitForEvent('download');
  await exportAs(page, 'json');
  expect((await download).suggestedFilename()).toBe('Browser verification tab.playtab.json');
  const tefDownload = page.waitForEvent('download');
  await exportAs(page, 'tef2');
  expect((await tefDownload).suggestedFilename()).toBe('Browser-verification-tab.tef');
  await page.screenshot({ path: 'tmp/playtab-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('unsupported uploads give an honest message and mobile layout fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('PDF') });
  await expect(page.getByRole('alert')).toContainText('This file is not a PDF.');
  await page.getByRole('button', { name: 'Close import' }).click();
  // On a phone the score starts below the fold and renders once scrolled to.
  await page.getByTestId('notation').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('notation').locator('svg').first()).toBeVisible({ timeout: 45000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'tmp/playtab-mobile.png', fullPage: true });
});

test('keeps paginated rows and selection coordinates aligned', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  const bar = '0-0-0-0-0-0-0-0';
  const bars = Array.from({ length: 40 }, () => bar).join('|');
  const text = ['D', 'B', 'G', 'D', 'g'].map(label => `${label}|${bars}|`).join('\n');
  await page.getByLabel('Title', { exact: true }).fill('Paginated interaction regression');
  await page.getByLabel('Plaintext tablature').fill(text);
  await page.getByRole('button', { name: 'Open in player' }).click();
  await page.getByLabel('Score view', { exact: true }).selectOption('a4-portrait');
  await page.locator('.score-page').nth(1).waitFor({ state: 'visible', timeout: 45000 });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 45000 });

  const rowLayouts = await page.locator('.score-page').evaluateAll(pages => pages.map(page => Array.from(page.children).map(system => {
    const element = system as HTMLElement;
    return { top: Number.parseFloat(element.style.top), height: Number.parseFloat(element.style.height) };
  })));
  for (const rows of rowLayouts) {
    for (let index = 1; index < rows.length; index++) expect(rows[index].top).toBeGreaterThanOrEqual(rows[index - 1].top + rows[index - 1].height - 0.1);
  }

  const secondPage = page.locator('.score-page').nth(1);
  const secondSystem = secondPage.locator(':scope > div').first();
  await secondSystem.scrollIntoViewIfNeeded();
  const systemBox = await secondSystem.boundingBox();
  if (!systemBox) throw new Error('Second-page system is not visible.');
  await page.mouse.move(systemBox.x + 100, systemBox.y + 45);
  await page.mouse.down();
  await page.mouse.move(systemBox.x + 350, systemBox.y + 45);
  await page.mouse.up();

  const selection = page.locator('.at-selection > *');
  await expect(selection).toHaveCount(1);
  const selectionBox = await selection.boundingBox();
  const pageBox = await secondPage.boundingBox();
  if (!selectionBox || !pageBox) throw new Error('Selection or second page is not visible.');
  expect(selectionBox.y).toBeGreaterThanOrEqual(pageBox.y);
  expect(selectionBox.y + selectionBox.height).toBeLessThanOrEqual(pageBox.y + pageBox.height);
});

test('continuous horizontal playback scrolls its viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  const bar = '0-0-0-0-0-0-0-0';
  const bars = Array.from({ length: 40 }, () => bar).join('|');
  const text = ['D', 'B', 'G', 'D', 'g'].map(label => `${label}|${bars}|`).join('\n');
  await page.getByLabel('Title', { exact: true }).fill('Continuous scroll regression');
  await page.getByLabel('Plaintext tablature').fill(text);
  await page.getByRole('button', { name: 'Open in player' }).click();
  await page.getByLabel('Score view', { exact: true }).selectOption('continuous');
  await page.getByLabel('Scroll direction', { exact: true }).selectOption('horizontal');
  await page.getByTestId('notation').locator('svg').first().waitFor({ state: 'visible', timeout: 45000 });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 45000 });
  const viewport = page.locator('.score-viewport-horizontal');
  const before = await viewport.evaluate(element => element.scrollLeft);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.waitForTimeout(6000);
  const after = await viewport.evaluate(element => element.scrollLeft);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(after).toBeGreaterThan(before);
});
