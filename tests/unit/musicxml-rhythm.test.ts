import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { readMusicXml } from '../../app/frontend/music/musicxml';
import { addMusicXmlNote, changeMusicXmlDuration, createMusicXmlTriplet, insertMusicXmlBeat, inspectMusicXmlDuration, inspectMusicXmlTriplet,
  musicXmlEditorState, removeMusicXmlTriplet } from '../../app/frontend/music/musicxml-editor';

vi.stubGlobal('DOMParser', DOMParser);
vi.stubGlobal('XMLSerializer', XMLSerializer);

const paired = fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8');
const tab = (source: string) => readMusicXml(source, 'paired.musicxml').score.tracks[0].staves[0].bars[0].voices[1].beats;

describe('ED-10 imported duration commands', () => {
  it('shortens a paired chord, fills freed time, and lengthens through that rest', () => {
    const original = readMusicXml(paired, 'paired.musicxml');
    const shortened = changeMusicXmlDuration(paired, original.score, { measure: 0, beat: 0, voice: 1 }, 8);
    expect(shortened).toContain('<divisions>2</divisions>');
    expect(shortened).toContain('<backup><duration>8</duration></backup>');
    const beats = tab(shortened);
    expect(beats[0].notes).toHaveLength(2);
    expect(beats[1].isRest).toBe(true);
    expect(beats[2].playbackStart).toBe(960);
    const restored = changeMusicXmlDuration(shortened, readMusicXml(shortened, 'paired.musicxml').score,
      { measure: 0, beat: 0, voice: 1 }, 4);
    expect(tab(restored).map(beat => beat.playbackStart)).toEqual(tab(paired).map(beat => beat.playbackStart));
    expect(tab(restored)[0].notes).toHaveLength(2);
  });

  it('splits a paired half rest into two quarter rests without moving prior notes', () => {
    const original = readMusicXml(paired, 'paired.musicxml');
    const split = changeMusicXmlDuration(paired, original.score, { measure: 0, beat: 2, voice: 1 }, 4);
    expect(tab(split).map(beat => beat.playbackStart)).toEqual([0, 960, 1920, 2880]);
    expect(tab(split).slice(2).every(beat => beat.isRest)).toBe(true);
  });

  it('rejects lengthening into the next sounding beat atomically', () => {
    const original = readMusicXml(paired, 'paired.musicxml');
    expect(() => changeMusicXmlDuration(paired, original.score, { measure: 0, beat: 0, voice: 1 }, 2))
      .toThrow('Not enough rest space in this measure');
    expect(original.source).toBe(paired);
  });

  it('writes dotted rhythms exactly and preserves imported multiple dots until replacement', () => {
    const original = readMusicXml(paired, 'paired.musicxml');
    const dotted = changeMusicXmlDuration(paired, original.score, { measure: 0, beat: 2, voice: 1 }, 4, true);
    expect(inspectMusicXmlDuration(dotted, { measure: 0, beat: 2, voice: 1 })).toMatchObject({ denominator: 4, dots: 1, rest: true });
    expect(tab(dotted)[2].playbackDuration).toBe(1440);
    const doubled = paired.replace('<type>half</type><staff>2</staff>', '<type>half</type><dot/><dot/><staff>2</staff>');
    expect(inspectMusicXmlDuration(doubled, { measure: 0, beat: 2, voice: 1 }).dots).toBe(2);
  });

  it('edits one rich-source voice and restores inherited divisions in the next measure', () => {
    const source = fs.readFileSync('tests/fixtures/editor-rich.musicxml', 'utf8');
    const preview = readMusicXml(source, 'rich.musicxml');
    const target = musicXmlEditorState(source, preview.score).notes.find(note => note.sourceIdentity?.voice === '4' && note.measure === 0)!;
    expect(target).toBeTruthy();
    const changed = changeMusicXmlDuration(source, preview.score,
      { measure: 0, beat: target.beat, voice: target.voice! }, 8);
    const xml = new DOMParser().parseFromString(changed, 'application/xml');
    const measures = Array.from(xml.getElementsByTagName('measure'));
    expect(measures[0].getElementsByTagName('divisions')[0].textContent).toBe('2');
    expect(measures[1].getElementsByTagName('divisions')[0].textContent).toBe('1');
    expect(changed).toContain('<opaque:keep data="unchanged"><opaque:nested>source detail</opaque:nested></opaque:keep>');
    const after = readMusicXml(changed, 'rich.musicxml');
    expect(after.score.masterBars[1].timeSignatureNumerator).toBe(3);
    expect(after.score.tracks[0].staves[0].bars[0].voices[1].beats.filter(beat => !beat.graceType).map(beat => beat.playbackStart))
      .toEqual(preview.score.tracks[0].staves[0].bars[0].voices[1].beats.filter(beat => !beat.graceType).map(beat => beat.playbackStart));
  });
});

