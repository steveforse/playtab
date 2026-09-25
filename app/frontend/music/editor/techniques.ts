// Ties, hammer-ons, pull-offs, slides, hand annotations and bends.
import type { model } from '@coderline/alphatab';
import { child, children, descendants, directMeasures, ensure, ensureNotations, noteTechnical, parseDocument, readDocument, scorePart, setText, sourceTabStaff, text } from './xml';
import { linkedStaffNotes, sourceBeatGroups, sourceTabNoteRecords } from './records';

export type TiePosition = { measure: number; beat: number; voice: number; string: number; fret: number };

export function tieSourceRecords(document: Document, score: model.Score) {
  const part = scorePart(document);
  if (!part || directMeasures(part).length !== score.masterBars.length) {
    throw new Error('The tie source measure count does not match the rendered score.');
  }
  return sourceTabNoteRecords(document).filter(record => !record.grace);
}

export function tieRecord(records: ReturnType<typeof tieSourceRecords>, position: TiePosition) {
  const matches = records.filter(record => record.measure === position.measure && record.beat === position.beat
    && record.voice === String(position.voice) && record.string === position.string && record.fret === position.fret);
  if (matches.length !== 1) throw new Error('The selected tie endpoint cannot be uniquely identified in the source.');
  return matches[0];
}

export function samePitch(left: Element, right: Element) {
  const pitch = (note: Element) => {
    const value = child(note, 'pitch');
    return value ? `${text(child(value, 'step'))}:${text(child(value, 'alter'))}:${text(child(value, 'octave'))}` : null;
  };
  return pitch(left) !== null && pitch(left) === pitch(right);
}

export function transitionMarkers(note: Element) {
  return ['tie', 'tied', 'hammer-on', 'pull-off', 'slide', 'glissando'].flatMap(name => descendants(note, name));
}

export function addTieMarker(note: Element, type: 'start' | 'stop') {
  const document = note.ownerDocument!;
  const tie = document.createElement('tie');
  tie.setAttribute('type', type);
  const next = children(note).find(item => ['voice', 'type', 'dot', 'staff', 'notations'].includes(item.localName));
  note.insertBefore(tie, next ?? null);
  const notations = ensure(note, 'notations');
  const tied = document.createElement('tied');
  tied.setAttribute('type', type);
  notations.insertBefore(tied, notations.firstChild);
}

export function removeTieMarker(note: Element, type: 'start' | 'stop') {
  for (const name of ['tie', 'tied']) for (const marker of descendants(note, name)) {
    if (marker.getAttribute('type') === type) marker.parentNode?.removeChild(marker);
  }
  const notations = child(note, 'notations');
  if (notations && !children(notations).length) note.removeChild(notations);
}

export function inspectMusicXmlTie(source: string, score: model.Score, position: TiePosition) {
  const document = readDocument(source);
  const record = tieRecord(tieSourceRecords(document, score), position);
  return { canRemove: descendants(record.note, 'tie').length > 0 };
}

export function connectMusicXmlTie(source: string, score: model.Score, origin: TiePosition, destination: TiePosition): string {
  if (origin.voice !== destination.voice) throw new Error('Tie endpoints must be in the same voice.');
  if (origin.string !== destination.string) throw new Error('Tie endpoints must be on the same string.');
  const document = parseDocument(source);
  const records = tieSourceRecords(document, score);
  const from = tieRecord(records, origin);
  const to = tieRecord(records, destination);
  const sameLane = records.filter(record => record.voice === from.voice && record.string === from.string);
  const fromIndex = sameLane.indexOf(from);
  const toIndex = sameLane.indexOf(to);
  if (toIndex <= fromIndex) throw new Error('Tie destination must follow the selected origin.');
  const part = scorePart(document)!;
  const voiceEvents = directMeasures(part).flatMap(measure => sourceBeatGroups(measure, sourceTabStaff(document), from.voice)
    .filter(group => !child(group[0], 'grace')));
  const originEvent = voiceEvents.findIndex(group => group.includes(from.note));
  const destinationEvent = voiceEvents.findIndex(group => group.includes(to.note));
  if (toIndex !== fromIndex + 1 || destinationEvent !== originEvent + 1) {
    throw new Error('Another event or rest occurs before this tie destination.');
  }
  if (!samePitch(from.note, to.note)) throw new Error('Tie endpoints must have the same pitch.');
  const linked = linkedStaffNotes(document);
  const origins = [from.note, ...linked(from.note)];
  const destinations = [to.note, ...linked(to.note)];
  if (origins.length !== destinations.length || origins.some((note, index) => !samePitch(note, destinations[index]))) {
    throw new Error('Paired notation tie endpoints cannot be matched safely.');
  }
  if ([...origins, ...destinations].some(note => transitionMarkers(note).length)) {
    throw new Error('A tie endpoint already has a tie or competing transition. Remove it first.');
  }
  origins.forEach(note => addTieMarker(note, 'start'));
  destinations.forEach(note => addTieMarker(note, 'stop'));
  return new XMLSerializer().serializeToString(document);
}

