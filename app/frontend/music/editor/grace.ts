// Grace groups: inspection, rewriting, and removal of grace events.
import type { model } from '@coderline/alphatab';
import { child, children, descendants, directMeasures, ensure, noteTechnical, parseDocument, readDocument, scorePart, setPitch, setText, sourceTabStaff, tabFretOf, tabStringOf, text } from './xml';
import { linkedStaffNotes } from './records';
import { rhythmLanes, type RhythmPosition } from './time';
import { attachedDependencies, protectedNoteAttachment, repairAndDeleteNotes, type RemovalPosition } from './notes';
import { TRANSITION_LABELS, addTransitionMarker, transitionMarkersOf, type GraceTransition } from './techniques';
import { openTabTuning } from './tuning';

export type GraceRemoval = { source: string; dependencies: string[]; groupRemoved: boolean };

// Removes one string of a grace event, or the whole event when no string is
// given (or its last string is selected). Grace notes own no measure time, so
// no rest is left behind; the group disappears with its final event.
export function removeMusicXmlGrace(source: string, score: model.Score, position: RemovalPosition): GraceRemoval {
  const document = parseDocument(source);
  const part = scorePart(document);
  const measure = part && directMeasures(part)[position.measure];
  const rendered = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice]?.beats?.[position.beat];
  if (!measure || !rendered?.graceType) throw new Error('Select a grace note to remove it.');
  const tabStaff = sourceTabStaff(document);
  const lanes = rhythmLanes(document, measure, tabStaff, String(position.voice + 1), position.beat);
  const groups = lanes[0].groups;
  const target = groups[position.beat];
  const isGrace = (group: Element[] | undefined) => Boolean(group?.length && group.every(note => child(note, 'grace')));
  const members = (group: Element[]) => group.map(note => {
    const technical = child(child(note, 'notations') ?? note, 'technical');
    return `${text(child(technical ?? note, 'string'))}:${text(child(technical ?? note, 'fret'))}`;
  }).sort().join('|');
  if (!isGrace(target) || members(target) !== rendered.notes.map(note => `${6 - note.string}:${note.fret}`).sort().join('|')) {
    throw new Error('The source grace event does not match the selected grace note.');
  }
  const selected = position.string === undefined ? target : target.filter(note => {
    const technical = child(child(note, 'notations') ?? note, 'technical');
    return Number(text(child(technical ?? note, 'string'))) === position.string;
  });
  if (selected.length === 0) throw new Error('The selected grace string cannot be matched safely.');
  const wholeEvent = selected.length === target.length;
  const groupRemoved = wholeEvent && !isGrace(groups[position.beat - 1]) && !isGrace(groups[position.beat + 1]);
  const linked = linkedStaffNotes(document);
  const paired = selected.flatMap(note => {
    const matches = linked(note);
    if (matches.length !== lanes.length - 1) throw new Error('The paired notation grace note cannot be matched safely for removal.');
    return matches;
  });
  const all = [...selected, ...paired];
  for (const note of all) {
    const attachment = protectedNoteAttachment(note);
    if (attachment) throw new Error(`This grace note has a protected ${attachment} attachment that Playtab cannot remove safely.`);
  }
  const dependencies = attachedDependencies(all);
  repairAndDeleteNotes(document, part, all);
  return { source: new XMLSerializer().serializeToString(document), dependencies, groupRemoved };
}

export type GraceMember = { string: number; fret: number };

export type GraceNoteSpec = GraceMember & { transition: GraceTransition };

// A null denominator is an imported grace event without a <type>; it stays
// unwritten so opening and applying the dialog never normalizes it.
export type GraceEventSpec = { denominator: 8 | 16 | null; notes: GraceNoteSpec[] };

export type GraceGroupInfo = { destination: number; events: GraceEventSpec[]; readOnly: string[]; connections: string[] };

export const GRACE_TRANSITIONS: GraceTransition[] = ['none', 'hammer-on', 'pull-off', 'slide'];

export const isGraceGroup = (group: Element[] | undefined) => Boolean(group?.length && group.every(note => child(note, 'grace')));

