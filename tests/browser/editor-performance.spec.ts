import { expect, test, type Page } from '@playwright/test';
import { longScore } from './support/long-score';

// Opt-in local measurement for ED-24 targets; CI hardware varies too much
// for these to be pass/fail gates. Run with PLAYTAB_PERF=1.
test.skip(!process.env.PLAYTAB_PERF, 'Set PLAYTAB_PERF=1 to record editor performance.');

const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

async function measure(page: Page, measures: number) {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: `perf-${measures}.musicxml`, mimeType: 'application/xml', buffer: Buffer.from(longScore(measures)) });
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg text').filter({ hasText: /^4$/ }).first()).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const selection: number[] = [];
  const edits: number[] = [];
  for (let round = 0; round < 23; round++) {
    const target = notation.locator('svg text').filter({ hasText: /^[0-4]$/ }).nth(round * 7);
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!;
    const selected = await page.evaluate(({ x, y }) => new Promise<number>(resolve => {
      const start = performance.now();
      const done = () => document.querySelector('.editor-note-selection') ? resolve(performance.now() - start) : requestAnimationFrame(done);
      document.querySelectorAll('.editor-note-selection').forEach(node => node.remove());
      document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
      document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
      document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      requestAnimationFrame(done);
    }), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await expect(page.getByLabel('Selection inspector')).toContainText('Fret');
    const fret = String(5 + (round % 4));
    const edited = await page.evaluate(expected => new Promise<number>(resolve => {
      const root = document.querySelector('[data-testid="notation"]')!;
      const before = Array.from(root.querySelectorAll('svg text')).filter(node => node.textContent === expected).length;
      const start = performance.now();
      const check = () => Array.from(root.querySelectorAll('svg text')).filter(node => node.textContent === expected).length > before
        ? resolve(performance.now() - start) : requestAnimationFrame(check);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: expected, bubbles: true, cancelable: true }));
      requestAnimationFrame(check);
    }), fret);
    if (round >= 3) { selection.push(selected); edits.push(edited); }
  }
  return { measures, selectionP95: Math.round(p95(selection)), editP95: Math.round(p95(edits)), editMax: Math.round(Math.max(...edits)), samples: edits.length };
}

test('ED-24 records selection and single-fret edit latency on 100 and 256 bars', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const results = [await measure(page, 100), await measure(page, 256)];
  await testInfo.attach('performance.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  console.log(JSON.stringify(results));
});
