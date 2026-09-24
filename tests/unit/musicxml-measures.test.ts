import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { readMusicXml } from '../../app/frontend/music/musicxml';
import { insertMusicXmlMeasure } from '../../app/frontend/music/musicxml-editor';

vi.stubGlobal('DOMParser', DOMParser);
vi.stubGlobal('XMLSerializer', XMLSerializer);

const rich = fs.readFileSync('tests/fixtures/editor-rich.musicxml', 'utf8');

describe('ED-12 measure insertion', () => {
  it('uses the inherited 4/4 before an explicit 3/4 bar and fills every paired voice', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const inserted = insertMusicXmlMeasure(rich, original.score, 1, 'before');
    const after = readMusicXml(inserted, 'rich.musicxml');
    expect(after.score.masterBars).toHaveLength(3);
    expect(after.score.masterBars[1].timeSignatureNumerator).toBe(4);
    expect(after.score.masterBars[2].timeSignatureNumerator).toBe(3);
    const voices = after.score.tracks[0].staves[0].bars[1].voices;
    expect(voices[1].beats.every(beat => beat.isRest)).toBe(true);
    expect(voices[3].beats.every(beat => beat.isRest)).toBe(true);
    expect(voices[1].beats.reduce((total, beat) => total + beat.playbackDuration, 0)).toBe(3840);
    expect(voices[3].beats.reduce((total, beat) => total + beat.playbackDuration, 0)).toBe(3840);
    expect(after.score.tracks[0].staves[0].bars[2].voices[1].beats[0].notes[0].fret)
      .toBe(original.score.tracks[0].staves[0].bars[1].voices[1].beats[0].notes[0].fret);
  });

  it('inherits 3/4 after the final bar without inventing a 4/4 measure', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const inserted = insertMusicXmlMeasure(rich, original.score, 1, 'after');
    const after = readMusicXml(inserted, 'rich.musicxml');
    expect(after.score.masterBars).toHaveLength(3);
    expect(after.score.masterBars[2].timeSignatureNumerator).toBe(3);
    const beats = after.score.tracks[0].staves[0].bars[2].voices[1].beats;
    expect(beats.every(beat => beat.isRest)).toBe(true);
    expect(beats.reduce((total, beat) => total + beat.playbackDuration, 0)).toBe(2880);
  });

  it('copies initial attributes when inserting before the first measure', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const inserted = insertMusicXmlMeasure(rich, original.score, 0, 'before');
    const after = readMusicXml(inserted, 'rich.musicxml');
    expect(after.score.masterBars).toHaveLength(3);
    expect(after.score.masterBars[0].timeSignatureNumerator).toBe(4);
    expect(after.score.tracks[0].staves[0].tuning).toEqual(original.score.tracks[0].staves[0].tuning);
    expect(after.score.tracks[0].staves[0].bars[0].voices[1].beats.every(beat => beat.isRest)).toBe(true);
  });

  it('uses exact fractional divisions and restores them for the following inherited bar', () => {
    const source = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Banjo</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>5</beats><beat-type>8</beat-type></time>
      <staff-details number="1"><staff-lines>5</staff-lines><staff-tuning line="1"><tuning-step>G</tuning-step><tuning-octave>4</tuning-octave></staff-tuning>
      <staff-tuning line="2"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
      <staff-tuning line="3"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
      <staff-tuning line="4"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
      <staff-tuning line="5"><tuning-step>D</tuning-step><tuning-octave>4</tuning-octave></staff-tuning></staff-details></attributes>
      <note><rest/><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note></measure>
      <measure number="2"><note><rest/><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note></measure></part></score-partwise>`;
    const original = readMusicXml(source, 'five-eight.musicxml');
    const inserted = insertMusicXmlMeasure(source, original.score, 0, 'after');
    const after = readMusicXml(inserted, 'five-eight.musicxml');
    expect(after.score.masterBars).toHaveLength(3);
    expect(after.score.tracks[0].staves[0].bars[1].voices[0].beats.reduce((sum, beat) => sum + beat.playbackDuration, 0)).toBe(2400);
    const xml = new DOMParser().parseFromString(inserted, 'application/xml');
    const measures = Array.from(xml.getElementsByTagName('measure'));
    expect(measures[1].getElementsByTagName('divisions')[0].textContent).toBe('2');
    expect(measures[2].getElementsByTagName('divisions')[0].textContent).toBe('1');
  });

  it('rejects insertion beyond the 256-measure limit', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const xml = new DOMParser().parseFromString(rich, 'application/xml');
    const part = xml.getElementsByTagName('part')[0];
    const template = xml.getElementsByTagName('measure')[1];
    for (let index = 2; index < 256; index++) part.appendChild(template.cloneNode(true));
    const full = new XMLSerializer().serializeToString(xml);
    const score = Object.assign(Object.create(Object.getPrototypeOf(original.score)), original.score,
      { masterBars: Array(256).fill(original.score.masterBars[1]) });
    expect(() => insertMusicXmlMeasure(full, score, 0, 'after')).toThrow('256 measures');
  });
});