export function locateGraceGroup(source: string, score: model.Score, position: RhythmPosition, readOnly = false) {
  const document = readOnly ? readDocument(source) : parseDocument(source);
  const part = scorePart(document);
  const measure = part && directMeasures(part)[position.measure];
  const beats = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice]?.beats;
  let destination = position.beat;
  while (beats?.[destination]?.graceType) destination++;
  const rendered = beats?.[destination];
  if (!measure || !rendered || rendered.graceType || rendered.isRest) {
    throw new Error('Select an ordinary sounding event as the grace destination.');
  }
  const tabStaff = sourceTabStaff(document);
  const lanes = rhythmLanes(document, measure, tabStaff, String(position.voice + 1), destination);
  let first = destination;
  while (first > 0 && isGraceGroup(lanes[0].groups[first - 1])) first--;
  for (const lane of lanes) {
    const target = lane.groups[destination];
    if (!target || target.some(note => child(note, 'grace') || child(note, 'rest'))) {
      throw new Error('The paired grace destination cannot be identified safely.');
    }
    if (lane.groups.slice(first, destination).some(group => !isGraceGroup(group)) || (first > 0 && isGraceGroup(lane.groups[first - 1]))) {
      throw new Error('The paired grace group cannot be matched safely.');
    }
  }
  return { document, part: part!, measure: measure!, tabStaff, lanes, first, destination };
}

// Reports the first source detail that the grace dialog would not rewrite
// faithfully. Such a group stays read-only: it can be kept or removed whole.
export function unsupportedGraceDetail(note: Element, tab: boolean): string | null {
  if (note.attributes.length) return `a ${note.attributes[0].name} note attribute`;
  const grace = child(note, 'grace')!;
  if (grace.getAttribute('slash') !== 'yes') return 'an unslashed grace';
  const extra = Array.from(grace.attributes).find(attribute => attribute.name !== 'slash');
  if (extra) return `a grace ${extra.name} setting`;
  const allowedNote = new Set(['grace', 'chord', 'pitch', 'voice', 'type', 'staff', 'notations']);
  for (const item of children(note)) {
    if (!allowedNote.has(item.localName)) return `a ${item.localName} element`;
    if (item.localName === 'pitch' && children(item).some(part => !['step', 'alter', 'octave'].includes(part.localName))) return 'an unfamiliar pitch detail';
  }
  const notations = child(note, 'notations');
  for (const item of notations ? children(notations) : []) {
    if (item.localName === 'slide') {
      if (Array.from(item.attributes).some(attribute => attribute.name !== 'type' && attribute.name !== 'number') || text(item)) return 'a styled slide';
      continue;
    }
    if (item.localName !== 'technical') return `a ${item.localName} notation`;
    for (const technical of children(item)) {
      if (technical.localName === 'other-technical') return `the marking “${text(technical)}”`;
      if (!['string', 'fret', 'hammer-on', 'pull-off'].includes(technical.localName)) return `a ${technical.localName} technique`;
    }
  }
  if (tab && (!Number.isInteger(tabStringOf(note)) || !Number.isInteger(tabFretOf(note)) || !text(child(noteTechnical(note)!, 'fret')))) return 'no tablature string and fret';
  return null;
}

export function readGraceEvents(located: ReturnType<typeof locateGraceGroup>) {
  const { lanes, first, destination, tabStaff } = located;
  const tabGroups = lanes[0].groups;
  const readOnly: string[] = [];
  const events: GraceEventSpec[] = [];
  const nextOnString = (eventIndex: number, string: number) => {
    for (let index = eventIndex + 1; index <= destination; index++) {
      const match = tabGroups[index].find(note => tabStringOf(note) === string);
      if (match) return match;
    }
    return null;
  };
  for (let index = first; index < destination; index++) {
    const label = `Grace event ${index - first + 1}`;
    const group = tabGroups[index];
    const types = new Set(group.map(note => text(child(note, 'type'))));
    const type = [...types][0];
    let denominator: 8 | 16 | null = null;
    if (types.size !== 1) readOnly.push(`${label} mixes display durations.`);
    else if (type === 'eighth') denominator = 8;
    else if (type === '16th') denominator = 16;
    else if (type) readOnly.push(`${label} uses a ${type} display duration.`);
    for (const lane of lanes) {
      for (const note of lane.groups[index]) {
        const detail = unsupportedGraceDetail(note, lane.staff === tabStaff);
        if (detail) readOnly.push(`${label}${lane.staff === tabStaff ? `, string ${tabStringOf(note)}` : ' on the notation staff'} has ${detail}.`);
      }
    }
    const notes = group.map(note => {
      const string = tabStringOf(note);
      let transition: GraceTransition = 'none';
      const markers = transitionMarkersOf(note);
      const starts = markers.filter(marker => marker.getAttribute('type') === 'start');
      if (starts.length > 1) readOnly.push(`${label}, string ${string} starts more than one transition.`);
      if (markers.some(marker => marker.getAttribute('type') !== 'start' && marker.getAttribute('type') !== 'stop')) {
        readOnly.push(`${label}, string ${string} has an unfamiliar transition marker.`);
      }
      if (starts.length === 1) {
        transition = starts[0].localName as GraceTransition;
        const target = nextOnString(index, string);
        if (!target || !transitionMarkersOf(target).some(marker => marker.localName === starts[0].localName && marker.getAttribute('type') === 'stop')) {
          readOnly.push(`${label}, string ${string} has a ${TRANSITION_LABELS[transition as Exclude<GraceTransition, 'none'>]} without its next-note endpoint.`);
        }
      }
      for (const stop of markers.filter(marker => marker.getAttribute('type') === 'stop')) {
        let origin: Element | undefined;
        for (let previous = index - 1; previous >= first && !origin; previous--) origin = tabGroups[previous].find(candidate => tabStringOf(candidate) === string);
        if (!origin || !transitionMarkersOf(origin).some(marker => marker.localName === stop.localName && marker.getAttribute('type') === 'start')) {
          readOnly.push(`${label}, string ${string} ends a ${stop.localName} that starts outside the grace group.`);
        }
      }
      return { string, fret: tabFretOf(note), transition };
    });
    events.push({ denominator, notes });
  }
  return { events, readOnly: [...new Set(readOnly)] };
}

