// Event durations, inserted events and 3:2 triplets.
import type { model } from '@coderline/alphatab';
import { DURATION_DENOMINATORS, REST_SPACE_ERROR, durationTime, fillRestTime, planDurationChange, rationalTime, compareTime, type DurationDenominator, type RationalTime } from '../../editor/rhythm';
import { child, children, descendants, directMeasures, ensure, parseDocument, readDocument, removeChildren, scorePart, setText, sourceTabStaff, text } from './xml';
import { sourceBeatGroups } from './records';
import { addTime, eventTime, makeRest, rescaleDivisions, rhythmLanes, simpleRest, sourceDivisions, subtractTime, timingBoundary, type RhythmPosition, writeDuration } from './time';
import { protectedNoteAttachment, replaceRestWithNote } from './notes';
import { openTabTuning } from './tuning';

export type MusicXmlDurationInfo = { denominator: DurationDenominator | null; dots: number; rest: boolean; reason?: string };

export function inspectMusicXmlDuration(source: string, position: RhythmPosition): MusicXmlDurationInfo {
  const document = readDocument(source);
  const part = scorePart(document);
  const measure = part && directMeasures(part)[position.measure];
  const group = measure && sourceBeatGroups(measure, sourceTabStaff(document), String(position.voice + 1))[position.beat];
  if (!group) return { denominator: null, dots: 0, rest: false, reason: 'Select an ordinary event to edit its rhythm.' };
  const note = group[0];
  const rest = Boolean(child(note, 'rest'));
  if (group.some(item => child(item, 'grace'))) return { denominator: null, dots: 0, rest, reason: 'Grace durations are edited with their group.' };
  if (group.some(item => child(item, 'time-modification'))) return { denominator: null, dots: 0, rest,
    reason: isThreeTwo(group) ? 'Edit this triplet as a group.' : 'This imported tuplet ratio is preserved; timing editing is unavailable.' };
  const byType: Record<string, DurationDenominator> = { whole: 1, half: 2, quarter: 4, eighth: 8,
    '16th': 16, '32nd': 32, '64th': 64 };
  const denominator = byType[text(child(note, 'type'))] ?? null;
  const dots = children(note).filter(item => item.localName === 'dot').length;
  return { denominator, dots, rest, reason: denominator === null ? 'This imported duration is preserved but cannot be edited with these buttons.'
    : dots > 1 ? 'Imported multiple-dot value is preserved until you choose a supported replacement.' : undefined };
}

