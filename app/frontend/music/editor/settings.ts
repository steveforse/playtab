// Title, opening and local tempo, and tuning changes.
import type { model } from '@coderline/alphatab';
import { child, children, descendants, directMeasures, ensure, midiToPitch, noteTechnical, parseDocument, pitchMidi, readDocument, scorePart, setPitch, setText, sourceTabStaff, text, tuningMidi } from './xml';
import { linkedStaffNotes, sourceTabNoteRecords } from './records';
import { measureTimeline, rational, sameTime, timeGreater, type Rational, type RhythmPosition } from './time';
import { ANCHOR_TEXT_LIMIT, anchorEvent } from './text';
import { defaultFifthCapo, openTabTuning } from './tuning';
export { defaultFifthCapo, fifthStringOffset } from './tuning';

export type TuningMode = 'frets' | 'pitches';

export type Feel = 'straight' | 'swing' | 'dotted';

// Capo, the 5th-string capo (spike, as a neck fret), credits, key and feel
// are optional: a field left out keeps the score's current value.
export type ScoreSettings = { title: string; tempo: number; tuning: number[]; mode: TuningMode;
  capo?: number; fifthCapo?: number | null; subtitle?: string; composer?: string; arranger?: string; keyFifths?: number; feel?: Feel };

export type ScoreSettingsInfo = { title: string; tempo: number; tuning: number[]; tuningRange: { first: number; last: number };
  capo: number; fifthCapo: number | null; subtitle: string; composer: string; arranger: string; keyFifths: number; feel: Feel };

export const CAPO_LIMIT = 12;
export const FIFTH_CAPO_FIELD = 'playtab-fifth-string-capo';

function tabDetails(document: Document, measure: Element, tabStaff: number) {
  return children(measure).filter(item => item.localName === 'attributes').flatMap(attributes => children(attributes)
    .filter(item => item.localName === 'staff-details' && (item.getAttribute('number') || '1') === String(tabStaff)))[0];
}

function legacyCapo(measure: Element) {
  for (const words of descendants(measure, 'words')) {
    const match = /^\s*capo\s+(\d{1,2})\s*$/i.exec(text(words));
    if (match) return { value: Number(match[1]), direction: words.parentNode?.parentNode as Element };
  }
  return null;
}

function miscellaneousField(document: Document) {
  return descendants(document.documentElement, 'miscellaneous-field').find(item => item.getAttribute('name') === FIFTH_CAPO_FIELD);
}

function creatorText(document: Document, type: string) {
  const identification = child(document.documentElement, 'identification');
  return text(identification ? children(identification).find(item => item.localName === 'creator' && item.getAttribute('type') === type) : undefined);
}

function subtitleCredit(document: Document) {
  return children(document.documentElement).find(item => item.localName === 'credit' && children(item).some(entry => entry.localName === 'credit-type' && text(entry) === 'subtitle'));
}

function feelSwing(measure: Element) {
  return descendants(measure, 'swing')[0];
}

function readFeel(measure: Element): Feel {
  const swing = feelSwing(measure);
  if (!swing || child(swing, 'straight')) return 'straight';
  const first = Number(text(child(swing, 'first'))); const second = Number(text(child(swing, 'second')));
  return first === 3 && second === 1 ? 'dotted' : first === 2 && second === 1 ? 'swing' : 'straight';
}

export function inspectScoreHeader(document: Document, measure: Element, tabStaff: number) {
  const details = tabDetails(document, measure, tabStaff);
  const written = details ? child(details, 'capo') : undefined;
  const capo = written ? Number(text(written)) || 0 : legacyCapo(measure)?.value ?? 0;
  const field = miscellaneousField(document);
  const fifthCapo = field ? (text(field) === 'none' ? null : Number(text(field)) || null) : defaultFifthCapo(capo);
  const key = descendants(measure, 'key')[0];
  return { capo, fifthCapo, subtitle: text(subtitleCredit(document) ? child(subtitleCredit(document)!, 'credit-words') : undefined),
    composer: creatorText(document, 'composer'), arranger: creatorText(document, 'arranger'),
    keyFifths: key ? Number(text(child(key, 'fifths'))) || 0 : 0, feel: readFeel(measure) };
}

