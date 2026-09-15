import { expect, test } from '@playwright/test';
import fs from 'node:fs';

test('renders H and PO on technique slurs and retains them after resize and printing', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/techniques.musicxml');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg text').filter({ hasText: /^H$/ })).toHaveCount(1);
  await expect(notation.locator('svg text').filter({ hasText: /^PO$/ })).toHaveCount(1);
  await expect(notation.locator('svg text').filter({ hasText: /^sl\.?$/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 60000 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 1000 });
  await expect(notation.locator('svg text').filter({ hasText: /^PO$/ })).toHaveCount(1);
  await page.screenshot({ path: 'tmp/techniques.png', fullPage: true });
  await context.addInitScript(() => { window.print = () => {}; });
  const popup = page.waitForEvent('popup');
  await page.getByLabel('Export score').selectOption('pdf');
  const printPreview = await popup;
  await expect(printPreview.locator('svg text').filter({ hasText: /^H$/ })).toHaveCount(1);
  await expect(printPreview.locator('svg text').filter({ hasText: /^PO$/ })).toHaveCount(1);
  await printPreview.close();
  expect(errors).toEqual([]);
});

test('renders a native thumb fingering below the tablature staff', async ({ page }) => {
  const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8')
    .replace('<fret>0</fret><hammer-on type="start">H</hammer-on>', '<fret>0</fret><other-technical>TEF fingering T</other-technical><hammer-on type="start">H</hammer-on>')
    .replace('<hammer-on type="stop"/></technical></notations></note>\n    <note>', '<hammer-on type="stop"/></technical></notations></note>\n    <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><notations><technical><string>5</string><fret>0</fret></technical></notations></note>\n    <note>');
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'thumb.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  const readThumbPosition = () => page.getByTestId('notation').locator('svg text').evaluateAll(nodes => {
    const glyph = nodes.find(node => node.textContent === 'T');
    const fretYs = nodes.filter(node => /^\d+$/.test(node.textContent ?? ''))
      .map(node => Number(node.getAttribute('y')))
      .filter(Number.isFinite);
    const directY = glyph?.getAttribute('y');
    const match = glyph?.parentElement?.getAttribute('transform')?.match(/translate\([^ ]+ ([^)]+)\)/);
    const glyphY = directY ? Number(directY) : match ? Number(match[1]) : NaN;
    return Number.isFinite(glyphY) && fretYs.length ? { glyphY, bottomFretY: Math.max(...fretYs) } : null;
  });
  await expect.poll(async () => (await readThumbPosition())?.glyphY ?? -1).toBeGreaterThan(0);
  const position = await readThumbPosition();
  expect(position?.glyphY).toBeGreaterThan(position?.bottomFretY ?? Number.POSITIVE_INFINITY);
});