export function removeMusicXmlTie(source: string, score: model.Score, position: TiePosition): string {
  const document = parseDocument(source);
  const records = tieSourceRecords(document, score);
  const selected = tieRecord(records, position);
  const lane = records.filter(record => record.voice === selected.voice && record.string === selected.string);
  const selectedIndex = lane.indexOf(selected);
  const outgoing = descendants(selected.note, 'tie').some(marker => marker.getAttribute('type') === 'start');
  const incoming = descendants(selected.note, 'tie').some(marker => marker.getAttribute('type') === 'stop');
  if (!outgoing && !incoming) throw new Error('The selected note has no tie to remove.');
  const other = lane[selectedIndex + (outgoing ? 1 : -1)];
  if (!other || !samePitch(selected.note, other.note)
    || !descendants(other.note, 'tie').some(marker => marker.getAttribute('type') === (outgoing ? 'stop' : 'start'))) {
    throw new Error('The other tie endpoint cannot be identified safely.');
  }
  const linked = linkedStaffNotes(document);
  for (const note of [selected.note, ...linked(selected.note)]) removeTieMarker(note, outgoing ? 'start' : 'stop');
  for (const note of [other.note, ...linked(other.note)]) removeTieMarker(note, outgoing ? 'stop' : 'start');
  return new XMLSerializer().serializeToString(document);
}

export type GraceTransition = 'none' | 'hammer-on' | 'pull-off' | 'slide';

export const TRANSITION_LABELS: Record<Exclude<GraceTransition, 'none'>, string> = { 'hammer-on': 'hammer-on', 'pull-off': 'pull-off', slide: 'slide' };

export function transitionMarkersOf(note: Element) {
  const technical = noteTechnical(note);
  const notations = child(note, 'notations');
  return [
    ...(technical ? children(technical).filter(item => item.localName === 'hammer-on' || item.localName === 'pull-off') : []),
    ...(notations ? children(notations).filter(item => item.localName === 'slide') : []),
  ];
}

export function addTransitionMarker(note: Element, kind: Exclude<GraceTransition, 'none'>, type: 'start' | 'stop', slideNumber: number) {
  const document = note.ownerDocument!;
  const notations = ensureNotations(note);
  const marker = document.createElement(kind);
  marker.setAttribute('type', type);
  if (kind === 'slide') {
    marker.setAttribute('number', String(slideNumber));
    notations.appendChild(marker);
    return;
  }
  if (type === 'start') marker.textContent = kind === 'hammer-on' ? 'H' : 'PO';
  ensure(notations, 'technical').appendChild(marker);
}

export type PickingHand = 'none' | 'T' | 'I' | 'M';

export type FrettingHand = 'none' | '1' | '2' | '3' | '4' | 'T';

export type BendAmount = 1 | 2 | 3 | 4;

export type NoteBend = { amount: BendAmount; shape: 'bend' | 'release' };

// A null hand or bend value is a source marking the editor keeps read-only;
// its reason says exactly what would otherwise be normalized.
export type NoteTechniqueInfo = {
  picking: PickingHand | null; pickingReason?: string;
  fretting: FrettingHand | null; frettingReason?: string;
  bend: NoteBend | 'none' | null; bendReason?: string;
};

export function annotatedSourceNote(document: Document, score: model.Score, position: TiePosition) {
  const part = scorePart(document);
  if (!part || directMeasures(part).length !== score.masterBars.length) throw new Error('The source measure count does not match the rendered score.');
  const matches = sourceTabNoteRecords(document).filter(record => record.measure === position.measure && record.beat === position.beat
    && record.voice === String(position.voice) && record.string === position.string && record.fret === position.fret);
  if (matches.length !== 1) throw new Error('The selected note cannot be uniquely identified in the source.');
  return matches[0].note;
}

export function pickingValue(marker: Element): PickingHand | null {
  if (marker.localName !== 'other-technical') return null;
  const value = text(marker);
  const tef = value.match(/^TEF fingering\s+(T|Thumb|I|M)$/i);
  if (tef) return tef[1].toUpperCase().startsWith('T') ? 'T' : tef[1].toUpperCase() as PickingHand;
  if (/^(?:Unresolved TEF fingering annotation code|TEF fingering code)\s+6$/i.test(value)) return 'T';
  const pdf = value.match(/^TEF right-hand fingering\s+([mpt])$/i);
  return pdf ? (pdf[1].toLowerCase() === 'm' ? 'M' : 'T') : null;
}

