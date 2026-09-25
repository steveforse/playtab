// Exact rational timing, measure timelines, rhythm lanes and divisions.
import { rationalTime, type DurationDenominator, type RationalTime } from '../../editor/rhythm';
import { child, children, descendants, directMeasures, readDocument, removeChildren, scorePart, setText, text } from './xml';
import { linkedStaffNotes, sourceBeatGroups } from './records';

export type Rational = readonly [bigint, bigint];

export const rational = (numerator: bigint, denominator = 1n): Rational => {
  if (denominator <= 0n) throw new Error('The source has invalid timing divisions.');
  const gcd = (left: bigint, right: bigint): bigint => right === 0n ? left : gcd(right, left % right);
  const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator) || 1n;
  return [numerator / divisor, denominator / divisor];
};

export const addTime = (left: Rational, right: Rational): Rational => rational(left[0] * right[1] + right[0] * left[1], left[1] * right[1]);

export const subtractTime = (left: Rational, right: Rational): Rational => rational(left[0] * right[1] - right[0] * left[1], left[1] * right[1]);

export const timeGreater = (left: Rational, right: Rational) => left[0] * right[1] > right[0] * left[1];

export function timingBoundary(document: Document, measureIndex: number, staff: number, voice: string, event?: Element[]): string | null {
  const part = scorePart(document);
  if (!part) return 'This source has no playable part.';
  const measures = directMeasures(part);
  if (!measures[measureIndex]) return 'This source measure cannot be found.';
  let divisions = 1n;
  let expected: Rational = [4n, 1n];
  for (let index = 0; index <= measureIndex; index++) {
    const measure = measures[index];
    let position: Rational = [0n, 1n];
    let furthest: Rational = [0n, 1n];
    const previous = new Map<string, Rational>();
    for (const item of children(measure)) {
      if (item.localName === 'attributes') {
        const divisionText = text(child(item, 'divisions'));
        if (divisionText) {
          if (!/^\d+$/.test(divisionText) || BigInt(divisionText) === 0n) return 'This source has invalid timing divisions.';
          divisions = BigInt(divisionText);
        }
        const time = child(item, 'time');
        if (time) {
          const beats = text(child(time, 'beats'));
          const beatType = text(child(time, 'beat-type'));
          if (!/^\d+$/.test(beats) || !/^\d+$/.test(beatType) || BigInt(beatType) === 0n) return 'This time signature is not supported for structural edits.';
          expected = rational(BigInt(beats) * 4n, BigInt(beatType));
        }
      }
      const durationText = text(child(item, 'duration'));
      const duration = /^\d+$/.test(durationText) ? rational(BigInt(durationText), divisions) : rational(0n);
      if (item.localName === 'backup') { position = subtractTime(position, duration); continue; }
      if (item.localName === 'forward') { position = addTime(position, duration); continue; }
      if (item.localName !== 'note') continue;
      const itemStaff = Number(text(child(item, 'staff')) || '1');
      const itemVoice = text(child(item, 'voice')) || '1';
      const lane = `${itemStaff}:${itemVoice}`;
      const chord = Boolean(child(item, 'chord'));
      const grace = Boolean(child(item, 'grace'));
      const onset = chord ? previous.get(lane) ?? position : position;
      previous.set(lane, onset);
      if (index === measureIndex && itemStaff === staff && itemVoice === voice && !grace) {
        const end = addTime(onset, duration);
        if (timeGreater(end, furthest)) furthest = end;
      }
      if (!chord && !grace) position = addTime(position, duration);
    }
    if (index === measureIndex && timeGreater(furthest, expected)) {
      return 'This voice extends past the measure boundary. Correcting a fret is safe, but structural edits here are blocked until the timing is repaired.';
    }
  }
  if (event?.some(note => {
    const modification = child(note, 'time-modification');
    if (!modification) return false;
    return text(child(modification, 'actual-notes')) !== '3' || text(child(modification, 'normal-notes')) !== '2';
  })) return 'This event uses an unsupported tuplet. Correcting a fret is safe, but structural edits to its timing are blocked.';
  return null;
}

