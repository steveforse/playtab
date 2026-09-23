import { midi, model, Settings } from '@coderline/alphatab';
import type { ScoreSelection } from '../Player';

export type PlaybackEndpoints = { start: ScoreSelection; end: ScoreSelection };
export type TickRange = { startTick: number; endTick: number };

export function scoreHasRepeats(score: model.Score): boolean {
  return score.masterBars.some(bar => bar.isRepeatStart || bar.repeatCount > 0 || bar.alternateEndings > 0);
}

function eventSpan(score: model.Score, selection: ScoreSelection): { beat: model.Beat; start: number } | null {
  const beats = score.tracks[selection.track - 1]?.staves[selection.staff - 1]?.bars[selection.measure - 1]?.voices[selection.voice - 1]?.beats;
  const selected = beats?.[selection.event - 1];
  if (!selected) return null;
  const beat = selected.graceType ? beats?.slice(selection.event).find(candidate => !candidate.graceType) : selected;
  if (!beat) return null;
  let start = beat.playbackStart;
  if (selected.graceType) {
    for (let index = beats!.indexOf(beat) - 1; index >= 0 && beats![index].graceType; index--) {
      start = Math.min(start, beats![index].playbackStart);
    }
  }
  return { beat, start };
}

export function writtenPlaybackRange(score: model.Score, endpoints: PlaybackEndpoints): TickRange | null {
  const first = eventSpan(score, endpoints.start);
  const last = eventSpan(score, endpoints.end);
  if (!first || !last) return null;
  const startTick = score.masterBars[first.beat.voice.bar.index]?.start + first.start;
  const endTick = score.masterBars[last.beat.voice.bar.index]?.start + last.beat.playbackStart + last.beat.playbackDuration;
  if (!Number.isFinite(startTick) || !Number.isFinite(endTick) || endTick <= startTick) return null;
  return { startTick, endTick };
}

// alphaTab's normal MIDI expands repeats. An audition instead follows written
// measures exactly once; never alter the score used for notation or export.
export function linearAuditionMidi(score: model.Score): midi.MidiFile {
  const copy = model.JsonConverter.jsObjectToScore(model.JsonConverter.scoreToJsObject(score));
  for (const bar of copy.masterBars) {
    bar.isRepeatStart = false;
    bar.repeatCount = 0;
    bar.alternateEndings = 0;
  }
  copy.rebuildRepeatGroups();
  const file = new midi.MidiFile();
  new midi.MidiFileGenerator(copy, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
  return file;
}
