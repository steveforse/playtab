// Whole-measure copy, cut, and paste (insert or replace).
import type { model } from '@coderline/alphatab';
import { child, children, descendants, directMeasures, noteTechnical, parseDocument, parseMeasure, pitchMidi, scorePart, setPitch, setText, sourceTabStaff, text, tuningMidi } from './xml';
import { linkedStaffNotes, sourceTabNoteRecords } from './records';
import { measureTimeline, setMeasureDivisions, sourceDivisions } from './time';
import { attachedDependencies, protectedNoteAttachment } from './notes';
import { effectiveAttributes, spanMarkerKey } from './measures';
import { tabTuningDetails, type TuningMode } from './settings';
import { openTabTuning } from './tuning';

// An in-memory copy of whole measures. It carries its own timing and
// tuning so it can be pasted into another open song during the session.
export type MeasureClipboard = {
  title: string; measures: string[]; meters: string[]; staves: number[]; tabStaff: number; tuning: number[]; excluded: string[];
};

export type PasteMode = 'insert' | 'replace';

export function staffNumbers(measures: Element[]) {
  return [...new Set(measures.flatMap(measure => children(measure).filter(item => item.localName === 'note')
    .map(note => Number(text(child(note, 'staff')) || '1'))))].sort((left, right) => left - right);
}

export function effectiveTabTuning(measures: Element[], throughIndex: number, tabStaff: number, fallback: number[]) {
  const tuning = [...fallback];
  for (const measure of measures.slice(0, throughIndex + 1)) {
    for (const details of tabTuningDetails(measure, tabStaff)) {
      for (const item of children(details).filter(entry => entry.localName === 'staff-tuning')) {
        const midi = tuningMidi(item);
        const line = Number(item.getAttribute('line'));
        if (midi !== null && line >= 1 && line <= 5) tuning[5 - line] = midi;
      }
    }
  }
  return tuning;
}

export function crossingSpans(originals: Element[], copies: Element[]) {
  const sourceNotes = originals.flatMap(measure => children(measure).filter(item => item.localName === 'note'));
  const copiedNotes = copies.flatMap(measure => children(measure).filter(item => item.localName === 'note'));
  const names = new Set(['tie', 'tied', 'slide', 'glissando', 'hammer-on', 'pull-off']);
  const grouped = new Map<string, { markers: { marker: Element; index: number }[]; balance: number; crossing: boolean }>();
  sourceNotes.forEach((note, index) => {
    Array.from(note.getElementsByTagName('*')).filter(marker => names.has(marker.localName)).forEach(marker => {
      const type = marker.getAttribute('type');
      if (type !== 'start' && type !== 'stop') return;
      const key = spanMarkerKey(marker, note);
      const entry = grouped.get(key) ?? { markers: [], balance: 0, crossing: false };
      entry.markers.push({ marker, index });
      if (type === 'start') entry.balance++;
      else if (entry.balance === 0) entry.crossing = true;
      else entry.balance--;
      grouped.set(key, entry);
    });
  });
  const excluded = new Set<string>();
  grouped.forEach((entry, key) => {
    if (!entry.crossing && entry.balance === 0) return;
    const name = key.split(':')[0];
    excluded.add(name === 'tie' || name === 'tied' ? 'a tie that crosses the passage edge'
      : name === 'slide' || name === 'glissando' ? 'a slide that crosses the passage edge' : 'a hammer-on/pull-off that crosses the passage edge');
    entry.markers.forEach(({ marker, index }) => {
      const copy = Array.from(copiedNotes[index].getElementsByTagName('*')).find(item => item.localName === marker.localName
        && item.getAttribute('type') === marker.getAttribute('type') && (item.getAttribute('number') || '1') === (marker.getAttribute('number') || '1'));
      copy?.parentNode?.removeChild(copy);
    });
  });
  return [...excluded];
}

