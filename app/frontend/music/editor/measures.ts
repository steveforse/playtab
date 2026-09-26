// Inserting, duplicating and deleting measures; meter and pickup changes.
import type { model } from '@coderline/alphatab';
import { addTime as addRhythmTime, subtractTime as subtractRhythmTime, durationTime, fillRestTime, rationalTime, compareTime, type DurationDenominator, type RationalTime } from '../../editor/rhythm';
import { child, children, descendants, directMeasures, parseDocument, readDocument, scorePart, setText, text } from './xml';
import { beatTime, makeRest, rescaleDivisions, setMeasureDivisions, simpleRest, sourceDivisions } from './time';

export function insertMusicXmlMeasure(source: string, score: model.Score, measureIndex: number,
  placement: 'before' | 'after'): string {
  if (placement !== 'before' && placement !== 'after') throw new Error('Invalid measure insertion position.');
  const document = parseDocument(source);
  const part = scorePart(document);
  const measures = part ? directMeasures(part) : [];
  if (!part || !measures[measureIndex] || !score.masterBars[measureIndex]) throw new Error('The selected measure cannot be identified safely.');
  if (measures.length >= 256) throw new Error('A score cannot contain more than 256 measures.');
  if (measures.length !== score.masterBars.length) throw new Error('The source measure count does not match the rendered score.');
  const insertAt = measureIndex + (placement === 'after' ? 1 : 0);
  const contextIndex = placement === 'before' && measureIndex > 0 ? measureIndex - 1 : measureIndex;
  const master = score.masterBars[contextIndex];
  const numerator = master.timeSignatureNumerator;
  const denominator = master.timeSignatureDenominator;
  if (!Number.isInteger(numerator) || numerator < 1 || !Number.isInteger(denominator) || denominator < 1) {
    throw new Error('The inherited time signature cannot be used for measure insertion.');
  }
  const capacity = rationalTime(BigInt(numerator) * 4n, BigInt(denominator));
  const restValues = fillRestTime(capacity);
  if (!restValues.length) throw new Error('The inherited measure has no positive duration.');
  const oldDivisions = sourceDivisions(part, contextIndex);
  const gcd = (a: bigint, b: bigint): bigint => b ? gcd(b, a % b) : a;
  const newDivisions = restValues.reduce((value, rest) => {
    const fraction = durationTime(rest);
    return value / gcd(value, fraction[1]) * fraction[1];
  }, oldDivisions);
  if (newDivisions > 1_000_000n || newDivisions % oldDivisions !== 0n) {
    throw new Error('This measure needs unsupported MusicXML timing precision.');
  }
  const templates = [measures[contextIndex], measures[measureIndex]];
  const lanes = new Map<string, { staff: number; voice: string }>();
  for (const template of templates) for (const note of children(template).filter(item => item.localName === 'note')) {
    const staff = Number(text(child(note, 'staff')) || '1');
    const voice = text(child(note, 'voice')) || '1';
    if (!Number.isInteger(staff) || staff < 1) throw new Error('This source has an unsupported staff number.');
    lanes.set(`${staff}:${voice}`, { staff, voice });
  }
  if (!lanes.size) throw new Error('The source has no existing voices to fill.');
  const created = document.createElement('measure');
  created.setAttribute('number', String(insertAt + 1));
  if (insertAt === 0) {
    const initial = children(measures[0]).find(item => item.localName === 'attributes');
    if (!initial) throw new Error('The first measure has no source attributes to inherit.');
    created.appendChild(initial.cloneNode(true));
  }
  if (newDivisions !== oldDivisions) setMeasureDivisions(created, newDivisions);
  const ticks = (time: RationalTime) => time[0] * newDivisions / time[1];
  [...lanes.values()].forEach((lane, laneIndex) => {
    if (laneIndex > 0) {
      const backup = document.createElement('backup');
      const duration = document.createElement('duration');
      duration.textContent = String(ticks(capacity));
      backup.appendChild(duration);
      created.appendChild(backup);
    }
    for (const value of restValues) created.appendChild(makeRest(document, lane.voice, lane.staff,
      value, ticks(durationTime(value))));
  });
  const sequential = measures.every((measure, index) => measure.getAttribute('number') === String(index + 1));
  part.insertBefore(created, measures[insertAt] ?? null);
  if (newDivisions !== oldDivisions) {
    const next = directMeasures(part)[insertAt + 1];
    if (next && !children(next).some(item => item.localName === 'attributes' && child(item, 'divisions'))) {
      setMeasureDivisions(next, oldDivisions);
    }
  }
  if (sequential) directMeasures(part).forEach((measure, index) => measure.setAttribute('number', String(index + 1)));
  return new XMLSerializer().serializeToString(document);
}

