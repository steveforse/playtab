import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { readMusicXml } from '../../app/frontend/music/musicxml';
import { changeMusicXmlDuration, inspectMusicXmlDuration, musicXmlEditorState } from '../../app/frontend/music/musicxml-editor';

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

  it('rejects lengthening into the next sounding event atomically', () => {
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