export function copyMusicXmlMeasures(source: string, score: model.Score, first: number, last: number): MeasureClipboard {
  const document = parseDocument(source);
  const part = scorePart(document);
  const measures = part ? directMeasures(part) : [];
  if (!part || measures.length !== score.masterBars.length) throw new Error('The source measure count does not match the rendered score.');
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= measures.length) throw new Error('Select whole measures to copy.');
  const originals = measures.slice(first, last + 1);
  const copies = originals.map(measure => measure.cloneNode(true) as Element);
  const excluded = new Set(crossingSpans(originals, copies));
  const tabStaff = sourceTabStaff(document);
  copies.forEach((copy, index) => {
    for (const barline of children(copy).filter(item => item.localName === 'barline')) {
      for (const marker of children(barline).filter(item => item.localName === 'repeat' || item.localName === 'ending')) {
        excluded.add(marker.localName === 'repeat' ? 'repeat barlines' : 'repeat endings');
        barline.removeChild(marker);
      }
      if (!children(barline).length) copy.removeChild(barline);
    }
    for (const attributes of children(copy).filter(item => item.localName === 'attributes')) {
      children(attributes).filter(item => !['divisions', 'key', 'time'].includes(item.localName)).forEach(item => {
        if (index > 0 && item.localName === 'staff-details' && descendants(item, 'staff-tuning').length) excluded.add('tuning changes (the destination tuning is used)');
        else if (index > 0 && item.localName === 'clef') excluded.add('clef changes');
        attributes.removeChild(item);
      });
      if (!children(attributes).length) copy.removeChild(attributes);
    }
    children(copy).filter(item => item.localName === 'print').forEach(item => copy.removeChild(item));
    if (index === 0) {
      // The first copied measure states the timing it was written in.
      const effective = effectiveAttributes(measures, first);
      children(effective).filter(item => !['divisions', 'key', 'time'].includes(item.localName)).forEach(item => effective.removeChild(item));
      children(copy).filter(item => item.localName === 'attributes').forEach(item => copy.removeChild(item));
      copy.insertBefore(effective, children(copy)[0] ?? null);
    }
  });
  const title = text(descendants(document.documentElement, 'work-title')[0]) || score.title;
  return {
    title, tabStaff, staves: staffNumbers(originals),
    measures: copies.map(copy => new XMLSerializer().serializeToString(copy)),
    meters: originals.map((_, index) => `${score.masterBars[first + index].timeSignatureNumerator}/${score.masterBars[first + index].timeSignatureDenominator}`),
    tuning: effectiveTabTuning(measures, first, tabStaff, openTabTuning(score)),
    excluded: [...excluded],
  };
}

export function attributeValues(attributes: Element | undefined) {
  const values = new Map<string, string>();
  for (const item of attributes ? children(attributes) : []) {
    if (['divisions', 'key', 'time'].includes(item.localName)) values.set(item.localName, new XMLSerializer().serializeToString(item));
  }
  return values;
}