export type MeasureDuplication = { source: string; excluded: string[] };

export function spanMarkerKey(marker: Element, note: Element): string {
  const voice = text(child(note, 'voice')) || '1';
  const staff = text(child(note, 'staff')) || '1';
  const technical = child(child(note, 'notations') ?? note, 'technical');
  const string = text(child(technical ?? note, 'string'));
  const pitch = child(note, 'pitch');
  const pitchKey = pitch ? `${text(child(pitch, 'step'))}:${text(child(pitch, 'alter'))}:${text(child(pitch, 'octave'))}` : '';
  const identity = marker.localName === 'tie' || marker.localName === 'tied' ? string || pitchKey : string;
  return `${marker.localName}:${marker.getAttribute('number') || '1'}:${staff}:${voice}:${identity}`;
}

export function excludedCopySpans(original: Element, copy: Element): { excluded: string[]; outgoing: string[] } {
  const sourceNotes = children(original).filter(item => item.localName === 'note');
  const copiedNotes = children(copy).filter(item => item.localName === 'note');
  const markerNames = new Set(['tie', 'tied', 'slide', 'glissando', 'hammer-on', 'pull-off']);
  const grouped = new Map<string, { markers: { marker: Element; noteIndex: number }[]; balance: number; crossing: boolean }>();
  sourceNotes.forEach((note, noteIndex) => {
    Array.from(note.getElementsByTagName('*')).filter(marker => markerNames.has(marker.localName)).forEach(marker => {
      const type = marker.getAttribute('type');
      if (type !== 'start' && type !== 'stop') return;
      const key = spanMarkerKey(marker, note);
      const entry = grouped.get(key) ?? { markers: [], balance: 0, crossing: false };
      entry.markers.push({ marker, noteIndex });
      if (type === 'start') entry.balance++;
      else if (entry.balance === 0) entry.crossing = true;
      else entry.balance--;
      grouped.set(key, entry);
    });
  });
  const excluded = new Set<string>();
  const outgoing = new Set<string>();
  grouped.forEach((entry, key) => {
    if (!entry.crossing && entry.balance === 0) return;
    const name = key.split(':')[0];
    const label = name === 'tie' || name === 'tied' ? 'cross-measure tie'
      : name === 'hammer-on' || name === 'pull-off' ? 'cross-measure hammer-on/pull-off'
        : 'cross-measure slide';
    excluded.add(label);
    if (entry.balance > 0) outgoing.add(label);
    entry.markers.forEach(({ marker, noteIndex }) => {
      const candidate = Array.from(copiedNotes[noteIndex].getElementsByTagName('*')).find(item => item.localName === marker.localName
        && item.getAttribute('type') === marker.getAttribute('type')
        && (item.getAttribute('number') || '1') === (marker.getAttribute('number') || '1'));
      candidate?.parentNode?.removeChild(candidate);
    });
  });
  return { excluded: [...excluded], outgoing: [...outgoing] };
}

export function duplicateMusicXmlMeasure(source: string, score: model.Score, measureIndex: number): MeasureDuplication {
  const document = parseDocument(source);
  const part = scorePart(document);
  const measures = part ? directMeasures(part) : [];
  const selected = measures[measureIndex];
  if (!part || !selected || !score.masterBars[measureIndex] || measures.length !== score.masterBars.length) {
    throw new Error('The selected source measure cannot be identified safely.');
  }
  if (measures.length >= 256) throw new Error('A score cannot contain more than 256 measures.');
  const copy = selected.cloneNode(true) as Element;
  const spans = excludedCopySpans(selected, copy);
  if (spans.outgoing.length) throw new Error(`Duplicating this measure would split a ${spans.outgoing.join(' and ')}. Remove that span first.`);
  const excluded = new Set(spans.excluded);
  for (const barline of children(copy).filter(item => item.localName === 'barline')) {
    for (const marker of children(barline).filter(item => item.localName === 'repeat' || item.localName === 'ending')) {
      excluded.add(marker.localName === 'repeat' ? 'repeat marker' : 'repeat ending');
      barline.removeChild(marker);
    }
    if (!children(barline).length) copy.removeChild(barline);
  }
  const structuralDirectionNames = new Set(['wedge', 'dashes', 'pedal', 'octave-shift', 'bracket']);
  for (const direction of children(copy).filter(item => item.localName === 'direction')) {
    for (const directionType of children(direction).filter(item => item.localName === 'direction-type')) {
      for (const marker of children(directionType).filter(item => structuralDirectionNames.has(item.localName))) {
        excluded.add('cross-measure direction span');
        directionType.removeChild(marker);
      }
      if (!children(directionType).length) direction.removeChild(directionType);
    }
    if (!children(direction).length) copy.removeChild(direction);
  }
  const sequential = measures.every((measure, index) => measure.getAttribute('number') === String(index + 1));
  copy.setAttribute('number', String(measureIndex + 2));
  part.insertBefore(copy, measures[measureIndex + 1] ?? null);
  if (sequential) directMeasures(part).forEach((measure, index) => measure.setAttribute('number', String(index + 1)));
  return { source: new XMLSerializer().serializeToString(document), excluded: [...excluded] };
}