export const pickingMarkers = (technical: Element | undefined) => technical ? children(technical).filter(item => pickingValue(item) !== null) : [];

export const frettingMarkers = (technical: Element | undefined) => technical ? children(technical).filter(item => item.localName === 'fingering') : [];

export function readHands(note: Element): Pick<NoteTechniqueInfo, 'picking' | 'pickingReason' | 'fretting' | 'frettingReason'> {
  const technical = noteTechnical(note);
  const picking = pickingMarkers(technical);
  const fretting = frettingMarkers(technical);
  const result: Pick<NoteTechniqueInfo, 'picking' | 'pickingReason' | 'fretting' | 'frettingReason'> = { picking: 'none', fretting: 'none' };
  if (picking.length > 1) Object.assign(result, { picking: null, pickingReason: 'This note has more than one picking-hand marking; it is kept as written.' });
  else if (picking.length) result.picking = pickingValue(picking[0]);
  const finger = text(fretting[0]);
  if (fretting.length > 1) Object.assign(result, { fretting: null, frettingReason: 'This note has more than one fretting-hand marking; it is kept as written.' });
  else if (fretting.length && /^[1-4]$/.test(finger)) result.fretting = finger as FrettingHand;
  else if (fretting.length && /^t$/i.test(finger)) result.fretting = 'T';
  else if (fretting.length) Object.assign(result, { fretting: null, frettingReason: `The fretting-hand marking “${finger}” is kept as written.` });
  return result;
}

export function readBend(note: Element): Pick<NoteTechniqueInfo, 'bend' | 'bendReason'> {
  const technical = noteTechnical(note);
  const bends = technical ? children(technical).filter(item => item.localName === 'bend') : [];
  if (!bends.length) return { bend: 'none' };
  const plain = (bend: Element, release: boolean) => !bend.attributes.length
    && children(bend).map(item => item.localName).join(',') === (release ? 'bend-alter,release' : 'bend-alter')
    && !(release && child(bend, 'release')!.attributes.length);
  const amount = Number(text(child(bends[0], 'bend-alter'))) as BendAmount;
  const supported = [1, 2, 3, 4].includes(amount);
  if (supported && bends.length === 1 && plain(bends[0], false)) return { bend: { amount, shape: 'bend' } };
  if (supported && bends.length === 2 && plain(bends[0], false) && plain(bends[1], true)
    && Number(text(child(bends[1], 'bend-alter'))) === amount) return { bend: { amount, shape: 'release' } };
  const alter = text(child(bends[0], 'bend-alter'));
  const detail = bends.some(bend => child(bend, 'pre-bend')) ? 'a pre-bend'
    : bends.length === 1 && child(bends[0], 'release') ? 'a release-only bend curve'
      : bends.length > 2 ? `a ${bends.length}-part bend curve`
        : !supported ? `a ${alter || 'unspecified'}-semitone bend` : 'a styled bend';
  return { bend: null, bendReason: `This imported bend (${detail}) is kept as written. Applying a bend here replaces it.` };
}

export function inspectMusicXmlNoteTechniques(source: string, score: model.Score, position: TiePosition): NoteTechniqueInfo {
  const note = annotatedSourceNote(readDocument(source), score, position);
  return { ...readHands(note), ...readBend(note) };
}

export function technicalFor(note: Element) {
  return ensure(ensureNotations(note), 'technical');
}

// Only the chosen hand's marking changes; techniques, the other hand and
// unrelated source markings stay exactly as written.
export function setMusicXmlHand(source: string, score: model.Score, position: TiePosition, hand: 'picking' | 'fretting',
  value: PickingHand | FrettingHand): string {
  const document = parseDocument(source);
  const note = annotatedSourceNote(document, score, position);
  const current = readHands(note);
  if (hand === 'picking' ? current.picking === null : current.fretting === null) {
    throw new Error((hand === 'picking' ? current.pickingReason : current.frettingReason)!);
  }
  if ((hand === 'picking' ? current.picking : current.fretting) === value) return source;
  const allowed = hand === 'picking' ? ['none', 'T', 'I', 'M'] : ['none', '1', '2', '3', '4', 'T'];
  if (!allowed.includes(value)) throw new Error(`Choose a supported ${hand === 'picking' ? 'picking' : 'fretting'}-hand value.`);
  const technical = technicalFor(note);
  (hand === 'picking' ? pickingMarkers(technical) : frettingMarkers(technical)).forEach(item => technical.removeChild(item));
  if (value !== 'none') {
    const marker = document.createElement(hand === 'picking' ? 'other-technical' : 'fingering');
    if (hand === 'picking') marker.textContent = `TEF fingering ${value}`;
    else { marker.setAttribute('enclosure', 'circle'); marker.textContent = value === 'T' ? 't' : value; }
    technical.appendChild(marker);
  }
  return new XMLSerializer().serializeToString(document);
}