const HEADER_ORDER = ['work', 'movement-number', 'movement-title', 'identification', 'defaults', 'credit', 'part-list'];
function ensureHeader(document: Document, name: string) {
  const root = document.documentElement;
  const existing = child(root, name);
  if (existing) return existing;
  const created = document.createElement(name);
  const later = children(root).find(item => HEADER_ORDER.indexOf(item.localName) > HEADER_ORDER.indexOf(name) || !HEADER_ORDER.includes(item.localName));
  root.insertBefore(created, later ?? null);
  return created;
}

function writeCreator(document: Document, type: string, value: string) {
  const root = document.documentElement;
  const identification = child(root, 'identification');
  const current = identification && children(identification).find(item => item.localName === 'creator' && item.getAttribute('type') === type);
  if (!value) { if (current) identification!.removeChild(current); return; }
  const target = ensureHeader(document, 'identification');
  const creator = current ?? document.createElement('creator');
  creator.setAttribute('type', type);
  creator.textContent = value;
  if (!current) target.insertBefore(creator, children(target).find(item => item.localName !== 'creator') ?? null);
}

function writeFifthCapoField(document: Document, capo: number, fifthCapo: number | null) {
  const field = miscellaneousField(document);
  if (fifthCapo === defaultFifthCapo(capo)) {
    if (field) { const miscellaneous = field.parentNode as Element; miscellaneous.removeChild(field); if (!children(miscellaneous).length) miscellaneous.parentNode?.removeChild(miscellaneous); }
    return;
  }
  const identification = ensureHeader(document, 'identification');
  const miscellaneous = child(identification, 'miscellaneous') ?? identification.appendChild(document.createElement('miscellaneous'));
  const target = field ?? miscellaneous.appendChild(document.createElement('miscellaneous-field'));
  target.setAttribute('name', FIFTH_CAPO_FIELD);
  target.textContent = fifthCapo === null ? 'none' : String(fifthCapo);
}

export const TEMPO_LIMITS = { min: 30, max: 240 } as const;

export const TUNING_LIMITS = { min: 36, max: 96 } as const;

export function tabTuningDetails(measure: Element, tabStaff: number) {
  return children(measure).filter(item => item.localName === 'attributes')
    .flatMap(attributes => children(attributes).filter(item => item.localName === 'staff-details'
      && (item.getAttribute('number') || '1') === String(tabStaff) && children(item).some(tuning => tuning.localName === 'staff-tuning')));
}

export function scoreTuningState(document: Document, score: model.Score) {
  const part = scorePart(document);
  if (!part) throw new Error('This score has no part to configure.');
  const measures = directMeasures(part);
  const tabStaff = sourceTabStaff(document);
  const initial = openTabTuning(score);
  const first = tabTuningDetails(measures[0], tabStaff)[0];
  for (const tuning of first ? children(first).filter(item => item.localName === 'staff-tuning') : []) {
    const midi = tuningMidi(tuning);
    const line = Number(tuning.getAttribute('line'));
    if (midi !== null && line >= 1 && line <= 5) initial[5 - line] = midi;
  }
  const next = measures.findIndex((measure, index) => index > 0 && tabTuningDetails(measure, tabStaff).length > 0);
  return { part, measures, tabStaff, initial, end: next < 0 ? measures.length : next, firstDetails: first };
}

export function tempoDirectives(measure: Element, onsets: Map<Element, Rational>, onset: Rational) {
  return children(measure).filter(item => item.localName === 'direction' && sameTime(onsets.get(item), onset)
    && (descendants(item, 'metronome').length || child(item, 'sound')?.getAttribute('tempo')));
}

export function directiveTempo(direction: Element) {
  const sound = Number(child(direction, 'sound')?.getAttribute('tempo'));
  if (Number.isFinite(sound) && sound > 0) return Math.round(sound);
  const perMinute = Number(text(descendants(direction, 'per-minute')[0]));
  return Number.isFinite(perMinute) && perMinute > 0 ? Math.round(perMinute) : null;
}

export function setDirectiveTempo(direction: Element, tempo: number) {
  descendants(direction, 'per-minute').forEach(item => { item.textContent = String(tempo); });
  const sound = child(direction, 'sound');
  if (sound?.getAttribute('tempo')) sound.setAttribute('tempo', String(tempo));
}