export function changeMusicXmlDuration(source: string, score: model.Score, position: RhythmPosition,
  denominator: DurationDenominator, dotted = false): string {
  if (!DURATION_DENOMINATORS.includes(denominator)) throw new Error('Unsupported note duration.');
  const rendered = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice]?.beats?.[position.beat];
  if (!rendered || rendered.graceType) throw new Error('Select an ordinary event to change its duration.');
  const document = parseDocument(source);
  const part = scorePart(document);
  const measure = part && directMeasures(part)[position.measure];
  if (!part || !measure) throw new Error('The source measure cannot be identified safely.');
  const tabStaff = sourceTabStaff(document);
  const voice = String(position.voice + 1);
  const lanes = rhythmLanes(document, measure, tabStaff, voice, position.beat);
  const target = lanes[0].groups[position.beat];
  const sourceMembers = target.filter(note => !child(note, 'rest')).map(note => {
    const technical = child(child(note, 'notations') ?? note, 'technical');
    return `${text(child(technical ?? note, 'string'))}:${text(child(technical ?? note, 'fret'))}`;
  }).sort();
  const renderedMembers = rendered.notes.map(note => `${6 - note.string}:${note.fret}`).sort();
  if (sourceMembers.join('|') !== renderedMembers.join('|') || Boolean(child(target[0], 'rest')) !== Boolean(rendered.isRest)) {
    throw new Error('The selected source event does not match the rendered score. Rhythm editing is blocked here.');
  }
  const boundary = timingBoundary(document, position.measure, tabStaff, voice, target);
  if (boundary) throw new Error(boundary);
  if (target.some(note => child(note, 'grace') || child(note, 'time-modification'))) {
    throw new Error('Edit this tuplet or grace group as a group.');
  }
  const oldDivisions = sourceDivisions(part, position.measure);
  const current = eventTime(target, oldDivisions);
  const desired = durationTime(denominator, dotted);
  if (compareTime(current, desired) === 0 && target.every(note => text(child(note, 'type')) === ({ 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd', 64: '64th' } as Record<number, string>)[denominator]
    && children(note).filter(item => item.localName === 'dot').length === (dotted ? 1 : 0))) return source;
  const following: { duration: RationalTime; rest: boolean }[] = [];
  if (compareTime(desired, current) > 0) {
    for (const group of lanes[0].groups.slice(position.beat + 1)) {
      if (!simpleRest(group)) { following.push({ duration: rationalTime(0n), rest: false }); break; }
      following.push({ duration: eventTime(group, oldDivisions), rest: true });
    }
  }
  const plan = planDurationChange(current, desired, following);
  for (const lane of lanes) {
    const group = lane.groups[position.beat];
    if (compareTime(eventTime(group, oldDivisions), current) !== 0 || Boolean(child(group[0], 'rest')) !== Boolean(child(target[0], 'rest'))
      || group.some(note => child(note, 'grace') || child(note, 'time-modification'))) {
      throw new Error('The paired notation event does not match the selected rhythm.');
    }
    for (let index = 1; index <= plan.consumeRests; index++) {
      const adjacent = lane.groups[position.beat + index];
      if (!adjacent || !simpleRest(adjacent) || compareTime(eventTime(adjacent, oldDivisions), following[index - 1].duration) !== 0) {
        throw new Error('The paired notation rest space does not match this voice.');
      }
    }
  }
  const required = [desired, ...plan.insertRests.map(value => durationTime(value)), ...plan.leaveRests.map(value => durationTime(value))];
  const gcd = (a: bigint, b: bigint): bigint => b ? gcd(b, a % b) : a;
  const lcm = (a: bigint, b: bigint) => a / gcd(a, b) * b;
  const newDivisions = required.reduce((value, time) => lcm(value, time[1]), oldDivisions);
  rescaleDivisions(part, position.measure, oldDivisions, newDivisions);
  const ticks = (time: RationalTime) => {
    const value = time[0] * newDivisions;
    if (value % time[1] !== 0n) throw new Error('This rhythm needs unsupported MusicXML timing precision.');
    return value / time[1];
  };
  for (const lane of lanes) {
    const group = lane.groups[position.beat];
    const consumed = lane.groups.slice(position.beat + 1, position.beat + 1 + plan.consumeRests);
    const last = consumed.at(-1)?.at(-1) ?? group.at(-1)!;
    const reference = last.nextSibling;
    writeDuration(group, denominator, dotted, ticks(desired));
    consumed.flat().forEach(note => note.parentNode?.removeChild(note));
    for (const value of [...plan.insertRests, ...plan.leaveRests]) {
      measure.insertBefore(makeRest(document, lane.voice, lane.staff, value, ticks(durationTime(value))), reference);
    }
  }
  return new XMLSerializer().serializeToString(document);
}

export type InsertEventOptions = RhythmPosition & { placement: 'before' | 'after'; kind: 'note' | 'rest';
  denominator: DurationDenominator; dotted: boolean; string?: number; fret?: number };

export function shiftedEventProtection(group: Element[]): string | null {
  for (const note of group) {
    if (child(note, 'grace') || child(note, 'time-modification')) return 'A grace or tuplet event in the shifted region prevents insertion.';
    if (child(note, 'tie') || child(note, 'beam') || child(note, 'lyric')
      || descendants(note, 'tied').length || descendants(note, 'slide').length
      || descendants(note, 'hammer-on').length || descendants(note, 'pull-off').length) {
      return 'A protected span or annotation in the shifted region prevents insertion.';
    }
    if (protectedNoteAttachment(note)) return 'An unsupported attachment in the shifted region prevents insertion.';
  }
  return null;
}

export function insertMusicXmlEvent(source: string, score: model.Score, options: InsertEventOptions): string {
  const { measure: measureIndex, beat: eventIndex, voice: voiceIndex, placement, kind, denominator, dotted } = options;
  if (!DURATION_DENOMINATORS.includes(denominator)) throw new Error('Unsupported note duration.');
  if (placement !== 'before' && placement !== 'after' || kind !== 'note' && kind !== 'rest') throw new Error('Invalid event insertion choice.');
  if (kind === 'note' && (!Number.isInteger(options.string) || options.string! < 1 || options.string! > 5
    || !Number.isInteger(options.fret) || options.fret! < 0 || options.fret! > 36)) throw new Error('Choose a valid string and fret for the new note.');
  const rendered = score.tracks?.[0]?.staves?.[0]?.bars?.[measureIndex]?.voices?.[voiceIndex]?.beats?.[eventIndex];
  if (!rendered || rendered.graceType) throw new Error('Select an ordinary event before inserting another event.');
  const document = parseDocument(source);
  const part = scorePart(document);
  const measure = part && directMeasures(part)[measureIndex];
  if (!part || !measure) throw new Error('The source measure cannot be identified safely.');
  const tabStaff = sourceTabStaff(document);
  const lanes = rhythmLanes(document, measure, tabStaff, String(voiceIndex + 1), eventIndex);
  const target = lanes[0].groups[eventIndex];
  const sourceMembers = target.filter(note => !child(note, 'rest')).map(note => {
    const technical = child(child(note, 'notations') ?? note, 'technical');
    return `${text(child(technical ?? note, 'string'))}:${text(child(technical ?? note, 'fret'))}`;
  }).sort();
  if (sourceMembers.join('|') !== rendered.notes.map(note => `${6 - note.string}:${note.fret}`).sort().join('|')
    || Boolean(child(target[0], 'rest')) !== Boolean(rendered.isRest)) {
    throw new Error('The selected source event does not match the rendered score.');
  }
  const boundary = timingBoundary(document, measureIndex, tabStaff, String(voiceIndex + 1), target);
  if (boundary) throw new Error(boundary);
  const insertIndex = eventIndex + (placement === 'after' ? 1 : 0);
  const oldDivisions = sourceDivisions(part, measureIndex);
  const desired = durationTime(denominator, dotted);
  const tail: number[] = [];
  let available = rationalTime(0n);
  for (let index = lanes[0].groups.length - 1; index >= insertIndex; index--) {
    const group = lanes[0].groups[index];
    if (!simpleRest(group)) break;
    tail.unshift(index);
    available = addTime(available, eventTime(group, oldDivisions));
    if (compareTime(available, desired) >= 0) break;
  }
  if (compareTime(available, desired) < 0) throw new Error(REST_SPACE_ERROR);
  const remaining = subtractTime(available, desired);
  const replacementRests = fillRestTime(remaining);
  for (const lane of lanes) {
    if (lane.groups.length !== lanes[0].groups.length) throw new Error('The paired notation events do not align safely for insertion.');
    for (let index = insertIndex; index < lane.groups.length; index++) {
      const group = lane.groups[index];
      if (eventTime(group, oldDivisions)[0] !== eventTime(lanes[0].groups[index], oldDivisions)[0]
        || eventTime(group, oldDivisions)[1] !== eventTime(lanes[0].groups[index], oldDivisions)[1]
        || Boolean(child(group[0], 'rest')) !== Boolean(child(lanes[0].groups[index][0], 'rest'))) {
        throw new Error('The paired notation events do not align safely for insertion.');
      }
      const protection = shiftedEventProtection(group);
      if (protection) throw new Error(protection);
    }
    for (const index of tail) if (!simpleRest(lane.groups[index])) throw new Error('The paired notation rest space does not match this voice.');
    const first = lane.groups[insertIndex]?.[0];
    const last = lane.groups[tail.at(-1)!].at(-1)!;
    if (first) {
      let cursor: Node | null = first;
      while (cursor && cursor !== last) {
        if (cursor.nodeType === 1) {
          const element = cursor as Element;
          if (element.localName !== 'note' || Number(text(child(element, 'staff')) || '1') !== lane.staff
            || (text(child(element, 'voice')) || '1') !== lane.voice) {
            throw new Error('Interleaved source timing or metadata prevents shifting this voice safely.');
          }
        }
        cursor = cursor.nextSibling;
      }
      if (!cursor) throw new Error('The source voice cannot be shifted safely.');
    }
  }
  const midi = kind === 'note' ? openTabTuning(score)[options.string! - 1] + options.fret! : null;
  if (kind === 'note' && !Number.isInteger(midi)) throw new Error('The selected string has no valid source tuning.');
  const gcd = (a: bigint, b: bigint): bigint => b ? gcd(b, a % b) : a;
  const lcm = (a: bigint, b: bigint) => a / gcd(a, b) * b;
  const newDivisions = [desired, ...replacementRests.map(value => durationTime(value))]
    .reduce((value, time) => lcm(value, time[1]), oldDivisions);
  rescaleDivisions(part, measureIndex, oldDivisions, newDivisions);
  const ticks = (time: RationalTime) => time[0] * newDivisions / time[1];
  for (const lane of lanes) {
    const before = lane.groups[insertIndex]?.[0] ?? lane.groups.at(-1)!.at(-1)!.nextSibling;
    const trailing = lane.groups[tail.at(-1)!].at(-1)!.nextSibling;
    const inserted = makeRest(document, lane.voice, lane.staff, denominator, ticks(desired));
    writeDuration([inserted], denominator, dotted, ticks(desired));
    if (kind === 'note') replaceRestWithNote(inserted, midi!, lane.staff === tabStaff ? options.string : undefined,
      lane.staff === tabStaff ? options.fret : undefined);
    measure.insertBefore(inserted, before);
    tail.flatMap(index => lane.groups[index]).forEach(note => note.parentNode?.removeChild(note));
    for (const value of replacementRests) measure.insertBefore(makeRest(document, lane.voice, lane.staff,
      value, ticks(durationTime(value))), trailing);
  }
  return new XMLSerializer().serializeToString(document);
}

export const durationTypes: Record<string, DurationDenominator> = { whole: 1, half: 2, quarter: 4, eighth: 8,
  '16th': 16, '32nd': 32, '64th': 64 };

export function setTripletRatio(note: Element, childDenominator: DurationDenominator) {
  let modification = child(note, 'time-modification');
  if (!modification) {
    modification = note.ownerDocument!.createElement('time-modification');
    note.insertBefore(modification, child(note, 'staff') ?? child(note, 'notations') ?? null);
  }
  setText(modification, 'actual-notes', '3');
  setText(modification, 'normal-notes', '2');
  setText(modification, 'normal-type', ({ 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth',
    16: '16th', 32: '32nd', 64: '64th' } as Record<number, string>)[childDenominator]);
}

export function setTupletMarker(note: Element, type: 'start' | 'stop') {
  const notations = ensure(note, 'notations');
  const tuplet = note.ownerDocument!.createElement('tuplet');
  tuplet.setAttribute('number', '1');
  tuplet.setAttribute('type', type);
  notations.appendChild(tuplet);
}

export function createMusicXmlTriplet(source: string, score: model.Score, position: RhythmPosition): string {
  const rendered = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice]?.beats?.[position.beat];
  if (!rendered || rendered.graceType) throw new Error('Select an ordinary event to make a triplet.');
  const document = parseDocument(source);
  const part = scorePart(document);
  const measure = part && directMeasures(part)[position.measure];
  if (!part || !measure) throw new Error('The source measure cannot be identified safely.');
  const tabStaff = sourceTabStaff(document);
  const lanes = rhythmLanes(document, measure, tabStaff, String(position.voice + 1), position.beat);
  const target = lanes[0].groups[position.beat];
  const boundary = timingBoundary(document, position.measure, tabStaff, String(position.voice + 1), target);
  if (boundary) throw new Error(boundary);
  const sourceMembers = target.filter(note => !child(note, 'rest')).map(note => {
    const technical = child(child(note, 'notations') ?? note, 'technical');
    return `${text(child(technical ?? note, 'string'))}:${text(child(technical ?? note, 'fret'))}`;
  }).sort();
  if (sourceMembers.join('|') !== rendered.notes.map(note => `${6 - note.string}:${note.fret}`).sort().join('|')
    || Boolean(child(target[0], 'rest')) !== Boolean(rendered.isRest)) {
    throw new Error('The selected source event does not match the rendered score.');
  }
  if (target.some(note => child(note, 'grace') || child(note, 'time-modification'))) {
    throw new Error('Edit this triplet or grace group as a group.');
  }
  const denominator = durationTypes[text(child(target[0], 'type'))];
  if (!denominator || target.some(note => children(note).some(item => item.localName === 'dot'))
    || target.some(note => child(note, 'duration') === undefined)) {
    throw new Error('Triplet requires an undotted ordinary event with a supported duration.');
  }
  if (denominator === 64) throw new Error('Triplet children cannot be shorter than 1/64.');
  const childDenominator = (denominator * 2) as DurationDenominator;
  const oldDivisions = sourceDivisions(part, position.measure);
  const parentTime = eventTime(target, oldDivisions);
  if (compareTime(parentTime, durationTime(denominator)) !== 0) throw new Error('The selected source duration does not match its notation.');
  for (const lane of lanes) {
    const group = lane.groups[position.beat];
    if (compareTime(eventTime(group, oldDivisions), parentTime) !== 0
      || Boolean(child(group[0], 'rest')) !== Boolean(child(target[0], 'rest'))
      || group.some(note => child(note, 'grace') || child(note, 'time-modification') || children(note).some(item => item.localName === 'dot'))) {
      throw new Error('The paired notation event cannot be converted to the same triplet.');
    }
  }
  const childTime = rationalTime(parentTime[0], parentTime[1] * 3n);
  const gcd = (a: bigint, b: bigint): bigint => b ? gcd(b, a % b) : a;
  const newDivisions = oldDivisions / gcd(oldDivisions, childTime[1]) * childTime[1];
  rescaleDivisions(part, position.measure, oldDivisions, newDivisions);
  const ticks = childTime[0] * newDivisions / childTime[1];
  for (const lane of lanes) {
    const group = lane.groups[position.beat];
    const reference = group.at(-1)!.nextSibling;
    writeDuration(group, childDenominator, false, ticks);
    group.forEach(note => setTripletRatio(note, childDenominator));
    setTupletMarker(group[0], 'start');
    for (let childIndex = 1; childIndex <= 2; childIndex++) {
      const rest = makeRest(document, lane.voice, lane.staff, childDenominator, ticks);
      setTripletRatio(rest, childDenominator);
      if (childIndex === 2) setTupletMarker(rest, 'stop');
      measure.insertBefore(rest, reference);
    }
  }
  return new XMLSerializer().serializeToString(document);
}