// Inserts a copied passage before a measure. Frets or pitches are kept as
// chosen for this score's tuning, and the measure after the passage restates
// the timing that was in effect before.
export function pasteMusicXmlMeasures(source: string, score: model.Score, clipboard: MeasureClipboard, measureIndex: number,
  mode: PasteMode, pitchMode: TuningMode): string {
  if (mode !== 'insert' && mode !== 'replace') throw new Error('Choose Insert measures before or Replace selected measures.');
  if (pitchMode !== 'frets' && pitchMode !== 'pitches') throw new Error('Choose Keep frets or Keep pitches.');
  if (mode === 'replace') return replaceMusicXmlMeasures(source, score, clipboard, measureIndex, pitchMode);
  const document = parseDocument(source);
  const part = scorePart(document);
  const measures = part ? directMeasures(part) : [];
  if (!part || measures.length !== score.masterBars.length || !measures[measureIndex]) throw new Error('The destination measure cannot be identified safely.');
  if (!clipboard.measures.length) throw new Error('The clipboard is empty.');
  if (measures.length + clipboard.measures.length > 256) {
    throw new Error(`Pasting ${clipboard.measures.length} measures would exceed the 256-measure limit.`);
  }
  const tabStaff = sourceTabStaff(document);
  const staves = staffNumbers(measures);
  if (clipboard.tabStaff !== tabStaff || staves.join(',') !== clipboard.staves.join(',')) {
    throw new Error(`The copied measures use staves ${clipboard.staves.join(', ')} with tablature on staff ${clipboard.tabStaff}; this score uses staves ${staves.join(', ')} with tablature on staff ${tabStaff}.`);
  }
  const split = crossingSpans(measures.slice(0, measureIndex), measures.slice(0, measureIndex).map(measure => measure.cloneNode(true) as Element));
  if (measureIndex > 0 && split.length) {
    throw new Error(`Pasting before measure ${measureIndex + 1} would split ${split.join(' and ').replaceAll('crosses the passage edge', 'continues into that measure')}. Remove it first or paste elsewhere.`);
  }
  const destinationTuning = effectiveTabTuning(measures, Math.max(0, measureIndex - 1), tabStaff, openTabTuning(score));
  const restoreAttributes = effectiveAttributes(measures, measureIndex);
  const pasted = clipboard.measures.map(xml => document.importNode(parseMeasure(xml), true) as Element);
  if (measureIndex === 0) {
    // A passage pasted at the start becomes measure 1 and needs the score's
    // staff layout and tuning, with its own timing.
    const initial = (children(measures[0]).find(item => item.localName === 'attributes')?.cloneNode(true) ?? document.createElement('attributes')) as Element;
    const own = children(pasted[0]).find(item => item.localName === 'attributes');
    for (const item of own ? children(own) : []) {
      const existing = child(initial, item.localName);
      if (existing) initial.replaceChild(item.cloneNode(true), existing); else initial.insertBefore(item.cloneNode(true), children(initial)[0] ?? null);
    }
    if (own) pasted[0].replaceChild(initial, own); else pasted[0].insertBefore(initial, children(pasted[0])[0] ?? null);
  }
  const sequential = measures.every((measure, index) => measure.getAttribute('number') === String(index + 1));
  pasted.forEach(measure => part.insertBefore(measure, measures[measureIndex]));
  // Restate the destination's own timing after the passage where it differs.
  const clipEnd = new Map<string, string>();
  pasted.forEach(measure => attributeValues(children(measure).find(item => item.localName === 'attributes')).forEach((value, key) => clipEnd.set(key, value)));
  const following = measures[measureIndex];
  const followingValues = attributeValues(children(following).find(item => item.localName === 'attributes'));
  const restated = children(restoreAttributes).filter(item => ['divisions', 'key', 'time'].includes(item.localName)
    && !followingValues.has(item.localName) && clipEnd.get(item.localName) !== new XMLSerializer().serializeToString(item));
  if (restated.length) {
    const attributes = children(following).find(item => item.localName === 'attributes') ?? (() => {
      const created = document.createElement('attributes'); following.insertBefore(created, children(following)[0] ?? null); return created;
    })();
    const order = ['divisions', 'key', 'time'];
    for (const item of restated) {
      const later = children(attributes).find(existing => order.indexOf(existing.localName) > order.indexOf(item.localName)
        || !order.includes(existing.localName));
      attributes.insertBefore(item.cloneNode(true), later ?? null);
    }
  }
  if (sequential) directMeasures(part).forEach((measure, index) => measure.setAttribute('number', String(index + 1)));
  convertPastedTuning(document, new Set(pasted), clipboard, destinationTuning, pitchMode, measureIndex);
  return new XMLSerializer().serializeToString(document);
}