export function newTempoDirection(document: Document, tempo: number, staff: number) {
  const direction = document.createElement('direction');
  direction.setAttribute('placement', 'above');
  const metronome = ensure(ensure(direction, 'direction-type'), 'metronome');
  setText(metronome, 'beat-unit', 'quarter');
  setText(metronome, 'per-minute', String(tempo));
  setText(direction, 'staff', String(staff));
  ensure(direction, 'sound').setAttribute('tempo', String(tempo));
  return direction;
}

export function inspectMusicXmlScoreSettings(source: string, score: model.Score): ScoreSettingsInfo {
  const document = readDocument(source);
  const { part, initial, end } = scoreTuningState(document, score);
  const { measure, onsets } = measureTimeline(part, 0);
  const opening = tempoDirectives(measure, onsets, rational(0n)).map(directiveTempo).find(value => value !== null);
  const title = text(descendants(document.documentElement, 'work-title')[0]) || text(descendants(document.documentElement, 'movement-title')[0]) || score.title;
  return { title, tempo: opening ?? Math.round(score.tempo || 120), tuning: initial, tuningRange: { first: 1, last: end },
    ...inspectScoreHeader(document, directMeasures(part)[0], sourceTabStaff(document)) };
}

// Title, opening tempo and tuning change together as one transaction. The
// opening tempo changes only measure 1's first tempo directives; tuning runs
// until the next explicit tuning change, which keeps its own meaning.
export function applyMusicXmlScoreSettings(source: string, score: model.Score, settings: ScoreSettings): { source: string; tuningRange: { first: number; last: number } } {
  const title = settings.title.trim();
  if (!title || title.length > ANCHOR_TEXT_LIMIT) throw new Error(`Title must be 1–${ANCHOR_TEXT_LIMIT} characters.`);
  if (!Number.isInteger(settings.tempo) || settings.tempo < TEMPO_LIMITS.min || settings.tempo > TEMPO_LIMITS.max) {
    throw new Error(`Opening tempo must be a whole number from ${TEMPO_LIMITS.min} to ${TEMPO_LIMITS.max} BPM.`);
  }
  if (settings.tuning.length !== 5 || settings.tuning.some(value => !Number.isInteger(value) || value < TUNING_LIMITS.min || value > TUNING_LIMITS.max)) {
    throw new Error('Each of the five open strings must be a note from C2 to C7.');
  }
  if (settings.mode !== 'frets' && settings.mode !== 'pitches') throw new Error('Choose Keep frets or Keep pitches.');
  if (settings.capo !== undefined && (!Number.isInteger(settings.capo) || settings.capo < 0 || settings.capo > CAPO_LIMIT)) throw new Error(`Capo must be a fret from 0 to ${CAPO_LIMIT}.`);
  if (settings.fifthCapo !== undefined && settings.fifthCapo !== null && (!Number.isInteger(settings.fifthCapo) || settings.fifthCapo < 6 || settings.fifthCapo > 17)) {
    throw new Error('The 5th-string capo must be at a fret from 6 to 17.');
  }
  if (settings.keyFifths !== undefined && (!Number.isInteger(settings.keyFifths) || settings.keyFifths < -7 || settings.keyFifths > 7)) throw new Error('Choose a key signature.');
  for (const [label, value] of [['Subtitle', settings.subtitle], ['Composer', settings.composer], ['Arranger', settings.arranger]] as const) {
    if (value !== undefined && value.trim().length > ANCHOR_TEXT_LIMIT) throw new Error(`${label} must be at most ${ANCHOR_TEXT_LIMIT} characters.`);
  }
  const document = parseDocument(source);
  const root = document.documentElement;
  const current = inspectMusicXmlScoreSettings(source, score);
  if (title !== current.title) {
    const work = descendants(root, 'work')[0] ?? (() => { const created = document.createElement('work'); root.insertBefore(created, children(root)[0] ?? null); return created; })();
    setText(work, 'work-title', title);
    descendants(root, 'movement-title').forEach(item => { item.textContent = title; });
  }
  const { part, measures, tabStaff, initial, end, firstDetails } = scoreTuningState(document, score);
  if (settings.tempo !== current.tempo) {
    const { measure, onsets } = measureTimeline(part, 0);
    const directives = tempoDirectives(measure, onsets, rational(0n));
    if (directives.length) directives.forEach(direction => setDirectiveTempo(direction, settings.tempo));
    else measure.insertBefore(newTempoDirection(document, settings.tempo, tabStaff),
      children(measure).find(item => !['attributes', 'barline', 'print'].includes(item.localName)) ?? null);
  }
  const tuningRange = { first: 1, last: end };
  writeHeaderSettings(document, measures[0], tabStaff, current, settings);
  if (settings.tuning.every((value, index) => value === initial[index])) return { source: new XMLSerializer().serializeToString(document), tuningRange };
  const linked = linkedStaffNotes(document);
  const records = sourceTabNoteRecords(document).filter(record => record.measure < end);
  const changes: { note: Element; partners: Element[]; fret?: number; midi?: number }[] = [];
  for (const record of records) {
    const index = record.string - 1;
    if (settings.tuning[index] === initial[index]) continue;
    const where = `Measure ${record.measure + 1}, event ${record.beat + 1}, string ${record.string}`;
    if (settings.mode === 'pitches') {
      const midi = pitchMidi(child(record.note, 'pitch')) ?? initial[index] + record.fret;
      const fret = midi - settings.tuning[index];
      if (fret < 0 || fret > 36) throw new Error(`${where}: keeping its pitch would need fret ${fret}, outside 0–36. No tuning change was applied.`);
      changes.push({ note: record.note, partners: [], fret });
    } else {
      const midi = settings.tuning[index] + record.fret;
      const tie = descendants(record.note, 'tie').concat(descendants(record.note, 'tied')).find(marker => marker.getAttribute('type') === 'start');
      if (tie && record.measure === end - 1 && end < measures.length) {
        throw new Error(`${where}: its tie continues past the tuning range, so keeping frets would break the tie. No tuning change was applied.`);
      }
      changes.push({ note: record.note, partners: linked(record.note), midi });
    }
  }
  for (const change of changes) {
    if (change.fret !== undefined) setText(noteTechnical(change.note)!, 'fret', String(change.fret));
    if (change.midi !== undefined) [change.note, ...change.partners].forEach(note => setPitch(note, change.midi!));
  }
  const writeTuning = (details: Element, line: number, midi: number) => {
    let tuning = children(details).find(item => item.localName === 'staff-tuning' && item.getAttribute('line') === String(line));
    if (!tuning) {
      tuning = document.createElement('staff-tuning');
      tuning.setAttribute('line', String(line));
      const later = children(details).find(item => item.localName === 'staff-tuning' && Number(item.getAttribute('line')) > line)
        ?? children(details).find(item => !['staff-type', 'staff-lines', 'staff-tuning'].includes(item.localName));
      details.insertBefore(tuning, later ?? null);
    }
    const value = midiToPitch(midi);
    children(tuning).forEach(item => tuning!.removeChild(item));
    setText(tuning, 'tuning-step', value.step);
    if (value.alter) setText(tuning, 'tuning-alter', String(value.alter));
    setText(tuning, 'tuning-octave', String(value.octave));
  };
  if (end < measures.length) {
    // A later partial tuning change inherited the old open strings; write
    // them explicitly so that change still means what it meant before.
    const later = tabTuningDetails(measures[end], tabStaff)[0];
    for (let line = 1; line <= 5; line++) {
      if (!children(later).some(item => item.localName === 'staff-tuning' && item.getAttribute('line') === String(line))) writeTuning(later, line, initial[5 - line]);
    }
  }
  const details = firstDetails ?? (() => {
    const attributes = children(measures[0]).find(item => item.localName === 'attributes') ?? (() => {
      const created = document.createElement('attributes'); measures[0].insertBefore(created, children(measures[0])[0] ?? null); return created;
    })();
    const created = document.createElement('staff-details');
    if (tabStaff !== 1 || descendants(attributes, 'staves').length) created.setAttribute('number', String(tabStaff));
    setText(created, 'staff-lines', '5');
    attributes.appendChild(created);
    return created;
  })();
  settings.tuning.forEach((midi, index) => { if (midi !== initial[index] || !firstDetails) writeTuning(details, 5 - index, midi); });
  const before = previewTuningConflicts(readDocument(source), initial);
  const conflict = previewTuningConflicts(document, initial).find(item => !before.has(item.key));
  if (conflict) {
    throw new Error(`${conflict.where}: this score changes tuning again at measure ${end + 1}, and the preview plays one tuning per staff, so this note would sound wrong. No tuning change was applied.`);
  }
  return { source: new XMLSerializer().serializeToString(document), tuningRange };
}