export function effectiveAttributes(measures: Element[], throughIndex: number): Element {
  const document = measures[0].ownerDocument!;
  const effective = new Map<string, Element>();
  const allowed = new Set(['divisions', 'key', 'time', 'staves', 'clef', 'staff-details']);
  for (const measure of measures.slice(0, throughIndex + 1)) {
    const attributes = children(measure).filter(item => item.localName === 'attributes');
    if (attributes.length > 1) throw new Error('Multiple attributes blocks in one measure cannot be inherited safely.');
    for (const update of attributes.flatMap(item => children(item))) {
      if (!allowed.has(update.localName)) throw new Error(`Cannot safely inherit unsupported ${update.localName} attributes.`);
      const number = update.getAttribute('number') || '1';
      const key = ['key', 'clef', 'staff-details'].includes(update.localName) ? `${update.localName}:${number}` : update.localName;
      if (update.localName !== 'staff-details' || !effective.has(key)) {
        effective.set(key, update.cloneNode(true) as Element);
        continue;
      }
      const prior = effective.get(key)!;
      for (const detail of children(update)) {
        if (!['staff-lines', 'staff-tuning'].includes(detail.localName)) {
          throw new Error(`Cannot safely inherit unsupported ${detail.localName} staff detail.`);
        }
        const line = detail.getAttribute('line') || '';
        const replaced = children(prior).find(item => item.localName === detail.localName
          && (item.getAttribute('line') || '') === line);
        if (replaced) prior.replaceChild(detail.cloneNode(true), replaced);
        else prior.appendChild(detail.cloneNode(true));
      }
    }
  }
  if (!effective.has('divisions') || !effective.has('time')) {
    throw new Error('The effective timing attributes cannot be reconstructed safely.');
  }
  const attributes = document.createElement('attributes');
  const order = ['divisions', 'key', 'time', 'staves', 'clef', 'staff-details'];
  for (const name of order) for (const [key, value] of effective) {
    if (key === name || key.startsWith(`${name}:`)) attributes.appendChild(value.cloneNode(true));
  }
  return attributes;
}

export function inheritedTempo(measures: Element[], throughIndex: number): string | null {
  let tempo: string | null = null;
  for (const measure of measures.slice(0, throughIndex + 1)) {
    for (const sound of descendants(measure, 'sound')) {
      const value = sound.getAttribute('tempo');
      if (value !== null) tempo = value;
    }
  }
  return tempo;
}

export type MeasureDeletion = { source: string; noteCount: number; restCount: number; labelCount: number };