export function inspectMusicXmlGraceGroup(source: string, score: model.Score, position: RhythmPosition): GraceGroupInfo {
  const located = locateGraceGroup(source, score, position, true);
  const { events, readOnly } = readGraceEvents(located);
  const existing = located.lanes.flatMap(lane => lane.groups.slice(located.first, located.destination).flat());
  return { destination: located.destination, events, readOnly, connections: attachedDependencies(existing) };
}

export function validateGraceEvents(events: GraceEventSpec[]) {
  if (!events.length || events.length > 8) throw new Error('A grace group needs one to eight grace events.');
  for (const event of events) {
    if (event.denominator !== 8 && event.denominator !== 16 && event.denominator !== null) throw new Error('Grace display duration must be 1/8 or 1/16.');
    if (!event.notes.length || event.notes.length > 5 || event.notes.some(member => !Number.isInteger(member.string)
      || member.string < 1 || member.string > 5 || !Number.isInteger(member.fret) || member.fret < 0 || member.fret > 36)
      || new Set(event.notes.map(member => member.string)).size !== event.notes.length) {
      throw new Error('A grace event needs one to five distinct strings with frets from 0 to 36.');
    }
    if (event.notes.some(member => !GRACE_TRANSITIONS.includes(member.transition))) throw new Error('Choose None, Hammer-on, Pull-off, or Slide for each grace transition.');
  }
}