describe('ED-10 insert beat', () => {
  it('inserts a paired note after the selection and consumes only trailing rest time', () => {
    const original = readMusicXml(paired, 'paired.musicxml');
    const inserted = insertMusicXmlBeat(paired, original.score, {
      measure: 0, beat: 0, voice: 1, placement: 'after', kind: 'note', denominator: 8,
      dotted: false, string: 2, fret: 3,
    });
    const beats = tab(inserted);
    expect(beats.map(beat => beat.playbackStart)).toEqual([0, 960, 1440, 2400, 3360]);
    expect(beats[1].notes.map(note => note.fret)).toEqual([3]);
    expect(beats[2].notes.map(note => note.fret)).toEqual([0]);
    expect(beats.slice(3).every(beat => beat.isRest)).toBe(true);
    expect(inserted).toContain('<backup><duration>8</duration></backup>');
  });

  it('inserts before the selected beat and rejects insertion past the trailing rest', () => {
    const original = readMusicXml(paired, 'paired.musicxml');
    const inserted = insertMusicXmlBeat(paired, original.score, {
      measure: 0, beat: 0, voice: 1, placement: 'before', kind: 'rest', denominator: 4,
      dotted: false,
    });
    expect(tab(inserted)[0].isRest).toBe(true);
    expect(tab(inserted)[1].notes).toHaveLength(2);
    expect(tab(inserted)[1].playbackStart).toBe(960);
    expect(() => insertMusicXmlBeat(paired, original.score, {
      measure: 0, beat: 2, voice: 1, placement: 'after', kind: 'rest', denominator: 4, dotted: false,
    })).toThrow('Not enough rest space in this measure');
  });

  it('rejects a protected shifted lyric without changing the source', () => {
    const protectedSource = paired.replaceAll('<type>quarter</type><staff>2</staff><notations><technical><string>3</string><fret>0</fret></technical></notations></note>',
      '<type>quarter</type><staff>2</staff><notations><technical><string>3</string><fret>0</fret></technical></notations><lyric><text>word</text></lyric></note>');
    const original = readMusicXml(protectedSource, 'paired.musicxml');
    expect(() => insertMusicXmlBeat(protectedSource, original.score, {
      measure: 0, beat: 0, voice: 1, placement: 'after', kind: 'rest', denominator: 8, dotted: false,
    })).toThrow('protected span or annotation');
    expect(original.source).toBe(protectedSource);
  });

  it('matches an unambiguous all-rest paired voice for rhythm edits and insertion', () => {
    const head = paired.slice(0, paired.indexOf('    <note>'));
    const allRests = `${head}
    <note><rest/><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    <note><rest/><duration>3</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>
    <backup><duration>4</duration></backup>
    <note><rest/><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>
    <note><rest/><duration>3</duration><voice>2</voice><type>half</type><dot/><staff>2</staff></note>
  </measure></part></score-partwise>`;
    const original = readMusicXml(allRests, 'all-rest.musicxml');
    const split = changeMusicXmlDuration(allRests, original.score, { measure: 0, beat: 0, voice: 1 }, 8);
    expect(readMusicXml(split, 'all-rest.musicxml').score.tracks[0].staves[0].bars[0].voices[1].beats).toHaveLength(3);
    const inserted = insertMusicXmlBeat(allRests, original.score, {
      measure: 0, beat: 0, voice: 1, placement: 'after', kind: 'rest', denominator: 8, dotted: false,
    });
    expect(readMusicXml(inserted, 'all-rest.musicxml').score.tracks[0].staves[0].bars[0].voices[1].beats).toHaveLength(4);
  });

  it('keeps a separate voice and the next measure at their original onsets', () => {
    const source = fs.readFileSync('tests/fixtures/editor-rich.musicxml', 'utf8');
    const original = readMusicXml(source, 'voices.musicxml');
    const changed = insertMusicXmlBeat(source, original.score, {
      measure: 0, beat: 0, voice: 3, placement: 'after', kind: 'rest', denominator: 8, dotted: false,
    });
    const after = readMusicXml(changed, 'voices.musicxml');
    expect(after.score.tracks[0].staves[0].bars[0].voices[1].beats.map(beat => beat.playbackStart))
      .toEqual(original.score.tracks[0].staves[0].bars[0].voices[1].beats.map(beat => beat.playbackStart));
    expect(after.score.tracks[0].staves[0].bars[1].voices[3].beats[0].playbackStart)
      .toBe(original.score.tracks[0].staves[0].bars[1].voices[3].beats[0].playbackStart);
  });

  it('validates insertion choices before editing the source', () => {
    const original = readMusicXml(paired, 'paired.musicxml');
    const base = { measure: 0, beat: 0, voice: 1, placement: 'after' as const,
      kind: 'note' as const, denominator: 8 as const, dotted: false, string: 2, fret: 3 };
    expect(() => insertMusicXmlBeat(paired, original.score, { ...base, fret: 37 })).toThrow('valid string and fret');
    expect(() => insertMusicXmlBeat(paired, original.score, { ...base, denominator: 3 as never })).toThrow('Unsupported note duration');
    expect(() => insertMusicXmlBeat(paired, original.score, { ...base, placement: 'middle' as never })).toThrow('Invalid beat insertion choice');
  });
});