export function deleteMusicXmlMeasure(source: string, score: model.Score, measureIndex: number): MeasureDeletion {
  const document = parseDocument(source);
  const part = scorePart(document);
  const measures = part ? directMeasures(part) : [];
  const selected = measures[measureIndex];
  if (!part || !selected || !score.masterBars[measureIndex] || measures.length !== score.masterBars.length) {
    throw new Error('The selected source measure cannot be identified safely.');
  }
  if (measures.length === 1) throw new Error('The last remaining measure cannot be deleted.');
  const structural = [
    ...(descendants(selected, 'repeat').length ? ['repeat endpoint'] : []),
    ...(descendants(selected, 'ending').length ? ['ending endpoint'] : []),
  ];
  if (structural.length) throw new Error(`This measure is a ${structural.join(' and ')}. Remove or redefine it first.`);
  const spans = excludedCopySpans(selected, selected.cloneNode(true) as Element);
  if (spans.excluded.length) throw new Error(`This measure touches a ${spans.excluded.join(' and ')}. Remove that span first.`);
  if (descendants(selected, 'wedge').length || descendants(selected, 'dashes').length
    || descendants(selected, 'pedal').length || descendants(selected, 'octave-shift').length
    || descendants(selected, 'bracket').length) {
    throw new Error('This measure touches a cross-measure direction span. Remove that span first.');
  }
  const next = measures[measureIndex + 1];
  if (next) {
    const changesAttributes = measureIndex === 0 || children(selected).some(item => item.localName === 'attributes');
    if (changesAttributes) {
      const snapshot = effectiveAttributes(measures, measureIndex + 1);
      const existing = children(next).find(item => item.localName === 'attributes');
      if (existing) next.replaceChild(snapshot, existing);
      else next.insertBefore(snapshot, next.firstChild);
    }
    if (measureIndex === 0 || children(selected).some(item => item.localName === 'direction' && descendants(item, 'sound').some(sound => sound.hasAttribute('tempo')))) {
      const tempo = inheritedTempo(measures, measureIndex);
      const entries = children(next);
      const firstNote = entries.findIndex(item => item.localName === 'note');
      const hasOpeningTempo = entries.slice(0, firstNote < 0 ? entries.length : firstNote)
        .some(item => item.localName === 'direction' && descendants(item, 'sound').some(sound => sound.hasAttribute('tempo')));
      if (tempo && !hasOpeningTempo) {
        const direction = document.createElement('direction');
        const sound = document.createElement('sound');
        sound.setAttribute('tempo', tempo);
        direction.appendChild(sound);
        next.insertBefore(direction, children(next).find(item => item.localName === 'note') ?? null);
      }
    }
  }
  const notes = children(selected).filter(item => item.localName === 'note');
  const noteCount = notes.filter(note => !child(note, 'rest')).length;
  const restCount = notes.length - noteCount;
  const labelCount = descendants(selected, 'harmony').length + descendants(selected, 'words').length
    + descendants(selected, 'lyric').length;
  const sequential = measures.every((measure, index) => measure.getAttribute('number') === String(index + 1));
  part.removeChild(selected);
  if (sequential) directMeasures(part).forEach((measure, index) => measure.setAttribute('number', String(index + 1)));
  return { source: new XMLSerializer().serializeToString(document), noteCount, restCount, labelCount };
}

export type MeterScope = 'this' | 'from';

export type MeterChange = { source: string; firstMeasure: number; lastMeasure: number };

export function meterRange(measures: Element[], measureIndex: number, scope: MeterScope) {
  const stop = scope === 'this' ? measureIndex + 1 : measures.findIndex((measure, index) => index > measureIndex && explicitTime(measure).length > 0);
  return { firstMeasure: measureIndex + 1,
    lastMeasure: stop < 0 ? measures.length : scope === 'this' ? measureIndex + 1 : stop };
}

export function inspectMusicXmlMeterRange(source: string, score: model.Score, measureIndex: number, scope: MeterScope) {
  const document = readDocument(source);
  const part = scorePart(document);
  const measures = part ? directMeasures(part) : [];
  if (!measures[measureIndex] || measures.length !== score.masterBars.length) {
    throw new Error('The selected source measure cannot be identified safely.');
  }
  return meterRange(measures, measureIndex, scope);
}

export function explicitTime(measure: Element) {
  return children(measure).filter(item => item.localName === 'attributes')
    .flatMap(item => children(item).filter(value => value.localName === 'time'));
}

export function setMeasureTime(measure: Element, numerator: number, denominator: number) {
  let attributes = children(measure).find(item => item.localName === 'attributes');
  if (!attributes) {
    attributes = measure.ownerDocument!.createElement('attributes');
    measure.insertBefore(attributes, measure.firstChild);
  }
  let time = child(attributes, 'time');
  if (!time) {
    time = measure.ownerDocument!.createElement('time');
    const following = children(attributes).find(item => ['staves', 'clef', 'staff-details'].includes(item.localName));
    attributes.insertBefore(time, following ?? null);
  }
  setText(time, 'beats', String(numerator));
  setText(time, 'beat-type', String(denominator));
}

