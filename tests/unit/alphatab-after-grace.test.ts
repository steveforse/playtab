import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { importer, midi, model, Settings } from '@coderline/alphatab';
import './editor/support';

// Guards the patched alphaTab behaviour (patches/@coderline+alphatab+1.8.4.patch):
// an end-of-measure grace group marked steal-time-previous (an after-grace)
// takes its time from the preceding beat instead of sounding on the next downbeat.
describe('alphaTab after-grace patch', () => {
  const load = (source: string) => importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(source));
  const noteOns = (score: model.Score) => {
    const file = new midi.MidiFile();
    new midi.MidiFileGenerator(score, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
    return file.tracks.flatMap(track => track.events).filter(event => /NoteOn/.test(event.constructor.name))
      .map(event => `${event.tick}:${(event as unknown as { noteKey: number }).noteKey}`);
  };
  const source = fs.readFileSync('tests/fixtures/editor-after-grace.musicxml', 'utf8');

  it('plays a trailing grace group before the barline, taking time from the preceding chord', () => {
    const score = load(source);
    const [pick, chord, grace] = score.tracks[0].staves[0].bars[0].voices[0].beats;
    expect(grace.graceType).toBe(model.GraceType.BeforeBeat);
    expect(grace.graceGroup!.isComplete).toBe(false);
    expect(chord.playbackDuration).toBe(960 - grace.playbackDuration);
    expect(grace.playbackStart).toBe(chord.playbackStart + chord.playbackDuration);
    expect(grace.playbackStart + grace.playbackDuration).toBe(1920);
    expect(grace.displayStart).toBe(1920);
    expect(chord.notes.every(note => note.slideOutType !== model.SlideOutType.None)).toBe(true);
    expect(pick.playbackDuration).toBe(960);
    expect(noteOns(score)).toEqual(['0:50', '960:63', '960:61', '1800:64', '1800:62', '1920:50']);
  });

  it('keeps an unmarked trailing grace on the next downbeat as before', () => {
    const score = load(source.replaceAll('<grace slash="yes" steal-time-previous="25"/>', '<grace/>'));
    const grace = score.tracks[0].staves[0].bars[0].voices[0].beats[2];
    expect(grace.graceType).toBe(model.GraceType.OnBeat);
    expect(noteOns(score)).toContain('1920:64');
  });
});