// Writes a canonical bend (or removes all bends with null) on the TAB note
// and its verified notation partner. This explicit action is also the only
// way an unsupported imported curve is replaced.
export function setMusicXmlBend(source: string, score: model.Score, position: TiePosition, bend: NoteBend | null): string {
  if (bend && (![1, 2, 3, 4].includes(bend.amount) || !['bend', 'release'].includes(bend.shape))) {
    throw new Error('Choose a bend of 1/2, 1, 1½ or 2 steps with a Bend or Bend and release shape.');
  }
  const document = parseDocument(source);
  const note = annotatedSourceNote(document, score, position);
  const current = readBend(note).bend;
  if (bend === null ? current === 'none' : current !== null && current !== 'none' && current.amount === bend.amount && current.shape === bend.shape) return source;
  const paired = linkedStaffNotes(document)(note);
  for (const target of [note, ...paired]) {
    const technical = noteTechnical(target);
    if (technical) children(technical).filter(item => item.localName === 'bend').forEach(item => technical.removeChild(item));
    if (!bend) {
      if (technical && !children(technical).length) technical.parentNode!.removeChild(technical);
      const notations = child(target, 'notations');
      if (notations && !children(notations).length) target.removeChild(notations);
      continue;
    }
    const destination = technicalFor(target);
    const shapes = bend.shape === 'release' ? [false, true] : [false];
    for (const release of shapes) {
      const element = document.createElement('bend');
      setText(element, 'bend-alter', String(bend.amount));
      if (release) element.appendChild(document.createElement('release'));
      destination.appendChild(element);
    }
  }
  return new XMLSerializer().serializeToString(document);
}

export type TransitionKind = 'tie' | 'hammer-on' | 'pull-off' | 'slide';

export type NoteTransition = { kind: TransitionKind; direction: 'outgoing' | 'incoming'; other: { measure: number; event: number; fret: number } | null };

export const TRANSITION_KINDS: TransitionKind[] = ['tie', 'hammer-on', 'pull-off', 'slide'];

export function transitionLane(document: Document, score: model.Score, position: TiePosition) {
  const part = scorePart(document);
  if (!part || directMeasures(part).length !== score.masterBars.length) throw new Error('The source measure count does not match the rendered score.');
  const records = sourceTabNoteRecords(document);
  const matches = records.filter(record => record.measure === position.measure && record.beat === position.beat
    && record.voice === String(position.voice) && record.string === position.string && record.fret === position.fret);
  if (matches.length !== 1) throw new Error('The selected note cannot be uniquely identified in the source.');
  const record = matches[0];
  return { record, lane: records.filter(item => item.voice === record.voice && item.string === record.string) };
}

export function kindMarkers(note: Element, kind: TransitionKind, type: 'start' | 'stop') {
  const names = kind === 'tie' ? ['tie', 'tied'] : [kind];
  return descendants(note, names[0]).concat(names[1] ? descendants(note, names[1]) : [])
    .filter(marker => (marker.getAttribute('type') || (kind === 'tie' ? '' : 'start')) === type);
}

export function inspectMusicXmlTransitions(source: string, score: model.Score, position: TiePosition): NoteTransition[] {
  const { record, lane } = transitionLane(readDocument(source), score, position);
  const index = lane.indexOf(record);
  return TRANSITION_KINDS.flatMap(kind => (['outgoing', 'incoming'] as const).flatMap(direction => {
    if (!kindMarkers(record.note, kind, direction === 'outgoing' ? 'start' : 'stop').length) return [];
    const other = lane[index + (direction === 'outgoing' ? 1 : -1)];
    return [{ kind, direction, other: other ? { measure: other.measure + 1, event: other.beat + 1, fret: other.fret } : null }];
  }));
}