export function musicXmlTimingBoundary(source: string, position: { measure: number; staff: number; voice: string; event?: number }): string | null {
  const document = readDocument(source);
  const part = scorePart(document);
  const measure = part ? directMeasures(part)[position.measure] : undefined;
  const group = measure && position.event !== undefined ? sourceBeatGroups(measure, position.staff, position.voice)[position.event] : undefined;
  return timingBoundary(document, position.measure, position.staff, position.voice, group);
}

export type RhythmPosition = { measure: number; beat: number; voice: number };

export function sourceDivisions(part: Element, measureIndex: number): bigint {
  let divisions = 1n;
  directMeasures(part).slice(0, measureIndex + 1).forEach((measure, index) => {
    const found = children(measure).filter(item => item.localName === 'attributes').flatMap(item => children(item).filter(child => child.localName === 'divisions'));
    if (index === measureIndex && found.length > 1) throw new Error('This measure changes divisions internally; rhythm editing is not available here.');
    for (const item of found) {
      if (!/^\d+$/.test(text(item)) || BigInt(text(item)) === 0n) throw new Error('This source has invalid timing divisions.');
      divisions = BigInt(text(item));
    }
  });
  return divisions;
}

export function setMeasureDivisions(measure: Element, divisions: bigint) {
  let attributes = children(measure).find(item => item.localName === 'attributes');
  if (!attributes) {
    attributes = measure.ownerDocument!.createElement('attributes');
    measure.insertBefore(attributes, measure.firstChild);
  }
  let value = child(attributes, 'divisions');
  if (!value) {
    value = measure.ownerDocument!.createElement('divisions');
    attributes.insertBefore(value, attributes.firstChild);
  }
  value.textContent = String(divisions);
}

export function rescaleDivisions(part: Element, measureIndex: number, oldDivisions: bigint, newDivisions: bigint) {
  if (newDivisions === oldDivisions) return;
  if (newDivisions > 1_000_000n || newDivisions % oldDivisions !== 0n) throw new Error('This rhythm needs unsupported MusicXML timing precision.');
  const measures = directMeasures(part);
  const measure = measures[measureIndex];
  const multiplier = newDivisions / oldDivisions;
  const durationNodes = descendants(measure, 'duration');
  for (const duration of durationNodes) {
    const parent = duration.parentNode as Element;
    if (!['note', 'backup', 'forward'].includes(parent.localName)) throw new Error('This measure has an unsupported timed source element.');
    if (!/^\d+$/.test(text(duration))) throw new Error('This measure has an invalid source duration.');
  }
  const offsets = descendants(measure, 'offset');
  for (const offset of offsets) {
    if (!/^-?\d+$/.test(text(offset))) throw new Error('This measure has an unsupported direction offset.');
  }
  durationNodes.forEach(node => { node.textContent = String(BigInt(text(node)) * multiplier); });
  offsets.forEach(node => { node.textContent = String(BigInt(text(node)) * multiplier); });
  setMeasureDivisions(measure, newDivisions);
  const next = measures[measureIndex + 1];
  if (next && !children(next).some(item => item.localName === 'attributes' && child(item, 'divisions'))) {
    setMeasureDivisions(next, oldDivisions);
  }
}

export function eventTime(group: Element[], divisions: bigint): RationalTime {
  const values = group.map(note => text(child(note, 'duration')));
  if (values.some(value => !/^\d+$/.test(value))) throw new Error('This event has an unsupported source duration.');
  if (new Set(values).size !== 1) throw new Error('This chord has inconsistent member durations.');
  return rationalTime(BigInt(values[0]), divisions);
}

export function simpleRest(group: Element[]) {
  return group.length === 1 && Boolean(child(group[0], 'rest'))
    && children(group[0]).every(item => ['rest', 'duration', 'voice', 'type', 'dot', 'staff'].includes(item.localName))
    && !child(group[0], 'time-modification');
}

