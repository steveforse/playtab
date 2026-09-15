import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const soundfontPath = resolve(process.cwd(), 'app/frontend/public/soundfont/musescore-general-lite.sf3');
const attributionPath = resolve(process.cwd(), 'app/frontend/public/soundfont/MuseScore_General_Lite.copyright');

describe('bundled audio assets', () => {
  it('packages a non-empty SF3 bank and its attribution', () => {
    const soundfont = readFileSync(soundfontPath);
    const attribution = readFileSync(attributionPath, 'utf8');

    expect(statSync(soundfontPath).size).toBeGreaterThan(30_000_000);
    expect(soundfont.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(soundfont.subarray(8, 12).toString('ascii')).toBe('sfbk');
    expect(attribution).toContain('MuseScore_General SoundFont');
    expect(attribution).toContain('MIT');
  });
});