// Hammer-on, pull-off and slide join a note to the next note on the same
// string and voice; ties keep their dedicated command and checks.
export function connectMusicXmlTransition(source: string, score: model.Score, kind: TransitionKind, origin: TiePosition, destination: TiePosition): string {
  if (kind === 'tie') return connectMusicXmlTie(source, score, origin, destination);
  const label = TRANSITION_LABELS[kind];
  if (origin.voice !== destination.voice) throw new Error(`A ${label} must stay in the same voice.`);
  if (origin.string !== destination.string) throw new Error(`A ${label} must stay on the same string.`);
  const document = parseDocument(source);
  const from = transitionLane(document, score, origin);
  const to = transitionLane(document, score, destination);
  const fromIndex = from.lane.indexOf(from.record);
  const toIndex = from.lane.findIndex(record => record.note === to.record.note);
  if (toIndex <= fromIndex) throw new Error(`The ${label} destination must come after the origin.`);
  if (toIndex !== fromIndex + 1) throw new Error(`Another note on string ${origin.string} comes first. A ${label} must end on the next note on that string.`);
  if (kind === 'hammer-on' && !(to.record.fret > from.record.fret)) throw new Error('A hammer-on must go to a higher fret.');
  if (kind === 'pull-off' && !(to.record.fret < from.record.fret)) throw new Error('A pull-off must go to a lower fret.');
  if (kind === 'slide' && to.record.fret === from.record.fret) throw new Error('A slide must go to a different fret.');
  const outgoing = ['hammer-on', 'pull-off', 'slide', 'glissando', 'tie', 'tied'].some(name => descendants(from.record.note, name).some(marker => (marker.getAttribute('type') || 'start') === 'start'));
  if (outgoing) throw new Error('The origin already starts a tie or transition. Remove it before adding another.');
  const incoming = ['hammer-on', 'pull-off', 'slide', 'glissando', 'tie', 'tied'].some(name => descendants(to.record.note, name).some(marker => marker.getAttribute('type') === 'stop'));
  if (incoming) throw new Error('The destination already ends a tie or transition. Remove it before adding another.');
  const linked = linkedStaffNotes(document);
  const origins = [from.record.note, ...linked(from.record.note)];
  const destinations = [to.record.note, ...linked(to.record.note)];
  if (origins.length !== destinations.length) throw new Error('Paired notation endpoints cannot be matched safely.');
  let slideNumber = 1;
  if (kind === 'slide') {
    const measures = new Set([from.record.note.parentNode, to.record.note.parentNode]);
    const used = new Set([...measures].flatMap(measure => descendants(measure as Element, 'slide').concat(descendants(measure as Element, 'glissando')))
      .map(marker => Number(marker.getAttribute('number') || '1')));
    while (used.has(slideNumber)) slideNumber++;
  }
  origins.forEach(note => addTransitionMarker(note, kind, 'start', slideNumber));
  destinations.forEach(note => addTransitionMarker(note, kind, 'stop', slideNumber));
  return new XMLSerializer().serializeToString(document);
}

export function removeMusicXmlTransition(source: string, score: model.Score, position: TiePosition, kind: TransitionKind, direction: 'outgoing' | 'incoming'): string {
  if (kind === 'tie') return removeMusicXmlTie(source, score, position);
  const document = parseDocument(source);
  const { record, lane } = transitionLane(document, score, position);
  const own = kindMarkers(record.note, kind, direction === 'outgoing' ? 'start' : 'stop');
  if (own.length !== 1) throw new Error(`The selected note has no ${TRANSITION_LABELS[kind]} to remove.`);
  const other = lane[lane.indexOf(record) + (direction === 'outgoing' ? 1 : -1)];
  const number = own[0].getAttribute('number') || '1';
  const counterpart = other && kindMarkers(other.note, kind, direction === 'outgoing' ? 'stop' : 'start')
    .filter(marker => kind !== 'slide' || (marker.getAttribute('number') || '1') === number);
  if (!other || counterpart?.length !== 1) throw new Error(`The other ${TRANSITION_LABELS[kind]} endpoint cannot be identified safely.`);
  const linked = linkedStaffNotes(document);
  const strip = (note: Element, type: 'start' | 'stop') => {
    for (const marker of kindMarkers(note, kind, type).filter(item => kind !== 'slide' || (item.getAttribute('number') || '1') === number)) {
      const parent = marker.parentNode as Element;
      parent.removeChild(marker);
      if (parent.localName === 'technical' && !children(parent).length) parent.parentNode!.removeChild(parent);
    }
    const notations = child(note, 'notations');
    if (notations && !children(notations).length) note.removeChild(notations);
  };
  for (const note of [record.note, ...linked(record.note)]) strip(note, direction === 'outgoing' ? 'start' : 'stop');
  for (const note of [other.note, ...linked(other.note)]) strip(note, direction === 'outgoing' ? 'stop' : 'start');
  return new XMLSerializer().serializeToString(document);
}
