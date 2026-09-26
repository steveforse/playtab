import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { midi, Settings } from '@coderline/alphatab';
import { linearAuditionMidi, writtenPlaybackRange } from '../../../app/frontend/editor/audition';
import { selectionFromBeat } from '../../../app/frontend/Player';
import { createBlankMusicXml, OPEN_G_TUNING, readMusicXml } from '../../../app/frontend/music/musicxml';
import { addMusicXmlEndings, addMusicXmlGraceGroup, addMusicXmlRepeat, applyMusicXmlEdits, applyMusicXmlGraceGroup, inspectMusicXmlGraceGroup, removeMusicXmlGrace, removeMusicXmlGraceGroup, changeMusicXmlMeter, changeMusicXmlPickup, connectMusicXmlTie, deleteMusicXmlMeasure, duplicateMusicXmlMeasure, insertMusicXmlMeasure,
  inspectMusicXmlRepeatEndings, inspectMusicXmlRepeats, removeMusicXmlRepeat,
  inspectMusicXmlTie, removeMusicXmlTie,
  inspectMusicXmlMeterRange, musicXmlEditorState, addMusicXmlNote, inspectMusicXmlNoteTechniques, setMusicXmlBend, setMusicXmlHand, changeMusicXmlAnchor, inspectMusicXmlAnchor, removeMusicXmlNotes,
  inspectMusicXmlLyrics, setMusicXmlLyric, setMusicXmlStandaloneLyrics, applyMusicXmlScoreSettings, inspectMusicXmlScoreSettings,
  inspectMusicXmlTempo, setMusicXmlLocalTempo, connectMusicXmlTransition, inspectMusicXmlTransitions, removeMusicXmlTransition, copyMusicXmlMeasures, pasteMusicXmlMeasures, cutMusicXmlMeasures, changeMusicXmlDuration, insertMusicXmlBeat,
  type ChordSpelling } from '../../../app/frontend/music/musicxml-editor';

import './support';
import { rich } from './support';