export function convertPastedTuning(document: Document, pastedSet: Set<Element>, clipboard: MeasureClipboard, destinationTuning: number[],
  pitchMode: TuningMode, measureIndex: number) {
  const linked = linkedStaffNotes(document);
  const changes: (() => void)[] = [];
  for (const record of sourceTabNoteRecords(document).filter(item => pastedSet.has(item.note.parentNode as Element))) {
    const index = record.string - 1;
    if (destinationTuning[index] === clipboard.tuning[index]) continue;
    if (pitchMode === 'frets') {
      const midi = destinationTuning[index] + record.fret;
      const partners = linked(record.note);
      changes.push(() => [record.note, ...partners].forEach(note => setPitch(note, midi)));
    } else {
      const midi = pitchMidi(child(record.note, 'pitch')) ?? clipboard.tuning[index] + record.fret;
      const fret = midi - destinationTuning[index];
      if (fret < 0 || fret > 36) {
        throw new Error(`Copied measure ${record.measure - measureIndex + 1}, event ${record.beat + 1}, string ${record.string}: keeping its pitch would need fret ${fret}, outside 0–36. Nothing was pasted.`);
      }
      changes.push(() => setText(noteTechnical(record.note)!, 'fret', String(fret)));
    }
  }
  changes.forEach(change => change());
}

export const MUSIC_CONTENT = new Set(['note', 'backup', 'forward', 'harmony', 'figured-bass']);

// Directions that only carry text or labels are musical content; tempo and
// other playback directions belong to the measure and stay.
export function isLabelDirection(item: Element) {
  if (item.localName !== 'direction') return false;
  const types = children(item).filter(entry => entry.localName === 'direction-type').flatMap(entry => children(entry));
  return types.length > 0 && types.every(entry => entry.localName === 'words' || entry.localName === 'rehearsal')
    && !child(item, 'sound');
}

export function rangeGuard(measures: Element[], first: number, last: number, action: string) {
  const range = measures.slice(first, last + 1);
  const crossing = crossingSpans(range, range.map(measure => measure.cloneNode(true) as Element));
  if (crossing.length) throw new Error(`${action} would split ${crossing.join(' and ')}. Remove it first.`);
  for (const note of range.flatMap(measure => children(measure).filter(item => item.localName === 'note'))) {
    const attachment = protectedNoteAttachment(note);
    if (attachment && attachment !== 'lyric') throw new Error(`${action} is blocked by a protected ${attachment} attachment that Playtab cannot remove safely.`);
  }
}