export function resizeMeterBar(document: Document, part: Element, measureIndex: number, oldCapacity: RationalTime,
  newCapacity: RationalTime) {
  const measure = directMeasures(part)[measureIndex];
  if (compareTime(oldCapacity, newCapacity) === 0) return;
  if (children(measure).some(item => item.localName === 'forward')) {
    throw new Error(`Measure ${measureIndex + 1}: forward timing cannot be resized safely.`);
  }
  const oldDivisions = sourceDivisions(part, measureIndex);
  const notes = children(measure).filter(item => item.localName === 'note');
  const lanes = new Map<string, { staff: number; voice: string; groups: Element[][] }>();
  for (const note of notes) {
    const staff = Number(text(child(note, 'staff')) || '1');
    const voice = text(child(note, 'voice')) || '1';
    const key = `${staff}:${voice}`;
    if (!Number.isInteger(staff) || staff < 1) throw new Error(`Measure ${measureIndex + 1}: unsupported staff number.`);
    if (!lanes.has(key)) lanes.set(key, { staff, voice, groups: [] });
    const groups = lanes.get(key)!.groups;
    if (child(note, 'chord')) {
      if (!groups.length) throw new Error(`Measure ${measureIndex + 1}, voice ${voice}: orphaned chord note.`);
      groups[groups.length - 1].push(note);
    } else groups.push([note]);
  }
  if (!lanes.size) throw new Error(`Measure ${measureIndex + 1}: no source voices to resize.`);
  const backups = children(measure).filter(item => item.localName === 'backup');
  if (backups.length !== lanes.size - 1 || backups.some(item => beatTime([item], oldDivisions)[0] * oldCapacity[1]
    !== oldCapacity[0] * beatTime([item], oldDivisions)[1])) {
    throw new Error(`Measure ${measureIndex + 1}: voice timing cannot be aligned safely.`);
  }
  const delta = subtractRhythmTime(newCapacity, oldCapacity);
  const changes: { lane: { staff: number; voice: string; groups: Element[][] }; remove: Element[]; rests: DurationDenominator[];
    reference: Node | null }[] = [];
  for (const lane of lanes.values()) {
    const { groups, voice } = lane;
    let total = rationalTime(0n);
    for (const group of groups) if (!child(group[0], 'grace')) total = addRhythmTime(total, beatTime(group, oldDivisions));
    if (compareTime(total, oldCapacity) !== 0) {
      throw new Error(`Measure ${measureIndex + 1}, voice ${voice}: source timing does not match the current meter.`);
    }
    const trailing: Element[][] = [];
    for (let index = groups.length - 1; index >= 0 && simpleRest(groups[index]); index--) trailing.unshift(groups[index]);
    let trailingTime = rationalTime(0n);
    for (const group of trailing) trailingTime = addRhythmTime(trailingTime, beatTime(group, oldDivisions));
    const replacement = addRhythmTime(trailingTime, delta);
    if (compareTime(replacement, rationalTime(0n)) < 0) {
      throw new Error(`Measure ${measureIndex + 1}, voice ${voice}: final time is not removable rest.`);
    }
    const rests = fillRestTime(replacement);
    const last = groups.at(-1)?.at(-1);
    changes.push({ lane, remove: trailing.flat(), rests, reference: last?.nextSibling ?? null });
  }
  const gcd = (a: bigint, b: bigint): bigint => b ? gcd(b, a % b) : a;
  const restDivisions = changes.flatMap(change => change.rests).reduce((value, denominator) => {
    const fraction = durationTime(denominator);
    return value / gcd(value, fraction[1]) * fraction[1];
  }, oldDivisions);
  const newDivisions = restDivisions / gcd(restDivisions, newCapacity[1]) * newCapacity[1];
  rescaleDivisions(part, measureIndex, oldDivisions, newDivisions);
  for (const change of changes) {
    change.remove.forEach(note => note.parentNode?.removeChild(note));
    for (const denominator of change.rests) {
      const duration = durationTime(denominator);
      const ticks = duration[0] * newDivisions / duration[1];
      measure.insertBefore(makeRest(document, change.lane.voice, change.lane.staff, denominator, ticks),
        change.reference?.parentNode === measure ? change.reference : null);
    }
  }
  const ticks = newCapacity[0] * newDivisions / newCapacity[1];
  if (ticks * newCapacity[1] !== newCapacity[0] * newDivisions) throw new Error('This meter needs unsupported MusicXML timing precision.');
  backups.forEach(backup => setText(backup, 'duration', String(ticks)));
}

