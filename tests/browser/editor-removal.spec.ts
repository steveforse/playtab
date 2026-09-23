import { expect, test } from '@playwright/test';
import fs from 'node:fs';

test('Remove note keeps the other chord tone; Make rest and Undo restore the event', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/paired-staff.musicxml');
  const notation = page.getByTestId('notation');
  await expect(notation.locator('svg text').filter({ hasText: /^0$/ }).first()).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const zero = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  const box = (await zero.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const inspector = page.getByLabel('Selection inspector');
  await expect(inspector).toContainText('Fret 0');
  await page.screenshot({ path: testInfo.outputPath('removal-tools.png') });
  await page.getByRole('button', { name: 'Remove note', exact: true }).click();
  await expect(inspector).not.toContainText('Fret 0');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await notation.focus();
  await notation.press('Delete');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(inspector).toContainText('Fret 0');

  await page.getByRole('button', { name: 'Make rest', exact: true }).click();
  await expect(inspector).not.toContainText('Fret 0');
  await notation.focus();
  await notation.press('Delete');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(inspector).toContainText('Fret 0');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('dependent deletion lists the technique, Cancel changes nothing, and confirmation is one undo step', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles('tests/fixtures/techniques.musicxml');
  const notation = page.getByTestId('notation');
  const zero = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(zero).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await zero.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const inspector = page.getByLabel('Selection inspector');
  await page.getByRole('button', { name: 'Make rest', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm note removal' });
  await expect(dialog).toContainText('hammer-on');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('removal-confirmation.png') });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(inspector).toContainText('Fret 0');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  await page.getByRole('button', { name: 'Make rest', exact: true }).click();
  await dialog.getByRole('button', { name: 'Make rest' }).click();
  await expect(inspector).not.toContainText('Fret 0');
  await expect(notation.locator('svg text').filter({ hasText: /^0$/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(inspector).toContainText('Fret 0');
  await expect(notation.locator('svg text').filter({ hasText: /^0$/ })).toHaveCount(2);
});

test('unknown note attachment blocks Make rest without changing history', async ({ page }) => {
  const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8')
    .replace('<hammer-on type="start">H</hammer-on>', '<tap/>')
    .replace('<hammer-on type="stop"/>', '');
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'protected.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  const notation = page.getByTestId('notation');
  const zero = notation.locator('svg text').filter({ hasText: /^0$/ }).first();
  await expect(zero).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await zero.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('button', { name: 'Make rest', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('protected tap attachment');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(page.getByLabel('Selection inspector')).toContainText('Fret 0');
});

test('Make rest confirms a grace group and Undo restores its original event', async ({ page }) => {
  const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8');
  const grace = '<note><grace slash="yes"/><pitch><step>C</step><octave>3</octave></pitch><type>16th</type><notations><technical><string>4</string><fret>0</fret></technical></notations></note>';
  const withGrace = source.replace('    <note><pitch><step>C</step><octave>3</octave></pitch>', `    ${grace}\n    <note><pitch><step>C</step><octave>3</octave></pitch>`);
  await page.goto('/');
  await page.getByRole('button', { name: '＋ Import a tab' }).click();
  await page.getByLabel('Choose tablature file').setInputFiles({ name: 'grace.musicxml', mimeType: 'application/xml', buffer: Buffer.from(withGrace) });
  const notation = page.getByTestId('notation');
  const zeros = notation.locator('svg text').filter({ hasText: /^0$/ });
  await expect(zeros).toHaveCount(3, { timeout: 45000 });
  await page.getByRole('button', { name: 'Edit score', exact: true }).click();
  const box = (await zeros.nth(1).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const inspector = page.getByLabel('Selection inspector');
  await expect(inspector).toContainText('Event 2');
  await page.getByRole('button', { name: 'Make rest', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm note removal' });
  await expect(dialog).toContainText('1 grace note');
  await dialog.getByRole('button', { name: 'Make rest' }).click();
  await expect(inspector).toContainText('Event 1');
  await expect(inspector).not.toContainText('Fret 0');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(inspector).toContainText('Event 2');
  await expect(inspector).toContainText('Fret 0');
});
