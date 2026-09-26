// A second voice in a measure: added as whole-measure rests, removed while
// it still holds only rests. Staves may number their voices differently
// (a MuseScore export puts TAB in voice 2 under a voice-1 notation staff),
// so a staff's voices are paired by the order they first appear in.
import type { model } from '@coderline/alphatab';
import { durationTime, fillRestTime, rationalTime } from '../../editor/rhythm';
import { child, children, directMeasures, parseDocument, readDocument, scorePart, sourceTabStaff, text } from './xml';
import { makeRest, sourceDivisions } from './time';

const voiceOf = (note: Element) => text(child(note, 'voice')) || '1';
const staffOf = (note: Element) => Number(text(child(note, 'staff')) || '1');

// A staff's voice numbers in the order they first appear in the measure.
export function staffVoices(measure: Element, staff: number): string[] {
  return [...new Set(children(measure).filter(item => item.localName === 'note' && staffOf(item) === staff).map(voiceOf))];
}

function measureContext(source: string, score: model.Score, measureIndex: number) {
  const document = parseDocument(source);
  const part = scorePart(document);
  const measures = part ? directMeasures(part) : [];
  const measure = measures[measureIndex];
  const master = score.masterBars[measureIndex];
  if (!part || !measure || !master || measures.length !== score.masterBars.length) throw new Error('The selected measure cannot be identified safely.');
  const notes = children(measure).filter(item => item.localName === 'note');
  return { document, part, measure, master, notes, tabStaff: sourceTabStaff(document) };
}

// The TAB staff's voice numbers in a measure, first voice first.
export function measureTabVoices(source: string, measureIndex: number): string[] {
  const document = readDocument(source);
  const part = scorePart(document);
  const measure = part ? directMeasures(part)[measureIndex] : undefined;
  return measure ? staffVoices(measure, sourceTabStaff(document)) : [];
}

// Each staff gets a <backup> to the start of the measure and rests that
// fill it in the new voice, placed before the closing barline. Returns the
// new voice number.
export function addMusicXmlVoice(source: string, score: model.Score, measureIndex: number): { source: string; voice: string } {
  const { document, part, measure, master, notes, tabStaff } = measureContext(source, score, measureIndex);
  const staves = [...new Set(notes.map(staffOf))].sort((a, b) => a - b);
  if (staffVoices(measure, tabStaff).length > 1) throw new Error('This measure already has a second voice.');
  if (staves.some(staff => staffVoices(measure, staff).length > 1)) throw new Error('This measure uses other voices, which Playtab does not edit.');
  const voice = String(Math.max(0, ...notes.map(note => Number(voiceOf(note)) || 1)) + 1);
  const capacity = rationalTime(BigInt(master.timeSignatureNumerator) * 4n, BigInt(master.timeSignatureDenominator));
  const divisions = sourceDivisions(part, measureIndex);
  const rests = fillRestTime(capacity);
  const ticks = (value: readonly [bigint, bigint]) => value[0] * divisions / value[1];
  if (!rests.length || rests.some(rest => (durationTime(rest)[0] * divisions) % durationTime(rest)[1] !== 0n)) {
    throw new Error('This measure needs finer MusicXML timing to hold a second voice.');
  }
  const closing = children(measure).find(item => item.localName === 'barline' && item.getAttribute('location') === 'right') ?? null;
  for (const staff of staves.length ? staves : [tabStaff]) {
    const backup = document.createElement('backup');
    const duration = document.createElement('duration');
    duration.textContent = String(ticks(capacity));
    backup.appendChild(duration);
    measure.insertBefore(backup, closing);
    for (const rest of rests) measure.insertBefore(makeRest(document, voice, staff, rest, ticks(durationTime(rest))), closing);
  }
  return { source: new XMLSerializer().serializeToString(document), voice };
}

// Removes each staff's second voice and the <backup> before each of its
// runs, so the measure reads as it did before the voice was added.
export function removeMusicXmlVoice(source: string, score: model.Score, measureIndex: number): string {
  const { document, measure, notes, tabStaff } = measureContext(source, score, measureIndex);
  if (staffVoices(measure, tabStaff).length < 2) throw new Error('This measure has no second voice.');
  const second = notes.filter(note => staffVoices(measure, staffOf(note)).indexOf(voiceOf(note)) === 1);
  if (second.some(note => !child(note, 'rest'))) throw new Error('Clear the second voice to rests before removing it.');
  for (const note of second) {
    const siblings = children(measure);
    const previous = siblings[siblings.indexOf(note) - 1];
    if (previous?.localName === 'backup') measure.removeChild(previous);
    measure.removeChild(note);
  }
  return new XMLSerializer().serializeToString(document);
}