// Replaces the supported grace group before an ordinary event (or creates
// one). Everything is validated on a scratch document, so an invalid
// transition leaves the source untouched.
export function applyMusicXmlGraceGroup(source: string, score: model.Score, position: RhythmPosition, events: GraceEventSpec[]): string {
  validateGraceEvents(events);
  const located = locateGraceGroup(source, score, position);
  const { document, part, measure, tabStaff, lanes, first, destination } = located;
  const current = readGraceEvents(located);
  if (current.readOnly.length) throw new Error(`This grace group is read-only: ${current.readOnly[0]}`);
  const tuning = openTabTuning(score);
  const linked = linkedStaffNotes(document);
  const destinationTab = lanes[0].groups[destination];
  const pairedTechnical = lanes.map(lane => lane.staff !== tabStaff
    && lane.groups.slice(first, destination).flat().some(note => child(noteTechnical(note) ?? note, 'string')));
  repairAndDeleteNotes(document, part, lanes.flatMap(lane => lane.groups.slice(first, destination).flat()));
  const graceStrings = new Set(events.flatMap(event => event.notes.map(member => member.string)));
  if (destinationTab.some(note => graceStrings.has(tabStringOf(note)) && ['hammer-on', 'pull-off', 'slide', 'glissando', 'tie', 'tied']
    .some(name => descendants(note, name).some(marker => marker.getAttribute('type') === 'stop')))) {
    throw new Error('A grace note on this string would interrupt an existing technique endpoint. Remove or move that span first.');
  }
  const created = lanes.map((lane, laneIndex) => {
    const anchor = lane.groups[destination][0];
    return events.map(event => event.notes.map((member, index) => {
      const midi = tuning[member.string - 1] + member.fret;
      if (!Number.isInteger(midi)) throw new Error('The selected grace string has no valid tuning.');
      const note = document.createElement('note');
      const grace = document.createElement('grace'); grace.setAttribute('slash', 'yes'); note.appendChild(grace);
      if (index) note.appendChild(document.createElement('chord'));
      setPitch(note, midi);
      setText(note, 'voice', lane.voice);
      if (event.denominator) setText(note, 'type', event.denominator === 8 ? 'eighth' : '16th');
      setText(note, 'staff', String(lane.staff));
      if (lane.staff === tabStaff || pairedTechnical[laneIndex]) {
        const technical = ensure(ensure(note, 'notations'), 'technical');
        setText(technical, 'string', String(member.string)); setText(technical, 'fret', String(member.fret));
      }
      measure.insertBefore(note, anchor);
      return note;
    }));
  });
  const usedSlides = new Set(descendants(measure, 'slide').concat(descendants(measure, 'glissando')).map(item => Number(item.getAttribute('number') || '1')));
  events.forEach((event, eventIndex) => event.notes.forEach((member, memberIndex) => {
    if (member.transition === 'none') return;
    const where = `Grace event ${eventIndex + 1}, string ${member.string}`;
    const origin = created.map(lane => lane[eventIndex][memberIndex]);
    let targets: Element[] | null = null;
    let targetFret = 0;
    for (let later = eventIndex + 1; later < events.length && !targets; later++) {
      const index = events[later].notes.findIndex(candidate => candidate.string === member.string);
      if (index >= 0) { targets = created.map(lane => lane[later][index]); targetFret = events[later].notes[index].fret; }
    }
    if (!targets) {
      const main = destinationTab.find(note => tabStringOf(note) === member.string);
      if (main) {
        const paired = linked(main);
        if (paired.length !== lanes.length - 1) throw new Error(`${where}: the destination note cannot be matched on the notation staff.`);
        targets = [main, ...paired]; targetFret = tabFretOf(main);
      }
    }
    const label = TRANSITION_LABELS[member.transition];
    if (!targets) throw new Error(`${where}: the ${label} needs a later note on string ${member.string} in this group or at the destination.`);
    if (member.transition === 'hammer-on' && !(targetFret > member.fret)) throw new Error(`${where}: a hammer-on needs a higher fret on its next note (fret ${targetFret}).`);
    if (member.transition === 'pull-off' && !(targetFret < member.fret)) throw new Error(`${where}: a pull-off needs a lower fret on its next note (fret ${targetFret}).`);
    if (member.transition === 'slide' && targetFret === member.fret) throw new Error(`${where}: a slide needs a different fret on its next note.`);
    let slideNumber = 1;
    if (member.transition === 'slide') { while (usedSlides.has(slideNumber)) slideNumber++; usedSlides.add(slideNumber); }
    origin.forEach(note => addTransitionMarker(note, member.transition as Exclude<GraceTransition, 'none'>, 'start', slideNumber));
    targets.forEach(note => addTransitionMarker(note, member.transition as Exclude<GraceTransition, 'none'>, 'stop', slideNumber));
  }));
  return new XMLSerializer().serializeToString(document);
}

export function addMusicXmlGraceGroup(source: string, score: model.Score, position: RhythmPosition,
  members: GraceMember[], denominator: 8 | 16): string {
  const rendered = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice]?.beats?.[position.beat];
  if (!rendered || rendered.graceType || rendered.isRest) throw new Error('Select an ordinary sounding event as the grace destination.');
  if (denominator !== 8 && denominator !== 16) throw new Error('Grace display duration must be 1/8 or 1/16.');
  const located = locateGraceGroup(source, score, position);
  if (located.first < located.destination) throw new Error('This destination already has a grace group. Edit that group instead.');
  return applyMusicXmlGraceGroup(source, score, position, [{ denominator, notes: members.map(member => ({ ...member, transition: 'none' })) }]);
}

// The explicit whole-group removal offered beside a read-only grace group.
// Unsupported grace details go with the group; known spans are disconnected.
export function removeMusicXmlGraceGroup(source: string, score: model.Score, position: RhythmPosition): { source: string; dependencies: string[] } {
  const { document, part, lanes, first, destination } = locateGraceGroup(source, score, position);
  if (first === destination) throw new Error('This event has no grace group to remove.');
  const existing = lanes.flatMap(lane => lane.groups.slice(first, destination).flat());
  const dependencies = attachedDependencies(existing);
  repairAndDeleteNotes(document, part, existing);
  return { source: new XMLSerializer().serializeToString(document), dependencies };
}