export function isThreeTwo(group: Element[]) {
  return group.length > 0 && group.every(note => {
    const modification = child(note, 'time-modification');
    return modification && text(child(modification, 'actual-notes')) === '3'
      && text(child(modification, 'normal-notes')) === '2';
  });
}

export function tripletStart(groups: Element[][], selected: number): number | null {
  if (!isThreeTwo(groups[selected] ?? [])) return null;
  for (let index = selected; index >= Math.max(0, selected - 2); index--) {
    if (groups[index].some(note => descendants(note, 'tuplet').some(marker => marker.getAttribute('type') === 'start'))) {
      return groups.slice(index, index + 3).every(isThreeTwo) && selected < index + 3 ? index : null;
    }
  }
  let runStart = selected;
  while (runStart > 0 && isThreeTwo(groups[runStart - 1])) runStart--;
  const start = runStart + Math.floor((selected - runStart) / 3) * 3;
  return groups.slice(start, start + 3).length === 3 && groups.slice(start, start + 3).every(isThreeTwo) ? start : null;
}

export function removableTripletRest(group: Element[]): boolean {
  if (group.length !== 1 || !child(group[0], 'rest') || !isThreeTwo(group)) return false;
  const note = group[0];
  if (children(note).some(item => !['rest', 'duration', 'voice', 'type', 'time-modification', 'staff', 'notations'].includes(item.localName))) return false;
  const notations = child(note, 'notations');
  return !notations || children(notations).every(item => item.localName === 'tuplet');
}