export function writeDuration(group: Element[], denominator: DurationDenominator, dotted: boolean, ticks: bigint) {
  group.forEach(note => {
    setText(note, 'duration', String(ticks));
    let type = child(note, 'type');
    if (!type) {
      type = note.ownerDocument!.createElement('type');
      const next = children(note).find(item => ['dot', 'accidental', 'stem', 'staff', 'notations', 'lyric', 'time-modification'].includes(item.localName));
      note.insertBefore(type, next ?? null);
    }
    type.textContent = ({ 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd', 64: '64th' } as Record<number, string>)[denominator];
    removeChildren(note, 'dot');
    if (dotted) note.insertBefore(note.ownerDocument!.createElement('dot'), type.nextSibling);
  });
}

export function makeRest(document: Document, voice: string, staff: number, denominator: DurationDenominator, ticks: bigint) {
  const note = document.createElement('note');
  const add = (name: string, value?: string) => {
    const element = document.createElement(name);
    if (value !== undefined) element.textContent = value;
    note.appendChild(element);
  };
  add('rest'); add('duration', String(ticks)); add('voice', voice);
  add('type', ({ 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd', 64: '64th' } as Record<number, string>)[denominator]);
  add('staff', String(staff));
  return note;
}

export function rhythmLanes(document: Document, measure: Element, tabStaff: number, voice: string, eventIndex: number) {
  const tabGroups = sourceBeatGroups(measure, tabStaff, voice);
  const target = tabGroups[eventIndex];
  if (!target) throw new Error('The selected source event cannot be identified safely.');
  const lanes = [{ staff: tabStaff, voice, groups: tabGroups }];
  const otherStaves = [...new Set(children(measure).filter(item => item.localName === 'note').map(note => Number(text(child(note, 'staff')) || '1')))]
    .filter(staff => staff !== tabStaff);
  if (!otherStaves.length) return lanes;
  const anchor = tabGroups.flat().find(note => !child(note, 'rest') && !child(note, 'grace'));
  const linked = anchor ? linkedStaffNotes(document)(anchor) : [];
  for (const staff of otherStaves) {
    const counterpart = linked.find(note => Number(text(child(note, 'staff')) || '1') === staff);
    const candidateVoices = [...new Set(children(measure).filter(note => note.localName === 'note'
      && Number(text(child(note, 'staff')) || '1') === staff).map(note => text(child(note, 'voice')) || '1'))];
    const matchingRestVoices = anchor ? [] : candidateVoices.filter(candidateVoice => {
      const groups = sourceBeatGroups(measure, staff, candidateVoice);
      return groups.length === tabGroups.length && groups.every((group, index) => simpleRest(group)
        && text(child(group[0], 'duration')) === text(child(tabGroups[index][0], 'duration')));
    });
    if (!counterpart && matchingRestVoices.length !== 1) throw new Error('The paired notation voice cannot be matched safely for rhythm editing.');
    const pairedVoice = counterpart ? text(child(counterpart, 'voice')) || '1' : matchingRestVoices[0];
    const groups = sourceBeatGroups(measure, staff, pairedVoice);
    if (groups.length !== tabGroups.length || !groups[eventIndex]) throw new Error('The paired notation events do not align safely for rhythm editing.');
    lanes.push({ staff, voice: pairedVoice, groups });
  }
  return lanes;
}

export function measureTimeline(part: Element, measureIndex: number) {
  const measure = directMeasures(part)[measureIndex];
  const divisions = sourceDivisions(part, measureIndex);
  const onsets = new Map<Element, Rational>();
  let position = rational(0n);
  let last = position;
  const amount = (item: Element, name: string) => {
    const value = text(child(item, name));
    return /^-?\d+$/.test(value) ? rational(BigInt(value), divisions) : value ? null : rational(0n);
  };
  for (const item of children(measure)) {
    if (item.localName === 'backup' || item.localName === 'forward') {
      const duration = amount(item, 'duration') ?? rational(0n);
      position = item.localName === 'backup' ? subtractTime(position, duration) : addTime(position, duration);
    } else if (item.localName === 'harmony' || item.localName === 'direction') {
      const offset = amount(item, 'offset');
      if (offset) onsets.set(item, addTime(position, offset));
    } else if (item.localName === 'note') {
      const start = child(item, 'chord') ? last : position;
      onsets.set(item, start);
      last = start;
      if (!child(item, 'chord') && !child(item, 'grace')) position = addTime(position, amount(item, 'duration') ?? rational(0n));
    }
  }
  return { measure, onsets };
}

export const sameTime = (left: Rational | undefined, right: Rational) => Boolean(left && left[0] * right[1] === right[0] * left[1]);
