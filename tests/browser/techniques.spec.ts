import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!crypto.randomUUID) Object.defineProperty(crypto, 'randomUUID', { value: () => 'browser-test-id' });
  });
});

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
    const svg = (nodes[0] as SVGTextElement | undefined)?.ownerSVGElement;
    const stemBottomYs = [...(svg?.querySelectorAll('rect') ?? [])]
      .filter(rect => rect.getAttribute('fill') === '#000000')
      .map(rect => Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')))
      .filter(Number.isFinite);
    const tieBottomYs = [...(svg?.querySelectorAll('path') ?? [])]
      .map(path => {
        const box = (path as SVGGraphicsElement).getBBox();
        return box.y + box.height;
      })
      .filter(Number.isFinite);
    const directY = glyph?.getAttribute('y');
    const match = glyph?.parentElement?.getAttribute('transform')?.match(/translate\([^ ]+ ([^)]+)\)/);
    const glyphY = directY ? Number(directY) : match ? Number(match[1]) : NaN;
    const lowerGeometryY = Math.max(...fretYs, ...stemBottomYs, ...tieBottomYs);
    return Number.isFinite(glyphY) && Number.isFinite(lowerGeometryY) ? { glyphY, lowerGeometryY } : null;
  });
  await expect.poll(async () => (await readThumbPosition())?.glyphY ?? -1).toBeGreaterThan(0);
  const position = await readThumbPosition();
  expect(position?.glyphY).toBeGreaterThan(position?.lowerGeometryY ?? Number.POSITIVE_INFINITY);
});

test('renders section words below the tablature staff', async ({ page }) => {
  const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8')
    .replace('<note><pitch', '<direction><direction-type><words>Banjo Solo</words></direction-type></direction><note><pitch');
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'section.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  const readSectionPosition = () => page.getByTestId('notation').locator('svg text').evaluateAll(nodes => {
    const label = nodes.find(node => node.textContent === 'Banjo Solo');
    const svg = (label as SVGTextElement | undefined)?.ownerSVGElement;
    const stems = [...(svg?.querySelectorAll('rect') ?? [])]
      .filter(rect => rect.getAttribute('fill') === '#000000')
      .map(rect => Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')))
      .filter(Number.isFinite);
    const labelY = Number(label?.getAttribute('y'));
    return Number.isFinite(labelY) && stems.length ? { labelY, stemBottomY: Math.max(...stems) } : null;
  });
  await expect.poll(async () => (await readSectionPosition())?.labelY ?? -1).toBeGreaterThan(0);
  const position = await readSectionPosition();
  expect((position?.labelY ?? Number.NEGATIVE_INFINITY) + 0.1).toBeGreaterThanOrEqual(position?.stemBottomY ?? Number.POSITIVE_INFINITY);
});

test('renders duration dots above technique slurs in the score and print preview', async ({ page, context }) => {
  const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8')
    .replace('<divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type>', '<divisions>4</divisions><time><beats>3</beats><beat-type>4</beat-type>')
    .replace('<duration>1</duration><type>quarter</type>', '<duration>6</duration><type>quarter</type><dot/>')
    .replaceAll('<duration>1</duration><type>quarter</type>', '<duration>2</duration><type>eighth</type>');
  const readPositions = (container: Locator) => container.locator('svg').evaluateAll(svgs => {
    const dots = svgs.flatMap(svg => [...svg.querySelectorAll('text')]
      .filter(text => text.textContent?.length === 1 && text.textContent.codePointAt(0) === 57831)
      .map(dot => ({ svg, dot })));
    const dot = dots[0]?.dot;
    const transform = dot?.parentElement?.getAttribute('transform');
    const dotY = Number(transform?.match(/translate\([^ ]+ ([^)]+)\)/)?.[1]);
    const techniqueYs = [...(dots[0]?.svg.querySelectorAll('text') ?? [])]
      .filter(text => ['H', 'PO'].includes(text.textContent ?? ''))
      .map(text => Number(text.getAttribute('y')))
      .filter(Number.isFinite);
    return dots.length && techniqueYs.length ? { dotY, techniqueYs } : null;
  });

  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'dotted-technique.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  const notation = page.getByTestId('notation');
  await expect.poll(async () => (await readPositions(notation))?.dotY ?? -1).toBeGreaterThanOrEqual(0);
  const position = await readPositions(notation);
  expect(position).not.toBeNull();
  expect(position!.dotY).toBeLessThan(Math.min(...position!.techniqueYs));

  await context.addInitScript(() => { window.print = () => {}; });
  const popup = page.waitForEvent('popup');
  await page.getByLabel('Export score').selectOption('pdf');
  const printPreview = await popup;
  await expect.poll(async () => (await readPositions(printPreview.locator('body')))?.dotY ?? -1).toBeGreaterThanOrEqual(0);
  const printPosition = await readPositions(printPreview.locator('body'));
  expect(printPosition).not.toBeNull();
  expect(printPosition!.dotY).toBeLessThan(Math.min(...printPosition!.techniqueYs));
  await printPreview.close();
});