describe('ED-11 triplets', () => {
  it('turns a paired quarter chord into three eighth triplet children without moving the next onset', () => {
    const original = readMusicXml(paired, 'paired.musicxml');
    const source = createMusicXmlTriplet(paired, original.score, { measure: 0, beat: 0, voice: 1 });
    const children = tab(source);
    expect(children.slice(0, 3).map(beat => beat.playbackStart)).toEqual([0, 320, 640]);
    expect(children.slice(0, 3).map(beat => beat.playbackDuration)).toEqual([320, 320, 320]);
    expect(children[0].notes).toHaveLength(2);
    expect(children[1].isRest).toBe(true);
    expect(children[2].isRest).toBe(true);
    expect(children[3].playbackStart).toBe(960);
    expect(source.match(/<actual-notes>3<\/actual-notes>/g)).toHaveLength(8);
    expect(inspectMusicXmlTriplet(source, { measure: 0, beat: 1, voice: 1 })).toMatchObject({ triplet: true, canRemove: true, start: 0 });
    const restored = removeMusicXmlTriplet(source, readMusicXml(source, 'paired.musicxml').score,
      { measure: 0, beat: 1, voice: 1 });
    expect(tab(restored).map(beat => beat.playbackStart)).toEqual(tab(paired).map(beat => beat.playbackStart));
    expect(tab(restored)[0].notes).toHaveLength(2);
  });

  it('makes three rests from a rest and rejects children below 1/64', () => {
    const original = readMusicXml(paired, 'paired.musicxml');
    const source = createMusicXmlTriplet(paired, original.score, { measure: 0, beat: 2, voice: 1 });
    expect(tab(source).slice(2, 5).every(beat => beat.isRest)).toBe(true);
    expect(tab(source).slice(2, 5).map(beat => beat.playbackDuration)).toEqual([640, 640, 640]);
    const shortened = changeMusicXmlDuration(paired, original.score, { measure: 0, beat: 0, voice: 1 }, 64);
    expect(() => createMusicXmlTriplet(shortened, readMusicXml(shortened, 'paired.musicxml').score,
      { measure: 0, beat: 0, voice: 1 })).toThrow('shorter than 1/64');
  });

  it('retains tuplets through a child fret edit and blocks removal of sounding children', () => {
    const original = readMusicXml(paired, 'paired.musicxml');
    const source = createMusicXmlTriplet(paired, original.score, { measure: 0, beat: 0, voice: 1 });
    const preview = readMusicXml(source, 'paired.musicxml');
    const changed = addMusicXmlNote(source, preview.score,
      { measure: 0, beat: 1, voice: 1, string: 2, fret: 3 });
    expect(tab(changed).slice(0, 3).map(beat => beat.playbackDuration)).toEqual([320, 320, 320]);
    expect(inspectMusicXmlTriplet(changed, { measure: 0, beat: 0, voice: 1 })).toMatchObject({ triplet: true, canRemove: false });
    expect(() => removeMusicXmlTriplet(changed, readMusicXml(changed, 'paired.musicxml').score,
      { measure: 0, beat: 1, voice: 1 })).toThrow('Remove the last two notes');
  });

  it('recognizes a 3:2 group without explicit brackets and leaves a 5:4 ratio read-only', () => {
    const original = readMusicXml(paired, 'paired.musicxml');
    const created = createMusicXmlTriplet(paired, original.score, { measure: 0, beat: 0, voice: 1 });
    const unbracketed = created.replace(/<tuplet number="1" type="(?:start|stop)"\/>/g, '');
    expect(inspectMusicXmlTriplet(unbracketed, { measure: 0, beat: 2, voice: 1 })).toMatchObject({ triplet: true, canRemove: true });
    const unsupported = created.replaceAll('<actual-notes>3</actual-notes>', '<actual-notes>5</actual-notes>')
      .replaceAll('<normal-notes>2</normal-notes>', '<normal-notes>4</normal-notes>');
    expect(inspectMusicXmlTriplet(unsupported, { measure: 0, beat: 0, voice: 1 })).toMatchObject({ triplet: false, canRemove: false,
      reason: expect.stringContaining('preserved') });
  });
});