function writeHeaderSettings(document: Document, measure: Element, tabStaff: number, current: ScoreSettingsInfo, settings: ScoreSettings) {
  const header = inspectScoreHeader(document, measure, tabStaff);
  for (const [type, value] of [['composer', settings.composer], ['arranger', settings.arranger]] as const) {
    if (value !== undefined && value.trim() !== current[type]) writeCreator(document, type, value.trim());
  }
  if (settings.subtitle !== undefined && settings.subtitle.trim() !== current.subtitle) {
    const credit = subtitleCredit(document);
    if (credit) credit.parentNode!.removeChild(credit);
    if (settings.subtitle.trim()) {
      const created = document.createElement('credit');
      created.setAttribute('page', '1');
      setText(created, 'credit-type', 'subtitle');
      setText(created, 'credit-words', settings.subtitle.trim());
      const root = document.documentElement;
      root.insertBefore(created, children(root).find(item => item.localName === 'part-list') ?? null);
    }
  }
  const attributes = () => children(measure).find(item => item.localName === 'attributes') ?? (() => {
    const created = document.createElement('attributes'); measure.insertBefore(created, children(measure)[0] ?? null); return created;
  })();
  if (settings.keyFifths !== undefined && settings.keyFifths !== current.keyFifths) {
    const keys = descendants(measure, 'key');
    if (keys.length) keys.forEach(key => setText(key, 'fifths', String(settings.keyFifths)));
    else {
      const target = attributes();
      const key = document.createElement('key');
      setText(key, 'fifths', String(settings.keyFifths));
      target.insertBefore(key, children(target).find(item => item.localName !== 'divisions') ?? null);
    }
  }
  const capo = settings.capo ?? current.capo;
  const writtenCapo = (() => { const details = tabDetails(document, measure, tabStaff); return details && child(details, 'capo') ? Number(text(child(details, 'capo'))) : 0; })();
  if (capo !== writtenCapo) {
    let details = tabDetails(document, measure, tabStaff);
    if (!details) {
      const target = attributes();
      details = document.createElement('staff-details');
      if (tabStaff !== 1 || descendants(target, 'staves').length) details.setAttribute('number', String(tabStaff));
      setText(details, 'staff-lines', '5');
      target.appendChild(details);
    }
    const existing = child(details, 'capo');
    if (capo === 0) { if (existing) details.removeChild(existing); }
    else if (existing) existing.textContent = String(capo);
    else {
      const element = document.createElement('capo');
      element.textContent = String(capo);
      details.insertBefore(element, children(details).find(item => item.localName === 'staff-size') ?? null);
    }
    // alphaTab prints the capo itself; a text-only "Capo N" from an import
    // would now repeat it.
    const legacy = legacyCapo(measure);
    if (legacy?.direction?.parentNode) legacy.direction.parentNode.removeChild(legacy.direction);
  }
  const fifthCapo = settings.fifthCapo !== undefined ? settings.fifthCapo : settings.capo !== undefined && settings.capo !== current.capo ? defaultFifthCapo(capo) : header.fifthCapo;
  if (fifthCapo !== header.fifthCapo || capo !== header.capo || miscellaneousField(document)) writeFifthCapoField(document, capo, fifthCapo);
  if (settings.feel !== undefined && settings.feel !== current.feel) {
    descendants(measure, 'swing').forEach(swing => {
      const sound = swing.parentNode as Element;
      sound.removeChild(swing);
      if (!children(sound).length && !sound.attributes.length && sound.parentNode === measure) measure.removeChild(sound);
    });
    if (settings.feel !== 'straight') {
      const sound = document.createElement('sound');
      const swing = sound.appendChild(document.createElement('swing'));
      setText(swing, 'first', settings.feel === 'dotted' ? '3' : '2');
      setText(swing, 'second', '1');
      setText(swing, 'swing-type', 'eighth');
      measure.insertBefore(sound, children(measure).find(item => !['attributes', 'print'].includes(item.localName)) ?? null);
    }
  }
}