describe('ED-18 timed and standalone lyrics', () => {
  const score = (source = rich) => readMusicXml(source, 'rich.musicxml').score;
  const m1e2 = { measure: 0, beat: 1, voice: 1 };
  const m1e3 = { measure: 0, beat: 2, voice: 1 };
  const lyricXml = (source: string) => Array.from(new DOMParser().parseFromString(source, 'application/xml').getElementsByTagName('lyric'))
    .map(lyric => `${lyric.getAttribute('number') || '-'}:${lyric.getElementsByTagName('syllabic')[0]?.textContent}:${lyric.getElementsByTagName('text')[0]?.textContent}`);

  it('edits one verse on the selected beat in both staves and leaves other verses alone', () => {
    expect(inspectMusicXmlLyrics(rich, score(), m1e2)).toEqual([{ verse: 1, text: 'Low', syllabic: 'single' }]);
    const second = setMusicXmlLyric(rich, score(), m1e2, 2, { text: ' High ', syllabic: 'begin' });
    expect(lyricXml(second)).toEqual(['-:single:Low', '2:begin:High', '-:single:Low', '2:begin:High']);
    const changed = setMusicXmlLyric(second, score(second), m1e2, 1, { text: 'Lo', syllabic: 'end' });
    expect(lyricXml(changed)).toEqual(['1:end:Lo', '2:begin:High', '1:end:Lo', '2:begin:High']);
    expect(inspectMusicXmlLyrics(changed, score(changed), m1e2)).toEqual([{ verse: 1, text: 'Lo', syllabic: 'end' }, { verse: 2, text: 'High', syllabic: 'begin' }]);
    const beat = score(changed).tracks[0].staves[0].bars[0].voices[1].beats[1];
    expect(beat.lyrics).toEqual(['Lo', 'High']);
    const next = setMusicXmlLyric(changed, score(changed), m1e3, 1, { text: 'down', syllabic: 'single' });
    expect(inspectMusicXmlLyrics(next, score(next), m1e3)).toEqual([{ verse: 1, text: 'down', syllabic: 'single' }]);
    expect(inspectMusicXmlLyrics(next, score(next), m1e2)).toHaveLength(2);
    const removed = setMusicXmlLyric(next, score(next), m1e2, 2, null);
    expect(lyricXml(removed)).toEqual(['1:end:Lo', '1:single:down', '1:end:Lo', '1:single:down']);
    expect(setMusicXmlLyric(removed, score(removed), m1e2, 2, null)).toBe(removed);
    expect(removed).toContain('<hammer-on type="start">H</hammer-on>');
  });

  it('requires Remove lyric for empty text and enforces limits before mutation', () => {
    expect(() => setMusicXmlLyric(rich, score(), m1e2, 1, { text: '  ', syllabic: 'single' })).toThrow('Use Remove lyric to clear a verse.');
    expect(() => setMusicXmlLyric(rich, score(), m1e2, 1, { text: 'x'.repeat(161), syllabic: 'single' })).toThrow('1–160 characters');
    expect(() => setMusicXmlLyric(rich, score(), m1e2, 9, { text: 'x', syllabic: 'single' })).toThrow('verse from 1 to 8');
    expect(() => setMusicXmlLyric(rich, score(), m1e2, 1, { text: 'x', syllabic: 'both' as 'single' })).toThrow('Single, Begin, Middle, or End');
    expect(() => inspectMusicXmlLyrics(rich, score(), { measure: 0, beat: 0, voice: 1 })).toThrow('Select an ordinary beat');
  });

  it('keeps unfamiliar lyric settings read-only', () => {
    const variants: [string, string][] = [
      ['<lyric><syllabic>single</syllabic><text>Low</text><extend/></lyric>', 'Verse 1 has an extension line; it is kept as written.'],
      ['<lyric><syllabic>single</syllabic><text>Low</text><elision/><text>er</text></lyric>', 'Verse 1 has a elision setting; it is kept as written.'],
      ['<lyric default-y="-80"><syllabic>single</syllabic><text>Low</text></lyric>', 'Verse 1 has lyric styling; it is kept as written.'],
      ['<lyric><syllabic>single</syllabic><text>Low</text></lyric><lyric number="1"><text>Again</text></lyric>', 'Verse 1 has more than one lyric on this beat; it is kept as written.'],
      ['<lyric number="chorus"><syllabic>single</syllabic><text>Low</text></lyric>', 'The lyric verse “chorus” is kept as written.'],
    ];
    for (const [lyric, reason] of variants) {
      const source = rich.replaceAll('<lyric><syllabic>single</syllabic><text>Low</text></lyric>', lyric);
      const found = inspectMusicXmlLyrics(source, score(source), m1e2);
      expect(found.map(item => item.reason)).toContain(reason);
      if (!lyric.includes('chorus')) expect(() => setMusicXmlLyric(source, score(source), m1e2, 1, { text: 'x', syllabic: 'single' })).toThrow(reason);
    }
    const layout = rich.replaceAll('<syllabic>single</syllabic><text>Low</text>', '<syllabic>single</syllabic><text>Low</text><text>er</text>');
    expect(inspectMusicXmlLyrics(layout, score(layout), m1e2)[0].reason).toContain('lyric layout');
  });

  it('keeps a beat lyric when its first chord note is removed', () => {
    const chord = addMusicXmlNote(rich, score(), { measure: 0, beat: 1, voice: 1, string: 5, fret: 0 });
    const removed = removeMusicXmlNotes(chord, score(chord), { measure: 0, beat: 1, voice: 1, string: 4 })!;
    expect(removed.source.match(/<text>Low<\/text>/g)).toHaveLength(2);
    expect(inspectMusicXmlLyrics(removed.source, score(removed.source), m1e2)).toEqual([{ verse: 1, text: 'Low', syllabic: 'single' }]);
    const rest = removeMusicXmlNotes(rich, score(), { measure: 0, beat: 1, voice: 1 })!;
    expect(rest.source.match(/<text>Low<\/text>/g)).toHaveLength(2);
    const graceLyric = rich.replace('<grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch><voice>2</voice><type>16th</type><staff>2</staff><notations><technical><string>4</string><fret>0</fret></technical></notations>',
      '<grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch><voice>2</voice><type>16th</type><staff>2</staff><notations><technical><string>4</string><fret>0</fret></technical></notations><lyric><text>ah</text></lyric>');
    expect(graceLyric).toContain('<text>ah</text>');
    const graceBeat = score(graceLyric).tracks[0].staves[0].bars[0].voices[1].beats.findIndex(beat => beat.graceType);
    expect(() => removeMusicXmlGrace(graceLyric, score(graceLyric), { measure: 0, beat: graceBeat, voice: 1, string: 4 })).toThrow('protected lyric attachment');
  });

  it('keeps standalone lyrics distinct, multiline, limited, and removable', () => {
    const text = 'VERSE 1\n  C        G\nOh the wind\n\nCHORUS\nLine two';
    const withText = setMusicXmlStandaloneLyrics(rich, text);
    const preview = readMusicXml(withText, 'rich.musicxml');
    expect(preview.lyricsSection).toBe(text);
    expect(inspectMusicXmlLyrics(withText, preview.score, m1e2)).toEqual([{ verse: 1, text: 'Low', syllabic: 'single' }]);
    const replaced = setMusicXmlStandaloneLyrics(withText, 'Just one line');
    expect(readMusicXml(replaced, 'rich.musicxml').lyricsSection).toBe('Just one line');
    const cleared = setMusicXmlStandaloneLyrics(replaced, '   ');
    expect(readMusicXml(cleared, 'rich.musicxml').lyricsSection).toBeNull();
    expect(cleared).not.toContain('playtab-lyrics');
    expect(() => setMusicXmlStandaloneLyrics(rich, 'x'.repeat(20_001))).toThrow('limited to 20,000 characters');
  });
});

