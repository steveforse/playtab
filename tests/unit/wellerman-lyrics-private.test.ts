import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { readMusicXml } from '../../app/frontend/music/musicxml';

vi.stubGlobal('DOMParser', DOMParser);
vi.stubGlobal('XMLSerializer', XMLSerializer);

describe('private Wellerman native import', () => {
  it.skipIf(!process.env.PLAYTAB_WELLERMAN_LYRICS_XML)('loads the TEF lyric block in alphaTab', () => {
    const path = process.env.PLAYTAB_WELLERMAN_LYRICS_XML!;
    const { score, lyricsSection } = readMusicXml(fs.readFileSync(path, 'utf8'), 'Wellerman.musicxml');

    expect(score.tracks).toHaveLength(1);
    expect(lyricsSection).toContain('VERSE');
    expect(lyricsSection).toContain('There once was a ship that put to sea');
    expect(lyricsSection).toContain('Soon may the Wellerman come');
    expect(lyricsSection).not.toContain('LYRICS & CHORDS');
  });
});