// alphaTab keeps one tuning per staff (the last written value per string
// wins), so every written TAB pitch must agree with that tuning to preview.
export function previewTuningConflicts(document: Document, fallback: number[]) {
  const tabStaff = sourceTabStaff(document);
  const part = scorePart(document);
  const tuning = [...fallback];
  for (const measure of part ? directMeasures(part) : []) {
    for (const details of tabTuningDetails(measure, tabStaff)) {
      for (const item of children(details).filter(entry => entry.localName === 'staff-tuning')) {
        const midi = tuningMidi(item);
        const line = Number(item.getAttribute('line'));
        if (midi !== null && line >= 1 && line <= 5) tuning[5 - line] = midi;
      }
    }
  }
  const conflicts = new Map<string, { key: string; where: string }>();
  for (const record of sourceTabNoteRecords(document)) {
    const midi = pitchMidi(child(record.note, 'pitch'));
    if (midi === null || midi === tuning[record.string - 1] + record.fret) continue;
    const key = `${record.measure}:${record.voice}:${record.beat}:${record.string}`;
    conflicts.set(key, { key, where: `Measure ${record.measure + 1}, event ${record.beat + 1}, string ${record.string}` });
  }
  return Object.assign([...conflicts.values()], { has: (key: string) => conflicts.has(key) });
}