describe('ED-18 anchored chords, sections and annotations', () => {
  const score = () => readMusicXml(rich, 'rich.musicxml').score;
  const m2e3 = { measure: 1, beat: 2, voice: 1 };
  const m1e2 = { measure: 0, beat: 1, voice: 1 };
  const cMinor: ChordSpelling = { step: 'C', alter: 0, quality: 'minor', bass: null };
  const tabBeats = (source: string, measure: number) => readMusicXml(source, 'rich.musicxml').score.tracks[0].staves[0].bars[measure].voices[1].beats;
  const measureXml = (source: string, index: number) => new DOMParser().parseFromString(source, 'application/xml').getElementsByTagName('measure')[index];

  it('anchors a chord at the selected onset and a section at its measure start, removing only the chosen item', () => {
    expect(inspectMusicXmlAnchor(rich, score(), m2e3)).toEqual({ chords: [], words: [], sections: [] });
    const chord = changeMusicXmlAnchor(rich, score(), m2e3, 'chord', null, cMinor);
    const harmonies = Array.from(measureXml(chord, 1).getElementsByTagName('harmony'));
    expect(harmonies.map(item => item.getElementsByTagName('staff')[0].textContent).sort()).toEqual(['1', '2']);
    expect(measureXml(chord, 0).getElementsByTagName('harmony')).toHaveLength(1);
    const beats = tabBeats(chord, 1);
    expect(beats[2].chord?.name).toBe('Cm');
    expect(beats[2].playbackStart - beats[0].playbackStart).toBe(1920);
    expect(beats.slice(0, 2).every(beat => !beat.chord)).toBe(true);
    const chordScore = readMusicXml(chord, 'rich.musicxml').score;
    expect(inspectMusicXmlAnchor(chord, chordScore, m2e3).chords).toEqual([{ text: 'Cm', chord: cMinor }]);
    const section = changeMusicXmlAnchor(chord, chordScore, m2e3, 'section', null, 'Chorus');
    const sectionScore = readMusicXml(section, 'rich.musicxml').score;
    expect(sectionScore.masterBars[1].section?.marker).toBe('Chorus');
    expect(sectionScore.masterBars[0].section).toBeFalsy();
    const first = Array.from(measureXml(section, 1).childNodes).filter(node => node.nodeType === 1).map(node => (node as unknown as Element).localName);
    expect(first.indexOf('direction')).toBeLessThan(first.indexOf('note'));
    expect(inspectMusicXmlAnchor(section, sectionScore, { measure: 1, beat: 0, voice: 1 }).sections).toEqual([{ text: 'Chorus' }]);
    const noChord = changeMusicXmlAnchor(section, sectionScore, m2e3, 'chord', 0, null);
    expect(measureXml(noChord, 1).getElementsByTagName('harmony')).toHaveLength(0);
    expect(measureXml(noChord, 0).getElementsByTagName('harmony')).toHaveLength(1);
    expect(noChord).toContain('<rehearsal>Chorus</rehearsal>');
    const noSection = changeMusicXmlAnchor(noChord, readMusicXml(noChord, 'rich.musicxml').score, m2e3, 'section', 0, null);
    expect(noSection).toBe(new XMLSerializer().serializeToString(new DOMParser().parseFromString(rich, 'application/xml')));
  });

  it('keeps multiple annotations individually editable without touching other words, lyrics or techniques', () => {
    expect(inspectMusicXmlAnchor(rich, score(), m1e2)).toEqual({ chords: [{ text: 'C/G', chord: { step: 'C', alter: 0, quality: 'major', bass: { step: 'G', alter: 0 } } }],
      words: [{ text: 'Section A' }], sections: [] });
    const added = changeMusicXmlAnchor(rich, score(), m1e2, 'words', null, '  Play softly ');
    const addedScore = readMusicXml(added, 'rich.musicxml').score;
    expect(inspectMusicXmlAnchor(added, addedScore, m1e2).words).toEqual([{ text: 'Section A' }, { text: 'Play softly' }]);
    expect(tabBeats(added, 0)[1].text).toContain('Play softly');
    const edited = changeMusicXmlAnchor(added, addedScore, m1e2, 'words', 1, 'Play loudly');
    expect(edited.match(/<words>Play loudly<\/words>/g)).toHaveLength(2);
    expect(edited).toContain('<words>Section A</words>');
    expect(edited).toContain('<words>Section B</words>');
    expect(edited.match(/<text>Low<\/text>/g)).toHaveLength(2);
    expect(edited).toContain('<hammer-on type="start">H</hammer-on>');
    const removed = changeMusicXmlAnchor(edited, readMusicXml(edited, 'rich.musicxml').score, m1e2, 'words', 0, null);
    expect(removed).not.toContain('Section A');
    expect(removed).toContain('<direction><direction-type><words/></direction-type><sound tempo="96"/></direction>');
    const removedScore = readMusicXml(removed, 'rich.musicxml').score;
    expect(removedScore.tempo).toBe(readMusicXml(rich, 'rich.musicxml').score.tempo);
    expect(inspectMusicXmlAnchor(removed, removedScore, m1e2).words).toEqual([{ text: 'Play loudly' }]);
    expect(removed).toContain('<words>Play loudly</words>');
  });

  it('writes accidental and bass spelling, and keeps an unknown imported quality until replaced', () => {
    const flat: ChordSpelling = { step: 'B', alter: -1, quality: 'minor-seventh', bass: { step: 'F', alter: 1 } };
    const spelled = changeMusicXmlAnchor(rich, score(), m2e3, 'chord', null, flat);
    expect(spelled).toContain('<root><root-step>B</root-step><root-alter>-1</root-alter></root><kind>minor-seventh</kind><bass><bass-step>F</bass-step><bass-alter>1</bass-alter></bass>');
    expect(inspectMusicXmlAnchor(spelled, readMusicXml(spelled, 'rich.musicxml').score, m2e3).chords).toEqual([{ text: 'B♭m7/F♯', chord: flat }]);
    const tef = rich.replace('<harmony><root><root-step>C</root-step></root><kind>major</kind><bass><bass-step>G</bass-step></bass></harmony>',
      '<harmony placement="above" data-playtab-strings="0,0,0,0,0"><root><root-step>C</root-step><root-alter>-1</root-alter></root><kind text="m7b5">major</kind></harmony>');
    expect(tef).toContain('m7b5');
    const info = inspectMusicXmlAnchor(tef, score(), m1e2).chords[0];
    expect(info.text).toBe('C♭m7b5');
    expect(info.reason).toContain('kept until you replace it');
    expect(info.chord).toBeUndefined();
    const other = changeMusicXmlAnchor(tef, score(), m1e2, 'words', 0, 'Section A2');
    expect(other).toContain('<kind text="m7b5">major</kind>');
    const replaced = changeMusicXmlAnchor(tef, score(), m1e2, 'chord', 0, cMinor);
    expect(replaced).toContain('<harmony placement="above"><root><root-step>C</root-step></root><kind>minor</kind></harmony>');
    for (const [from, to] of [['<root-alter>-1</root-alter>', '<root-alter>2</root-alter>'], ['<kind text="m7b5">major</kind>', '<kind>ninth</kind>'],
      ['<kind text="m7b5">major</kind>', '<kind>minor</kind><degree/>'], ['placement="above"', 'placement="above" font-size="9"']]) {
      expect(inspectMusicXmlAnchor(tef.replace(from, to), score(), m1e2).chords[0].reason).toBeTruthy();
    }
  });

  it('validates limits before mutation and keeps anchors when a beat is emptied', () => {
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'words', null, 'x'.repeat(161))).toThrow('Text must be 1–160 characters.');
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'section', null, '   ')).toThrow('Text must be 1–160 characters.');
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'chord', null, { ...cMinor, step: 'H' as 'C' })).toThrow('Choose a chord root');
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'chord', null, { ...cMinor, bass: { step: 'C', alter: 2 as 1 } })).toThrow('Choose a chord root');
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'chord', null, 'Cm')).toThrow('matching value');
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'words', null, null)).toThrow('Choose an existing item');
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'words', 3, 'Late')).toThrow('no longer at this position');
    expect(() => inspectMusicXmlAnchor(rich, score(), { measure: 0, beat: 0, voice: 1 })).toThrow('Select an ordinary beat');
    const chord = changeMusicXmlAnchor(rich, score(), { measure: 1, beat: 1, voice: 1 }, 'chord', null, cMinor);
    const emptied = removeMusicXmlNotes(chord, readMusicXml(chord, 'rich.musicxml').score, { measure: 1, beat: 1, voice: 1 })!;
    expect(measureXml(emptied.source, 1).getElementsByTagName('harmony')).toHaveLength(2);
    expect(inspectMusicXmlAnchor(emptied.source, readMusicXml(emptied.source, 'rich.musicxml').score, { measure: 1, beat: 1, voice: 1 }).chords)
      .toEqual([{ text: 'Cm', chord: cMinor }]);
  });
});
