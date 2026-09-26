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

describe('ED-21 blank scores', () => {
  const blank = (overrides: Partial<Parameters<typeof createBlankMusicXml>[0]> = {}) =>
    createBlankMusicXml({ title: 'Untitled', tempo: 96, numerator: 4, denominator: 4, measures: 8, tuning: OPEN_G_TUNING, ...overrides });

  it('creates valid rest-filled MusicXML in the chosen meter, tempo and tuning', () => {
    const preview = readMusicXml(blank(), 'Untitled.musicxml');
    expect(preview.score.title.replaceAll(' ', ' ')).toBe('Untitled');
    expect(preview.score.tempo).toBe(96);
    expect(preview.score.masterBars).toHaveLength(8);
    expect(preview.score.tracks[0].staves[0].tuning).toEqual(OPEN_G_TUNING);
    expect(preview.score.tracks[0].staves[0].bars.every(bar => bar.voices[0].beats.length === 1 && bar.voices[0].beats[0].isRest)).toBe(true);
    const odd = readMusicXml(blank({ title: 'Jig & Reel <5/8>', numerator: 5, denominator: 8, measures: 2, tempo: 120, tuning: [62, 60, 55, 48, 67] }), 'odd.musicxml');
    expect(odd.score.title.replaceAll(' ', ' ')).toBe('Jig & Reel <5/8>');
    expect(odd.score.masterBars[0].calculateDuration()).toBe(2400);
    expect(odd.score.tracks[0].staves[0].bars[0].voices[0].beats.map(beat => beat.duration)).toEqual([2, 8]);
    expect(odd.score.tracks[0].staves[0].tuning).toEqual([62, 60, 55, 48, 67]);
    expect(readMusicXml(blank({ numerator: 3, measures: 256 }), 'big.musicxml').score.masterBars).toHaveLength(256);
  });

  it('validates every field before creating anything', () => {
    for (const [change, message] of [[{ title: ' ' }, 'Title must be 1–160'], [{ tempo: 241 }, '30 to 240 BPM'], [{ numerator: 13 }, 'time signature'],
      [{ denominator: 3 }, 'time signature'], [{ measures: 0 }, '1 to 256 measures'], [{ measures: 257 }, '1 to 256 measures'],
      [{ tuning: [62, 59, 55, 50] }, 'MIDI pitch from 36 to 96'], [{ tuning: [62, 59, 55, 50, 35] }, 'MIDI pitch from 36 to 96']] as const) {
      expect(() => blank(change as Partial<Parameters<typeof createBlankMusicXml>[0]>)).toThrow(message);
    }
  });

  it('supports the ordinary editing tools without any imported source', () => {
    let source = blank({ measures: 2 });
    const current = () => readMusicXml(source, 'Untitled.musicxml').score;
    source = changeMusicXmlDuration(source, current(), { measure: 0, beat: 0, voice: 0 }, 4, false);
    expect(current().tracks[0].staves[0].bars[0].voices[0].beats.map(beat => beat.duration)).toEqual([4, 2, 4]);
    source = addMusicXmlNote(source, current(), { measure: 0, beat: 0, voice: 0, string: 4, fret: 0 });
    source = addMusicXmlNote(source, current(), { measure: 0, beat: 1, voice: 0, string: 4, fret: 2 });
    source = insertMusicXmlBeat(source, current(), { measure: 0, beat: 1, voice: 0, placement: 'after', kind: 'note', denominator: 4, dotted: false, string: 3, fret: 0 });
    source = insertMusicXmlMeasure(source, current(), 1, 'after');
    source = connectMusicXmlTransition(source, current(), 'hammer-on', { measure: 0, beat: 0, voice: 1, string: 4, fret: 0 }, { measure: 0, beat: 1, voice: 1, string: 4, fret: 2 });
    const after = current();
    expect(after.masterBars).toHaveLength(3);
    expect(after.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].isHammerPullOrigin).toBe(true);
    expect(after.masterBars[0].calculateDuration()).toBe(3840);
    expect(readMusicXml(source, 'reopened.musicxml').score.tracks[0].staves[0].bars[0].voices[0].beats.filter(beat => !beat.isRest).length).toBe(3);
  });
});

describe('ED-22 exports carry the current draft', () => {
  it('reimports an edited MusicXML export to the same beats and plays the corrected pitch in MIDI', () => {
    const source = fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8');
    const original = readMusicXml(source, 'tie.musicxml');
    const state = musicXmlEditorState(source, original.score);
    state.notes[0].fret = 5;
    const edited = applyMusicXmlEdits(source, state, [state.notes[0].index]);
    const reopened = readMusicXml(edited, 'tie.musicxml').score;
    const events = (value: typeof reopened) => value.tracks[0].staves[0].bars.flatMap(bar => bar.voices.flatMap(voice => voice.beats.map(beat =>
      `${bar.index}:${beat.playbackStart}:${beat.playbackDuration}:${beat.notes.map(note => `${note.string}/${note.fret}/${note.realValue}`).join(',')}`)));
    expect(events(readMusicXml(new XMLSerializer().serializeToString(new DOMParser().parseFromString(edited, 'application/xml')), 'export.musicxml').score)).toEqual(events(reopened));
    const keys = (value: typeof reopened) => {
      const file = new midi.MidiFile();
      new midi.MidiFileGenerator(value, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
      return file.events.filter((event): event is midi.NoteOnEvent => event instanceof midi.NoteOnEvent).map(event => event.noteKey);
    };
    expect(keys(original.score)[0]).toBe(50);
    expect(keys(reopened)[0]).toBe(55);
  });
});
