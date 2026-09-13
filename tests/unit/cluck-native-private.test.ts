import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { readMusicXml } from '../../app/frontend/music/musicxml';

vi.stubGlobal('DOMParser', DOMParser);
vi.stubGlobal('XMLSerializer', XMLSerializer);

describe('private Cluck Ol Hen native import', () => {
  it.skipIf(!process.env.PLAYTAB_CLUCK_XML)('loads the generated effects and fingerings in alphaTab', () => {
    const path = process.env.PLAYTAB_CLUCK_XML!;

    const { score } = readMusicXml(fs.readFileSync(path, 'utf8'), 'Cluck Ol Hen2.musicxml');
    const tab = score.tracks[0].staves[0];
    const notes = tab.bars.flatMap(bar => bar.voices.flatMap(voice => voice.beats.flatMap(beat => beat.notes)));

    expect(tab.bars).toHaveLength(16);
    expect(notes.filter(note => note.hasBend)).toHaveLength(4);
    expect(notes.filter(note => note.isHammerPullOrigin)).toHaveLength(8);
    expect(notes.filter(note => note.leftHandFinger === 1)).toHaveLength(8);
    expect(notes.filter(note => note.leftHandFinger === 2)).toHaveLength(3);
  });
});
