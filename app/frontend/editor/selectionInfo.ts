import type { ScoreSelection } from '../Player';
import type { Score } from '../music/score';
import type { MusicXmlPreview } from '../music/musicxml';
import { inspectMusicXmlDuration, inspectMusicXmlNoteTechniques, inspectMusicXmlTie, inspectMusicXmlTransitions, inspectMusicXmlTriplet,
  type NoteTechniqueInfo, type NoteTransition, type TiePosition } from '../music/musicxml-editor';
import { midiName } from './labels';

export function tiePosition(selection: ScoreSelection): TiePosition {
  return { measure: selection.measure - 1, beat: selection.event - 1, voice: selection.voice,
    string: selection.string!, fret: selection.fret! };
}

// Everything the inspector, toolbar, menus and status bar show about the
// current selection, derived from the score without side effects.
export function inspectSelection(selection: ScoreSelection | null, preview: MusicXmlPreview | null, score: Score,
  moveString: string, moveMode: 'fret' | 'pitch') {
  const selectedBeats = selection ? preview?.score.tracks?.[0]?.staves?.[0]?.bars?.[selection.measure - 1]?.voices?.[selection.voice - 1]?.beats : undefined;
  const selectedDetails = (() => {
    if (!selection) return null;
    const gcd = (left: number, right: number): number => right ? gcd(right, left % right) : left;
    let numerator = 0; let denominator = 1; let pitch: number | null = null; const staff = preview?.score.tracks?.[0]?.staves?.[0];
    // Sounding open strings: pitches below come from sounding note values.
    const tuning = preview ? (staff?.tuning ?? []).map(value => value + (staff?.capo ?? 0)) : score.tuning;
    if (preview) {
      const beat = selectedBeats?.[selection.event - 1];
      if (!beat) return null;
      const ticks = Math.round(beat.playbackStart);
      const divisor = gcd(ticks, 960) || 960;
      numerator = ticks / divisor; denominator = 960 / divisor;
      const note = beat.notes.find(item => selection.string !== null && 6 - item.string === selection.string);
      pitch = note ? note.realValue : null;
    } else {
      const beats = score.measures[selection.measure - 1]?.beats ?? [];
      const sixteenths = beats.slice(0, selection.event - 1).reduce((sum, beat) => sum + 16 / beat.duration, 0);
      const divisor = gcd(sixteenths, 4) || 4;
      numerator = sixteenths / divisor; denominator = 4 / divisor;
      const note = beats[selection.event - 1]?.notes.find(item => item.string === selection.string);
      pitch = note ? tuning[note.string - 1] + note.fret : null;
    }
    const offset = numerator === 0 ? 'Offset 0' : `Offset ${denominator === 1 ? numerator : `${numerator}/${denominator}`} quarter note${numerator / denominator > 1 ? 's' : ''}`;
    let grace: { options: { label: string; event: number }[] } | null = null;
    if (selectedBeats) {
      const index = selection.event - 1;
      let destination = index;
      while (selectedBeats[destination]?.graceType) destination++;
      let start = destination;
      while (start > 0 && selectedBeats[start - 1]?.graceType) start--;
      if (start < destination && selectedBeats[destination]) {
        grace = { options: [...Array.from({ length: destination - start }, (_, at) => ({ label: `Grace ${at + 1}`, event: start + at + 1 })), { label: 'Main', event: destination + 1 }] };
      }
    }
    return { offset, pitch: pitch === null ? 'Rest / empty string' : midiName(pitch), pitchValue: pitch, tuning, grace };
  })();
  const moveOutcome = (() => {
    if (!selection || selection.kind !== 'note' || selection.fret === null || !selectedDetails || selectedDetails.pitchValue === null) return null;
    const destination = Number(moveString);
    if (!Number.isInteger(destination) || destination === selection.string) return null;
    const fret = moveMode === 'fret' ? selection.fret : selectedDetails.pitchValue - selectedDetails.tuning[destination - 1];
    const occupied = preview ? selectedBeats?.[selection.event - 1]?.notes.some(note => 6 - note.string === destination)
      : score.measures[selection.measure - 1]?.beats[selection.event - 1]?.notes.some(note => note.string === destination);
    const reason = occupied ? `String ${destination} already has a note in this event.`
      : !Number.isInteger(fret) || fret < 0 || fret > 36 ? `Keeping the pitch would need fret ${fret} on string ${destination}, outside 0–36.` : null;
    return { destination, fret, pitch: midiName(selectedDetails.tuning[destination - 1] + fret), reason };
  })();
  const selectedEventCount = selection ? (preview
    ? preview.score.tracks?.[0]?.staves?.[0]?.bars?.[selection.measure - 1]?.voices?.[selection.voice - 1]?.beats.length ?? 1
    : score.measures[selection.measure - 1]?.beats.length ?? 1) : 1;
  const selectedRhythm = selection ? preview
    ? inspectMusicXmlDuration(preview.source, { measure: selection.measure - 1, beat: selection.event - 1,
      voice: selection.voice - 1 })
    : { denominator: score.measures[selection.measure - 1]?.beats[selection.event - 1]?.duration ?? null,
      dots: 0, rest: selection.kind === 'rest', reason: undefined } : null;
  const selectedTriplet = selection && preview ? inspectMusicXmlTriplet(preview.source,
    { measure: selection.measure - 1, beat: selection.event - 1, voice: selection.voice - 1 }) : null;
  const selectedTupletLocked = Boolean(selectedTriplet?.triplet || selectedTriplet?.reason);
  const selectedTransitions: NoteTransition[] = (() => {
    if (!selection || !preview || selection.kind !== 'note' || selection.string === null || selection.fret === null) return [];
    try { return inspectMusicXmlTransitions(preview.source, preview.score, tiePosition(selection)).filter(item => item.kind !== 'tie'); }
    catch { return []; }
  })();
  const selectedTie = (() => {
    if (!selection || !preview || selection.kind !== 'note' || selection.string === null || selection.fret === null) return false;
    try { return inspectMusicXmlTie(preview.source, preview.score, tiePosition(selection)).canRemove; }
    catch { return false; }
  })();
  const selectedTechniques: NoteTechniqueInfo | null = (() => {
    if (!selection || selection.kind !== 'note' || selection.string === null || selection.fret === null) return null;
    if (!preview) return { picking: 'none', fretting: 'none', bend: 'none' };
    try { return inspectMusicXmlNoteTechniques(preview.source, preview.score, tiePosition(selection)); }
    catch (failure) {
      const reason = (failure as Error).message;
      return { picking: null, pickingReason: reason, fretting: null, frettingReason: reason, bend: null, bendReason: reason };
    }
  })();
  const selectedHasGrace = Boolean(selection && (selection.graceIndex !== null || selectedBeats?.[selection.event - 2]?.graceType));
  return { selectedBeats, selectedDetails, moveOutcome, selectedEventCount, selectedRhythm, selectedTriplet, selectedTupletLocked, selectedTransitions, selectedTie, selectedTechniques, selectedHasGrace };
}

export type SelectionInfo = ReturnType<typeof inspectSelection>;
