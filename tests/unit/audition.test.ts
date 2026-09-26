import { describe, expect, it } from 'vitest';
import { midi, model } from '@coderline/alphatab';
import { toAlphaTab } from '../../app/frontend/music/alphatab';
import { demo } from '../../app/frontend/music/score';
import { linearAuditionMidi, scoreHasRepeats, writtenPlaybackRange } from '../../app/frontend/editor/audition';
import { selectionFromBeat } from '../../app/frontend/Player';

describe('written selection audition', () => {
  it('uses exact written beat boundaries, including another voice at the same onset', () => {
    const score = toAlphaTab(demo);
    const first = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
    const second = score.tracks[0].staves[0].bars[0].voices[0].beats[1];
    expect(writtenPlaybackRange(score, { start: selectionFromBeat(first), end: selectionFromBeat(second) })).toEqual({
      startTick: score.masterBars[0].start + first.playbackStart,
      endTick: score.masterBars[0].start + second.playbackStart + second.playbackDuration,
    });
  });

  it('starts a selected grace group before its ordinary destination beat', () => {
    const bar = { index: 0 } as model.Bar;
    const grace = { graceType: 1, playbackStart: 360, playbackDuration: 120, voice: { bar } } as model.Beat;
    const main = { graceType: 0, playbackStart: 480, playbackDuration: 480, voice: { bar } } as model.Beat;
    const score = { masterBars: [{ start: 0 }], tracks: [{ staves: [{ bars: [{ voices: [{ beats: [grace, main] }] }] }] }] } as model.Score;
    const endpoint = { noteId: null, track: 1, staff: 1, measure: 1, beat: 1, voice: 1,
      string: 3, fret: 0, kind: 'note' as const, graceIndex: 0, graceGroupId: 'one' };
    expect(writtenPlaybackRange(score, { start: endpoint, end: endpoint })).toEqual({ startTick: 360, endTick: 960 });
  });

  it('generates audition MIDI once in written order while preserving score repeats', () => {
    const score = toAlphaTab(demo);
    expect(scoreHasRepeats(score)).toBe(false);
    score.masterBars[0].isRepeatStart = true;
    score.masterBars[1].repeatCount = 2;
    score.rebuildRepeatGroups();
    expect(scoreHasRepeats(score)).toBe(true);
    const normal = new midi.MidiFile();
    new midi.MidiFileGenerator(score, null, new midi.AlphaSynthMidiFileHandler(normal)).generate();
    const audition = linearAuditionMidi(score);
    const sounded = (file: midi.MidiFile) => file.events.filter(event => event instanceof midi.NoteOnEvent);
    expect(sounded(normal).length).toBe(sounded(audition).length + 16);
    expect(score.masterBars[0].isRepeatStart).toBe(true);
    expect(score.masterBars[1].repeatCount).toBe(2);
  });

  it('uses the current unsaved fret pitch in audition MIDI', () => {
    const before = toAlphaTab(demo);
    const changed = structuredClone(demo);
    changed.measures[0].beats[0].notes[0].fret = 2;
    const after = toAlphaTab(changed);
    const firstKey = (score: typeof before) => linearAuditionMidi(score).events
      .find((event): event is midi.NoteOnEvent => event instanceof midi.NoteOnEvent)!.noteKey;
    expect(firstKey(after)).toBe(firstKey(before) + 2);
  });
});