export function changeMusicXmlMeter(source: string, score: model.Score, measureIndex: number, numerator: number,
  denominator: 2 | 4 | 8 | 16, scope: MeterScope): MeterChange {
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 12 || ![2, 4, 8, 16].includes(denominator)
    || !['this', 'from'].includes(scope)) throw new Error('Choose a numerator from 1–12 and denominator 2, 4, 8, or 16.');
  const document = parseDocument(source);
  const part = scorePart(document);
  const measures = part ? directMeasures(part) : [];
  if (!part || !measures[measureIndex] || !score.masterBars[measureIndex] || measures.length !== score.masterBars.length) {
    throw new Error('The selected source measure cannot be identified safely.');
  }
  const range = meterRange(measures, measureIndex, scope);
  const lastMeasure = range.lastMeasure - 1;
  const next = measures[lastMeasure + 1];
  if (explicitTime(measures[measureIndex]).length > 1 || next && explicitTime(next).length > 1) {
    throw new Error('Multiple source signatures in a measure cannot be changed safely.');
  }
  for (let index = measureIndex; index <= lastMeasure; index++) {
    const master = score.masterBars[index];
    const pickupLength = index === 0 && measures[index].getAttribute('implicit') === 'yes'
      ? firstLaneLength(measures[index], sourceDivisions(part, index)) : null;
    const oldCapacity = pickupLength ?? rationalTime(BigInt(master.timeSignatureNumerator) * 4n, BigInt(master.timeSignatureDenominator));
    const nominalNewCapacity = rationalTime(BigInt(numerator) * 4n, BigInt(denominator));
    if (pickupLength && compareTime(pickupLength, nominalNewCapacity) >= 0) {
      throw new Error('The existing pickup must remain shorter than the new first-measure signature.');
    }
    const newCapacity = pickupLength ?? nominalNewCapacity;
    resizeMeterBar(document, part, index, oldCapacity, newCapacity);
  }
  setMeasureTime(measures[measureIndex], numerator, denominator);
  if (scope === 'this' && next && !explicitTime(next).length) {
    const previous = score.masterBars[lastMeasure + 1];
    setMeasureTime(next, previous.timeSignatureNumerator, previous.timeSignatureDenominator);
  }
  return { source: new XMLSerializer().serializeToString(document), ...range };
}

export function firstLaneLength(measure: Element, divisions: bigint): RationalTime {
  const notes = children(measure).filter(item => item.localName === 'note');
  const first = notes[0];
  if (!first) throw new Error('The first measure has no source voice to resize.');
  const voice = text(child(first, 'voice')) || '1';
  const staff = text(child(first, 'staff')) || '1';
  let result = rationalTime(0n);
  for (const note of notes) {
    if ((text(child(note, 'voice')) || '1') !== voice || (text(child(note, 'staff')) || '1') !== staff
      || child(note, 'chord') || child(note, 'grace')) continue;
    result = addRhythmTime(result, beatTime([note], divisions));
  }
  return result;
}

export function changeMusicXmlPickup(source: string, score: model.Score, numerator: number,
  denominator: 2 | 4 | 8 | 16 | 32 | 64): string {
  if (!Number.isInteger(numerator) || numerator < 1 || ![2, 4, 8, 16, 32, 64].includes(denominator)) {
    throw new Error('Choose a positive pickup length with denominator 2, 4, 8, 16, 32, or 64.');
  }
  const document = parseDocument(source);
  const part = scorePart(document);
  const measures = part ? directMeasures(part) : [];
  if (!part || !measures[0] || measures.length !== score.masterBars.length) {
    throw new Error('The first source measure cannot be identified safely.');
  }
  const master = score.masterBars[0];
  const nominal = rationalTime(BigInt(master.timeSignatureNumerator) * 4n, BigInt(master.timeSignatureDenominator));
  const actual = rationalTime(BigInt(numerator) * 4n, BigInt(denominator));
  if (compareTime(actual, rationalTime(0n)) <= 0 || compareTime(actual, nominal) >= 0) {
    throw new Error('Pickup length must be positive and shorter than the first measure’s time signature.');
  }
  const first = measures[0];
  const oldLength = first.getAttribute('implicit') === 'yes' ? firstLaneLength(first, sourceDivisions(part, 0)) : nominal;
  resizeMeterBar(document, part, 0, oldLength, actual);
  first.setAttribute('implicit', 'yes');
  return new XMLSerializer().serializeToString(document);
}
