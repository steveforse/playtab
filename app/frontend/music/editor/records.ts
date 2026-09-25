// Source records: TAB notes, paired-staff links and per-voice beat groups.
import type { model } from '@coderline/alphatab';
import { derived, readSourceDocument } from '../xml-cache';
import { child, children, directMeasures, scorePart, sourceTabStaff, text } from './xml';

export const recordCache = new WeakMap<Document, ReturnType<typeof computeTabNoteRecords>>();

export function sourceTabNoteRecords(document: Document) {
  return derived(recordCache, document, () => computeTabNoteRecords(document));
}

export function computeTabNoteRecords(document: Document) {
  const staff = sourceTabStaff(document);
  const part = scorePart(document);
  if (!part) return [];
  return directMeasures(part).flatMap((measure, measureIndex) => {
    const eventByVoice = new Map<string, number>();
    const memberByVoice = new Map<string, number>();
    const graceGroupByVoice = new Map<string, number>();
    const graceIndexByVoice = new Map<string, number>();
    const graceActiveByVoice = new Map<string, boolean>();
    return children(measure).filter(note => note.localName === 'note')
      .filter(note => Number(text(child(note, 'staff')) || '1') === staff)
      .flatMap(note => {
        const voice = text(child(note, 'voice')) || '1';
        const chord = Boolean(child(note, 'chord'));
        const grace = Boolean(child(note, 'grace')) || (chord && graceActiveByVoice.get(voice) === true);
        if (!chord) {
          eventByVoice.set(voice, (eventByVoice.get(voice) ?? -1) + 1);
          memberByVoice.set(voice, 0);
          if (grace) {
            if (!graceActiveByVoice.get(voice)) graceGroupByVoice.set(voice, (graceGroupByVoice.get(voice) ?? -1) + 1);
            graceIndexByVoice.set(voice, graceActiveByVoice.get(voice) ? (graceIndexByVoice.get(voice) ?? -1) + 1 : 0);
          }
          graceActiveByVoice.set(voice, grace);
        } else memberByVoice.set(voice, (memberByVoice.get(voice) ?? 0) + 1);
        const technical = child(child(note, 'notations') ?? note, 'technical');
        if (!technical || !child(technical, 'string')) return [];
        const event = eventByVoice.get(voice) ?? 0;
        const string = Number(text(child(technical, 'string')));
        const chordMember = memberByVoice.get(voice) ?? 0;
        const graceGroup = grace ? graceGroupByVoice.get(voice) ?? 0 : null;
        const graceIndex = grace ? graceIndexByVoice.get(voice) ?? 0 : null;
        return [{ note, measure: measureIndex, beat: eventByVoice.get(voice) ?? 0,
          voice, string, fret: Number(text(child(technical, 'fret'))), grace, graceGroup, graceIndex, chordMember,
          id: `${measureIndex}:${voice}:${event}:${graceGroup ?? 'main'}:${graceIndex ?? 'main'}:${string}` }];
      });
  });
}

export function sourceTabNotes(document: Document) { return sourceTabNoteRecords(document).map(record => record.note); }

// Match the original source before either representation is changed. Use
// musical position and pitch, never parallel note-array indexes: chords may
// be written in a different order on the two staves.
export const linkedCache = new WeakMap<Document, (note: Element) => Element[]>();

export function linkedStaffNotes(document: Document) {
  return derived(linkedCache, document, () => computeLinkedStaffNotes(document));
}

export function computeLinkedStaffNotes(document: Document) {
  type Fraction = [number, number];
  const fraction = (n: number, d = 1): Fraction => {
    const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
    const divisor = gcd(Math.abs(n), d) || 1;
    return [n / divisor, d / divisor];
  };
  const add = (a: Fraction, b: Fraction): Fraction => fraction(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
  const keyFor = new Map<Element, string>();
  const byStaff = new Map<number, Map<string, Element[]>>();
  const part = scorePart(document);
  let divisions = 1;
  for (const [measureIndex, measure] of (part ? directMeasures(part) : []).entries()) {
    let position: Fraction = [0, 1];
    const previous = new Map<string, Fraction>();
    const graceCounts = new Map<string, number>();
    for (const item of children(measure)) {
      if (item.localName === 'attributes') divisions = Number(text(child(item, 'divisions'))) || divisions;
      const duration = fraction(Number(text(child(item, 'duration'))) || 0, divisions);
      if (item.localName === 'backup' || item.localName === 'forward') {
        position = add(position, [duration[0] * (item.localName === 'backup' ? -1 : 1), duration[1]]);
      }
      if (item.localName !== 'note') continue;
      const staff = Number(text(child(item, 'staff')) || '1');
      const voice = text(child(item, 'voice')) || '1';
      const lane = `${staff}:${voice}`;
      const onset = child(item, 'chord') ? previous.get(lane) ?? position : position;
      previous.set(lane, onset);
      const grace = Boolean(child(item, 'grace'));
      const graceKey = `${lane}:${onset.join('/')}`;
      if (grace && !child(item, 'chord')) graceCounts.set(graceKey, (graceCounts.get(graceKey) ?? 0) + 1);
      if (!grace && !child(item, 'chord')) position = add(position, duration);
      const pitch = child(item, 'pitch');
      if (!pitch) continue;
      const pitchValue = (Number(text(child(pitch, 'octave'))) + 1) * 12
        + ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[text(child(pitch, 'step'))] ?? 0)
        + Number(text(child(pitch, 'alter')) || 0);
      const key = `${measureIndex}:${onset.join('/')}:${duration.join('/')}:${grace ? graceCounts.get(graceKey) : 'main'}:${pitchValue}`;
      keyFor.set(item, key);
      if (!byStaff.has(staff)) byStaff.set(staff, new Map());
      const notes = byStaff.get(staff)!;
      notes.set(key, [...(notes.get(key) ?? []), item]);
    }
  }
  const tabStaff = sourceTabStaff(document);
  return (note: Element): Element[] => {
    const key = keyFor.get(note);
    if (!key) return [];
    const result: Element[] = [];
    for (const [staff, notes] of byStaff) {
      if (staff === tabStaff) continue;
      const candidates = notes.get(key) ?? [];
      if (candidates.length !== 1 || byStaff.get(tabStaff)?.get(key)?.length !== 1) {
        throw new Error('This note cannot be uniquely matched to its paired notation staff.');
      }
      result.push(candidates[0]);
    }
    return result;
  };
}

export function modelNotes(score: model.Score) {
  const tab = score.tracks?.[0]?.staves?.[0];
  return tab?.bars?.flatMap((bar, measure) => bar.voices.flatMap((voice, voiceIndex) => voice.beats.flatMap((beat, beatIndex) => beat.notes.map(note => ({ note, measure, beat: beatIndex, voice: voiceIndex }))))) ?? [];
}

export function sourceBeatGroups(measure: Element, staff: number, voice?: string): Element[][] {
  const groups: Element[][] = [];
  children(measure).filter(item => item.localName === 'note' && Number(text(child(item, 'staff')) || '1') === staff
    && (voice === undefined || (text(child(item, 'voice')) || '1') === voice)).forEach(note => {
    if (child(note, 'chord') && groups.length) groups[groups.length - 1].push(note);
    else groups.push([note]);
  });
  return groups;
}