export function replaceMusicXmlMeasures(source: string, score: model.Score, clipboard: MeasureClipboard, first: number, pitchMode: TuningMode): string {
  const document = parseDocument(source);
  const part = scorePart(document);
  const measures = part ? directMeasures(part) : [];
  const last = first + clipboard.measures.length - 1;
  if (!part || measures.length !== score.masterBars.length || !measures[first]) throw new Error('The destination measure cannot be identified safely.');
  if (!clipboard.measures.length) throw new Error('The clipboard is empty.');
  if (last >= measures.length) throw new Error(`Replacing needs ${clipboard.measures.length} measures from measure ${first + 1}, but the score ends at measure ${measures.length}.`);
  const tabStaff = sourceTabStaff(document);
  const staves = staffNumbers(measures);
  if (clipboard.tabStaff !== tabStaff || staves.join(',') !== clipboard.staves.join(',')) {
    throw new Error(`The copied measures use staves ${clipboard.staves.join(', ')} with tablature on staff ${clipboard.tabStaff}; this score uses staves ${staves.join(', ')} with tablature on staff ${tabStaff}.`);
  }
  clipboard.meters.forEach((meter, index) => {
    const bar = score.masterBars[first + index];
    const destination = `${bar.timeSignatureNumerator}/${bar.timeSignatureDenominator}`;
    if (meter !== destination) throw new Error(`Copied measure ${index + 1} is in ${meter}, but measure ${first + index + 1} is in ${destination}. Replace needs matching meters.`);
  });
  rangeGuard(measures, first, last, 'Replacing these measures');
  const destinationTuning = effectiveTabTuning(measures, first, tabStaff, openTabTuning(score));
  let clipDivisions: bigint | null = null;
  const replaced: Element[] = [];
  clipboard.measures.forEach((xml, index) => {
    const incoming = parseMeasure(xml);
    const ownDivisions = text(descendants(incoming, 'divisions')[0]);
    if (ownDivisions) clipDivisions = BigInt(ownDivisions);
    const target = measures[first + index];
    const destinationDivisions = sourceDivisions(part, first + index);
    const kept = children(target).filter(item => !MUSIC_CONTENT.has(item.localName) && !isLabelDirection(item));
    const onsets = measureTimeline(part, first + index).onsets;
    if (kept.some(item => item.localName === 'direction' && onsets.get(item) && onsets.get(item)![0] !== 0n)) {
      throw new Error(`Measure ${first + index + 1} has a tempo or playback direction inside the bar; replacing its notes would move it.`);
    }
    if (clipDivisions !== destinationDivisions && kept.some(item => child(item, 'offset'))) {
      throw new Error(`Measure ${first + index + 1} has a positioned direction in different timing units; it cannot be replaced safely.`);
    }
    children(target).filter(item => !kept.includes(item)).forEach(item => target.removeChild(item));
    const anchor = children(target).find(item => item.localName === 'barline' && item.getAttribute('location') === 'right') ?? null;
    // The destination keeps its own tempo and playback directions.
    for (const item of children(incoming).filter(entry => !['attributes', 'barline', 'print', 'sound'].includes(entry.localName)
      && (entry.localName !== 'direction' || isLabelDirection(entry)))) {
      target.insertBefore(document.importNode(item, true), anchor);
    }
    if (clipDivisions !== destinationDivisions) {
      setMeasureDivisions(target, clipDivisions!);
      const next = measures[first + index + 1];
      if (next && !descendants(next, 'divisions').length) setMeasureDivisions(next, destinationDivisions);
    }
    replaced.push(target);
  });
  convertPastedTuning(document, new Set(replaced), clipboard, destinationTuning, pitchMode, first);
  return new XMLSerializer().serializeToString(document);
}

export type MeasureCut = { source: string; clipboard: MeasureClipboard; notes: number; labels: number; lyrics: number; spans: string[] };

// Cut copies whole measures, then leaves rests of the same length at the
// same onsets, so bar count, meter and later timing do not move.
export function cutMusicXmlMeasures(source: string, score: model.Score, first: number, last: number): MeasureCut {
  const clipboard = copyMusicXmlMeasures(source, score, first, last);
  const document = parseDocument(source);
  const part = scorePart(document)!;
  const measures = directMeasures(part);
  rangeGuard(measures, first, last, 'Cutting these measures');
  let notes = 0; let labels = 0; let lyrics = 0;
  const spans = new Set<string>();
  for (const measure of measures.slice(first, last + 1)) {
    for (const item of children(measure)) {
      if (item.localName === 'harmony' || isLabelDirection(item)) { labels++; measure.removeChild(item); continue; }
      if (item.localName !== 'note') continue;
      if (!child(item, 'rest')) notes++;
      lyrics += children(item).filter(entry => entry.localName === 'lyric').length;
      attachedDependencies([item]).forEach(label => spans.add(label));
      if (child(item, 'grace') || child(item, 'chord')) { measure.removeChild(item); continue; }
      if (child(item, 'rest')) { children(item).filter(entry => entry.localName === 'lyric').forEach(entry => item.removeChild(entry)); continue; }
      children(item).filter(entry => !['duration', 'voice', 'type', 'dot', 'time-modification', 'staff'].includes(entry.localName))
        .forEach(entry => item.removeChild(entry));
      item.insertBefore(document.createElement('rest'), children(item)[0] ?? null);
    }
  }
  return { source: new XMLSerializer().serializeToString(document), clipboard, notes, labels, lyrics, spans: [...spans] };
}
