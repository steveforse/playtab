import { expect, test } from '@playwright/test';

test('private Wellerman conversion renders and plays with its imported tuning', async ({ page, context }) => {
  test.skip(!process.env.PLAYTAB_TEFPREVIEW_XML, 'Set PLAYTAB_TEFPREVIEW_XML to the private converted file; never commit the arrangement.');
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles(process.env.PLAYTAB_TEFPREVIEW_XML!);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/wellerman/i);
  await expect(page.locator('.subtitle')).toContainText('g C G C E♭');
  await expect(page.locator('.subtitle')).toContainText('34 measures');
  await expect(page.getByRole('heading', { name: 'Lyrics & chords' })).toBeVisible();
  await expect(page.locator('.lyrics-section')).toContainText('There once was a ship that put to sea');
  const tabClefs = page.getByTestId('notation').locator('svg g.at');
  if (await tabClefs.count() > 0) {
    await page.getByLabel('Hide TAB labels').check();
    await expect(tabClefs).toHaveCount(0);
  }
  await expect(page.getByLabel('Measures per line')).toHaveValue('4');
  await page.getByLabel('Lyrics columns').selectOption('2');
  await expect(page.getByLabel('Measures per line')).toHaveValue('4');
  await expect(page.getByLabel('Lyrics columns')).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Preview only' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 45000 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.player-status span')).toContainText('0:01 /', { timeout: 10000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const selectable = page.getByTestId('notation').locator('svg').nth(2);
  await selectable.scrollIntoViewIfNeeded();
  const box = await selectable.boundingBox();
  if (!box) throw new Error('The notation system was not rendered.');
  await page.mouse.move(box.x + 250, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 750, box.y + 100, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => page.getByTestId('notation').locator('.at-selection > div').count()).toBeGreaterThan(0);
  if (process.env.PLAYTAB_REVIEWED_XML) {
    const finger = page.getByTestId('notation').locator('svg text').filter({ hasText: /^③$/ });
    await expect(finger).toHaveCount(2);
    await finger.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tmp/tef-spike/reviewed-fingering.png' });
  }
  const downloaded = page.waitForEvent('download');
  await page.getByLabel('Export score').selectOption('musicxml');
  expect((await downloaded).suggestedFilename()).toMatch(/^wellerman(?:-reviewed|-corrected)?\.musicxml$/i);
  await context.addInitScript(() => { window.print = () => {}; });
  const popup = page.waitForEvent('popup');
  await page.getByLabel('Export score').selectOption('pdf');
  const printPreview = await popup;
  await expect(printPreview.locator('.lyrics-section')).toContainText('There once was a ship that put to sea');
  await expect(printPreview.locator('.at-cursors')).toHaveCount(0);
  await expect(printPreview.locator('.score-paper .at-surface')).toHaveAttribute('data-print-fit', 'true');
  const printBounds = await printPreview.locator('.score-paper .at-surface').evaluate(surface => {
    const surfaceBounds = surface.getBoundingClientRect();
    const paperBounds = surface.closest('.score-paper')!.getBoundingClientRect();
    return { surfaceRight: surfaceBounds.right, paperRight: paperBounds.right };
  });
  expect(printBounds.surfaceRight).toBeLessThanOrEqual(printBounds.paperRight + 1);
  await expect(printPreview.locator('.lyrics-section pre')).toHaveCSS('column-count', '2');
  await expect(printPreview.locator('svg text').filter({ hasText: /^34\s*$/ })).toHaveCount(1);
  await printPreview.close();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'tmp/tef-spike/preview.png' });
  expect(errors).toEqual([]);
});