export type LocalTempoInfo = { local: number | null; inherited: number; opening: boolean };

export function tempoBefore(part: Element, measureIndex: number, onset: Rational, fallback: number) {
  let tempo = fallback;
  for (let index = 0; index <= measureIndex; index++) {
    const { measure, onsets } = measureTimeline(part, index);
    children(measure).filter(item => item.localName === 'direction').forEach(direction => {
      const at = onsets.get(direction);
      const value = directiveTempo(direction);
      if (value !== null && at && (index < measureIndex || timeGreater(onset, at))) tempo = value;
    });
  }
  return tempo;
}

export function inspectMusicXmlTempo(source: string, score: model.Score, position: RhythmPosition): LocalTempoInfo {
  const document = readDocument(source);
  const { part, measure, onset } = anchorEvent(document, score, position);
  const onsets = measureTimeline(part, position.measure).onsets;
  const local = tempoDirectives(measure, onsets, onset).map(directiveTempo).find(value => value !== null) ?? null;
  return { local, inherited: tempoBefore(part, position.measure, onset, Math.round(score.tempo || 120)), opening: position.measure === 0 && onset[0] === 0n };
}

// Sets (or removes, with null) the tempo that starts at the selected event.
export function setMusicXmlLocalTempo(source: string, score: model.Score, position: RhythmPosition, tempo: number | null): string {
  if (tempo !== null && (!Number.isInteger(tempo) || tempo < TEMPO_LIMITS.min || tempo > TEMPO_LIMITS.max)) {
    throw new Error(`Tempo must be a whole number from ${TEMPO_LIMITS.min} to ${TEMPO_LIMITS.max} BPM.`);
  }
  const document = parseDocument(source);
  const { part, measure, anchors, onset, tabStaff } = anchorEvent(document, score, position);
  if (position.measure === 0 && onset[0] === 0n) throw new Error('The first event uses the opening tempo. Change it in Score settings.');
  const directives = tempoDirectives(measure, measureTimeline(part, position.measure).onsets, onset);
  if (tempo === null) {
    if (!directives.length) return source;
    for (const direction of directives) {
      children(direction).filter(type => type.localName === 'direction-type' && children(type).some(item => item.localName === 'metronome'))
        .forEach(type => direction.removeChild(type));
      const sound = child(direction, 'sound');
      if (sound) { sound.removeAttribute('tempo'); if (!sound.attributes.length && !children(sound).length) direction.removeChild(sound); }
      if (!children(direction).some(item => item.localName === 'direction-type')) {
        if (child(direction, 'sound')) {
          const type = document.createElement('direction-type');
          type.appendChild(document.createElement('words'));
          direction.insertBefore(type, children(direction)[0] ?? null);
        } else direction.parentNode!.removeChild(direction);
      }
    }
    return new XMLSerializer().serializeToString(document);
  }
  if (directives.length) directives.forEach(direction => setDirectiveTempo(direction, tempo));
  else measure.insertBefore(newTempoDirection(document, tempo, tabStaff), anchors[0].note);
  return new XMLSerializer().serializeToString(document);
}
