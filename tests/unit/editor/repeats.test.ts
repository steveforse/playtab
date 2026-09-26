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

describe('ED-15 repeat authoring foundation', () => {
  const source = (() => {
    const document = new DOMParser().parseFromString(fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8'), 'application/xml');
    const part = document.getElementsByTagName('part')[0];
    const first = document.getElementsByTagName('measure')[0];
    part.removeChild(document.getElementsByTagName('measure')[1]);
    const pitches = [
      ['D', '', '3'], ['D', '1', '3'], ['E', '', '3'], ['F', '', '3'], ['F', '1', '3'],
    ];
    for (let index = 0; index < 5; index++) {
      const measure = index === 0 ? first : first.cloneNode(true) as typeof first;
      measure.setAttribute('number', String(index + 1));
      const pitch = measure.getElementsByTagName('pitch')[0];
      pitch.getElementsByTagName('step')[0].textContent = pitches[index][0];
      pitch.getElementsByTagName('octave')[0].textContent = pitches[index][2];
      if (pitches[index][1]) {
        const alter = document.createElement('alter'); alter.textContent = pitches[index][1];
        pitch.insertBefore(alter, pitch.getElementsByTagName('octave')[0]);
      }
      measure.getElementsByTagName('fret')[0].textContent = String(index);
      if (index) part.appendChild(measure);
    }
    return new XMLSerializer().serializeToString(document);
  })();

  it('plays a 2–4 repeat twice in written order', () => {
    const original = readMusicXml(source, 'repeat.musicxml');
    const repeated = addMusicXmlRepeat(source, original.score, 1, 3, 2);
    const after = readMusicXml(repeated, 'repeat.musicxml');
    expect(after.score.masterBars[1].isRepeatStart).toBe(true);
    expect(after.score.masterBars[3].repeatCount).toBe(2);
    const file = new midi.MidiFile();
    new midi.MidiFileGenerator(after.score, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
    expect(file.events.filter((event): event is midi.NoteOnEvent => event instanceof midi.NoteOnEvent)
      .map(event => event.noteKey)).toEqual([50, 51, 52, 53, 51, 52, 53, 54]);
  });

  it('rejects overlapping and nested repeats while allowing disjoint regions', () => {
    const original = readMusicXml(source, 'repeat.musicxml');
    const first = addMusicXmlRepeat(source, original.score, 0, 1, 2);
    expect(() => addMusicXmlRepeat(first, readMusicXml(first, 'repeat.musicxml').score, 1, 3, 2))
      .toThrow('overlapping repeat regions');
    const separate = addMusicXmlRepeat(first, readMusicXml(first, 'repeat.musicxml').score, 2, 4, 2);
    expect(readMusicXml(separate, 'repeat.musicxml').score.masterBars[2].isRepeatStart).toBe(true);
    expect(() => addMusicXmlRepeat(source, original.score, 3, 1, 2)).toThrow('start before its end');
    expect(() => addMusicXmlRepeat(source, original.score, 1, 3, 9)).toThrow('from 2 to 8');
  });

  it('reports existing regions and refuses imported endings or unsafe repeat maps', () => {
    const original = readMusicXml(source, 'repeat.musicxml');
    expect(() => inspectMusicXmlRepeats('<score-partwise version="4.0"/>')).toThrow('no music part');
    expect(() => addMusicXmlRepeat('<score-partwise version="4.0"/>', original.score, 0, 1, 2))
      .toThrow('do not match the rendered score');
    expect(() => addMusicXmlRepeat(source, readMusicXml(fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8'), 'tie.musicxml').score, 0, 1, 2))
      .toThrow('do not match the rendered score');
    const repeated = addMusicXmlRepeat(source, original.score, 0, 1, 2);
    expect(inspectMusicXmlRepeats(repeated)).toEqual([{ start: 0, end: 1, count: 2 }]);
    const withMarker = (input: string, measureIndex: number, direction: string, times?: string) => {
      const document = new DOMParser().parseFromString(input, 'application/xml');
      const measure = document.getElementsByTagName('measure')[measureIndex];
      const barline = document.createElement('barline');
      const repeat = document.createElement('repeat');
      repeat.setAttribute('direction', direction);
      if (times) repeat.setAttribute('times', times);
      barline.appendChild(repeat); measure.appendChild(barline);
      return new XMLSerializer().serializeToString(document);
    };
    expect(() => inspectMusicXmlRepeats(withMarker(source, 2, 'backward'))).toThrow('no explicit start');
    expect(() => inspectMusicXmlRepeats(withMarker(source, 0, 'forward'))).toThrow('has no end');
    expect(() => inspectMusicXmlRepeats(withMarker(repeated, 0, 'forward'))).toThrow('Nested or overlapping');
    expect(() => inspectMusicXmlRepeats(withMarker(source, 0, 'sideways'))).toThrow('unsupported direction');
    expect(() => inspectMusicXmlRepeats(withMarker(withMarker(source, 0, 'forward'), 2, 'backward', '1')))
      .toThrow('unsupported play count');
    const huge = withMarker(withMarker(source, 0, 'forward'), 1, 'backward', '5000');
    expect(() => addMusicXmlRepeat(huge, original.score, 2, 4, 2)).toThrow('exceed 4096');
    const document = new DOMParser().parseFromString(source, 'application/xml');
    document.getElementsByTagName('measure')[0].appendChild(document.createElement('ending'));
    expect(() => addMusicXmlRepeat(new XMLSerializer().serializeToString(document), original.score, 1, 3, 2))
      .toThrow('Existing repeat endings');
  });

  it('plays first and second endings in their assigned passes', () => {
    const document = new DOMParser().parseFromString(source, 'application/xml');
    const last = document.getElementsByTagName('measure')[4];
    const sixth = last.cloneNode(true) as typeof last;
    sixth.setAttribute('number', '6');
    sixth.getElementsByTagName('step')[0].textContent = 'G';
    sixth.getElementsByTagName('alter')[0]?.parentNode?.removeChild(sixth.getElementsByTagName('alter')[0]);
    sixth.getElementsByTagName('fret')[0].textContent = '5';
    last.parentNode!.appendChild(sixth);
    const sixBars = new XMLSerializer().serializeToString(document);
    const original = readMusicXml(sixBars, 'ending.musicxml');
    const repeated = addMusicXmlRepeat(sixBars, original.score, 1, 3, 2);
    const withEndings = addMusicXmlEndings(repeated, readMusicXml(repeated, 'ending.musicxml').score, 1, 3, 3, 4);
    expect(inspectMusicXmlRepeatEndings(withEndings, 1, 3))
      .toEqual({ firstStart: 3, firstEnd: 3, secondStart: 4, secondEnd: 4 });
    const after = readMusicXml(withEndings, 'ending.musicxml');
    const file = new midi.MidiFile();
    new midi.MidiFileGenerator(after.score, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
    expect(file.events.filter((event): event is midi.NoteOnEvent => event instanceof midi.NoteOnEvent)
      .map(event => event.noteKey)).toEqual([50, 51, 52, 53, 51, 52, 54, 55]);
    expect(linearAuditionMidi(after.score).events.filter((event): event is midi.NoteOnEvent => event instanceof midi.NoteOnEvent)
      .map(event => event.noteKey)).toEqual([50, 51, 52, 53, 54, 55]);
    const firstBeat = after.score.tracks[0].staves[0].bars[1].voices[0].beats[0];
    const lastBeat = after.score.tracks[0].staves[0].bars[3].voices[0].beats[0];
    expect(writtenPlaybackRange(after.score, { start: selectionFromBeat(firstBeat), end: selectionFromBeat(lastBeat) }))
      .toEqual({ startTick: after.score.masterBars[1].start,
        endTick: after.score.masterBars[3].start + lastBeat.playbackDuration });
    const cleared = removeMusicXmlRepeat(withEndings, after.score, 1, 3);
    expect(inspectMusicXmlRepeats(cleared)).toEqual([]);
    expect(new DOMParser().parseFromString(cleared, 'application/xml').getElementsByTagName('ending')).toHaveLength(0);
    expect(readMusicXml(cleared, 'ending.musicxml').score.masterBars).toHaveLength(6);
    expect(() => addMusicXmlEndings(repeated, readMusicXml(repeated, 'ending.musicxml').score, 1, 3, 1, 4))
      .not.toThrow();
    expect(() => addMusicXmlEndings(repeated, readMusicXml(repeated, 'ending.musicxml').score, 1, 3, 0, 4))
      .toThrow('inside its repeat');
    expect(() => addMusicXmlEndings(repeated, readMusicXml(repeated, 'ending.musicxml').score, 1, 3, 3, 3))
      .toThrow('immediately after');
  });

  it('rejects unsafe ending and removal targets without changing source', () => {
    const original = readMusicXml(source, 'repeat.musicxml');
    const repeated = addMusicXmlRepeat(source, original.score, 1, 3, 2);
    const repeatedScore = readMusicXml(repeated, 'repeat.musicxml').score;
    expect(() => addMusicXmlEndings(source, original.score, 1, 3, 3, 4)).toThrow('known repeat region');
    expect(() => addMusicXmlEndings(repeated, original.score, 0, 3, 3, 4)).toThrow('known repeat region');
    const three = addMusicXmlRepeat(source, original.score, 1, 3, 3);
    expect(() => addMusicXmlEndings(three, readMusicXml(three, 'repeat.musicxml').score, 1, 3, 3, 4))
      .toThrow('count of 2');
    const separate = addMusicXmlRepeat(addMusicXmlRepeat(source, original.score, 0, 1, 2), original.score, 2, 3, 2);
    expect(() => addMusicXmlEndings(separate, readMusicXml(separate, 'repeat.musicxml').score, 0, 1, 1, 2))
      .toThrow('overlap another repeat');
    const withEndings = addMusicXmlEndings(repeated, repeatedScore, 1, 3, 3, 4);
    expect(() => addMusicXmlEndings(withEndings, readMusicXml(withEndings, 'repeat.musicxml').score, 1, 3, 3, 4))
      .toThrow('Imported endings');
    expect(() => inspectMusicXmlRepeatEndings(repeated, 0, 3)).toThrow('cannot be identified');
    expect(() => removeMusicXmlRepeat(repeated, repeatedScore, 0, 3)).toThrow('cannot be identified');
    const malformed = new DOMParser().parseFromString(withEndings, 'application/xml');
    const endingStops = Array.from(malformed.getElementsByTagName('ending')).filter(item => item.getAttribute('type') === 'stop');
    endingStops[1].parentNode!.removeChild(endingStops[1]);
    const incomplete = new XMLSerializer().serializeToString(malformed);
    expect(() => inspectMusicXmlRepeatEndings(incomplete, 1, 3)).toThrow('preserved but cannot be edited safely');
    expect(() => removeMusicXmlRepeat(incomplete, repeatedScore, 1, 3)).toThrow('preserved but cannot be edited safely');
    expect(incomplete).toContain('ending');
    expect(() => inspectMusicXmlRepeatEndings('<score-partwise version="4.0"/>', 1, 3)).toThrow('no music part');
    expect(() => removeMusicXmlRepeat('<score-partwise version="4.0"/>', repeatedScore, 1, 3))
      .toThrow('do not match');
    expect(() => addMusicXmlEndings('<score-partwise version="4.0"/>', repeatedScore, 1, 3, 3, 4))
      .toThrow('do not match');
    const relocated = new DOMParser().parseFromString(repeated, 'application/xml');
    const backward = relocated.getElementsByTagName('repeat')[1];
    (backward.parentNode as typeof backward).setAttribute('location', 'left');
    expect(() => removeMusicXmlRepeat(new XMLSerializer().serializeToString(relocated), repeatedScore, 1, 3))
      .toThrow('endpoint changed');
  });

  it('allows a separate repeat after a completed ending pair but not across it', () => {
    const original = readMusicXml(source, 'repeat.musicxml');
    const first = addMusicXmlRepeat(source, original.score, 0, 1, 2);
    const endings = addMusicXmlEndings(first, readMusicXml(first, 'repeat.musicxml').score, 0, 1, 1, 2);
    const score = readMusicXml(endings, 'repeat.musicxml').score;
    expect(() => addMusicXmlRepeat(endings, score, 2, 3, 2)).toThrow('overlap existing first or second endings');
    const separate = addMusicXmlRepeat(endings, score, 3, 4, 2);
    expect(inspectMusicXmlRepeats(separate)).toEqual([{ start: 0, end: 1, count: 2 }, { start: 3, end: 4, count: 2 }]);
    expect(inspectMusicXmlRepeatEndings(separate, 0, 1))
      .toEqual({ firstStart: 1, firstEnd: 1, secondStart: 2, secondEnd: 2 });
  });
});