export type MusicXmlTripletInfo = { triplet: boolean; canRemove: boolean; start?: number; reason?: string };

export function inspectMusicXmlTriplet(source: string, position: RhythmPosition): MusicXmlTripletInfo {
  const document = readDocument(source);
  const part = scorePart(document);
  const measure = part && directMeasures(part)[position.measure];
  const groups = measure ? sourceBeatGroups(measure, sourceTabStaff(document), String(position.voice + 1)) : [];
  const selected = groups[position.beat];
  if (!selected) return { triplet: false, canRemove: false, reason: 'Select an ordinary event.' };
  if (selected.some(note => child(note, 'time-modification')) && !isThreeTwo(selected)) {
    return { triplet: false, canRemove: false, reason: 'This imported tuplet ratio is preserved; timing editing is unavailable.' };
  }
  const start = tripletStart(groups, position.beat);
  if (start === null) return { triplet: false, canRemove: false };
  if (!removableTripletRest(groups[start + 1]) || !removableTripletRest(groups[start + 2])) {
    return { triplet: true, canRemove: false, start,
      reason: 'Remove the last two notes or protected attachments before removing this triplet.' };
  }
  return { triplet: true, canRemove: true, start };
}

export function removeMusicXmlTriplet(source: string, score: model.Score, position: RhythmPosition): string {
  const rendered = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice]?.beats?.[position.beat];
  if (!rendered || rendered.graceType) throw new Error('Select a triplet child to remove its group.');
  const document = parseDocument(source);
  const part = scorePart(document);
  const measure = part && directMeasures(part)[position.measure];
  if (!part || !measure) throw new Error('The source measure cannot be identified safely.');
  const tabStaff = sourceTabStaff(document);
  const lanes = rhythmLanes(document, measure, tabStaff, String(position.voice + 1), position.beat);
  const selected = lanes[0].groups[position.beat];
  const selectedMembers = selected.filter(note => !child(note, 'rest')).map(note => {
    const technical = child(child(note, 'notations') ?? note, 'technical');
    return `${text(child(technical ?? note, 'string'))}:${text(child(technical ?? note, 'fret'))}`;
  }).sort();
  if (selectedMembers.join('|') !== rendered.notes.map(note => `${6 - note.string}:${note.fret}`).sort().join('|')
    || Boolean(child(selected[0], 'rest')) !== Boolean(rendered.isRest)) {
    throw new Error('The selected source triplet child does not match the rendered score.');
  }
  const start = tripletStart(lanes[0].groups, position.beat);
  if (start === null) throw new Error('This is not a supported 3:2 triplet group.');
  const boundary = timingBoundary(document, position.measure, tabStaff, String(position.voice + 1), lanes[0].groups[start]);
  if (boundary) throw new Error(boundary);
  const childDenominator = durationTypes[text(child(lanes[0].groups[start][0], 'type'))];
  if (!childDenominator || childDenominator === 1) throw new Error('This triplet has an unsupported child duration.');
  const parentDenominator = (childDenominator / 2) as DurationDenominator;
  const divisions = sourceDivisions(part, position.measure);
  const childTime = eventTime(lanes[0].groups[start], divisions);
  const parentTime = rationalTime(childTime[0] * 3n, childTime[1]);
  if (compareTime(parentTime, durationTime(parentDenominator)) !== 0) {
    throw new Error('This triplet has an unsupported source duration.');
  }
  for (const lane of lanes) {
    if (tripletStart(lane.groups, position.beat) !== start
      || !removableTripletRest(lane.groups[start + 1]) || !removableTripletRest(lane.groups[start + 2])) {
      throw new Error('Remove the last two notes or protected attachments before removing this triplet.');
    }
    for (let index = start; index < start + 3; index++) {
      if (compareTime(eventTime(lane.groups[index], divisions), childTime) !== 0) {
        throw new Error('The paired triplet children do not have matching durations.');
      }
    }
  }
  const parentTicks = parentTime[0] * divisions / parentTime[1];
  for (const lane of lanes) {
    const first = lane.groups[start];
    writeDuration(first, parentDenominator, false, parentTicks);
    first.forEach(note => {
      removeChildren(note, 'time-modification');
      const notations = child(note, 'notations');
      if (notations) {
        removeChildren(notations, 'tuplet');
        if (!children(notations).length) note.removeChild(notations);
      }
    });
    lane.groups.slice(start + 1, start + 3).flat().forEach(note => note.parentNode?.removeChild(note));
  }
  return new XMLSerializer().serializeToString(document);
}
