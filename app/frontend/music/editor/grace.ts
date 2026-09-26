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

// A grace group before its event (played just before it), or after it (an
// after-grace: played at the end of the event, e.g. into the barline).
export type GracePlacement = 'before' | 'after';

// `destination` is the ordinary event the group belongs to; `first` is the
// index of the group's first grace event.
export type GraceGroupInfo = { destination: number; first: number; placement: GracePlacement; events: GraceEventSpec[]; readOnly: string[]; connections: string[] };

// MusicXML marks an after-grace with steal-time-previous: it takes its time
// from the preceding note rather than belonging to the following one.
export const AFTER_GRACE_STEAL = '25';

export const GRACE_TRANSITIONS: GraceTransition[] = ['none', 'hammer-on', 'pull-off', 'slide'];

export const isGraceGroup = (group: Element[] | undefined) => Boolean(group?.length && group.every(note => child(note, 'grace')));
export const isAfterGraceGroup = (group: Element[] | undefined) => isGraceGroup(group)
  && group!.every(note => Number(child(note, 'grace')!.getAttribute('steal-time-previous')) > 0);
const isBeforeGraceGroup = (group: Element[] | undefined) => isGraceGroup(group) && !isAfterGraceGroup(group);

export function locateGraceGroup(source: string, score: model.Score, position: RhythmPosition, readOnly = false, placement: GracePlacement = 'before') {
  const document = readOnly ? readDocument(source) : parseDocument(source);
  const part = scorePart(document);
  const measure = part && directMeasures(part)[position.measure];
  const beats = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice]?.beats;
  // A selected grace note leads to the ordinary event its group belongs to.
  let destination = position.beat;
  if (placement === 'before') while (beats?.[destination]?.graceType) destination++;
  else while (destination > 0 && beats?.[destination]?.graceType) destination--;
  const rendered = beats?.[destination];
  if (!measure || !rendered || rendered.graceType || rendered.isRest) {
    throw new Error(placement === 'before' ? 'Select an ordinary sounding event as the grace destination.' : 'Select an ordinary sounding event to add grace notes after it.');
  }
  const tabStaff = sourceTabStaff(document);
  const lanes = rhythmLanes(document, measure, tabStaff, String(position.voice + 1), destination);
  let first = destination;
  let end = destination;
  if (placement === 'before') while (first > 0 && isBeforeGraceGroup(lanes[0].groups[first - 1])) first--;
  else { first = end = destination + 1; while (isAfterGraceGroup(lanes[0].groups[end])) end++; }
  const inGroup = placement === 'before' ? isBeforeGraceGroup : isAfterGraceGroup;
  for (const lane of lanes) {
    const target = lane.groups[destination];
    if (!target || target.some(note => child(note, 'grace') || child(note, 'rest'))) {
      throw new Error('The paired grace destination cannot be identified safely.');
    }
    const beyond = placement === 'before' ? first > 0 && inGroup(lane.groups[first - 1]) : inGroup(lane.groups[end]);
    if (lane.groups.slice(first, end).some(group => !inGroup(group)) || beyond) {
      throw new Error('The paired grace group cannot be matched safely.');
    }
  }
  return { document, part: part!, measure: measure!, tabStaff, lanes, first, end, destination, placement };
}

// Where the grace group containing a grace event sits, or null for an
// ordinary event.
export function graceEventPlacement(source: string, score: model.Score, position: RhythmPosition): GracePlacement | null {
  const document = readDocument(source);
  const part = scorePart(document);
  const measure = part && directMeasures(part)[position.measure];
  if (!measure) return null;
  const groups = rhythmLanes(document, measure, sourceTabStaff(document), String(position.voice + 1), position.beat)[0].groups;
  const group = groups[position.beat];
  return isAfterGraceGroup(group) ? 'after' : isGraceGroup(group) ? 'before' : null;
}

// Reports the first source detail that the grace dialog would not rewrite
// faithfully. Such a group stays read-only: it can be kept or removed whole.
export function unsupportedGraceDetail(note: Element, tab: boolean, placement: GracePlacement = 'before'): string | null {
  if (note.attributes.length) return `a ${note.attributes[0].name} note attribute`;
  const grace = child(note, 'grace')!;
  if (grace.getAttribute('slash') !== 'yes') return 'an unslashed grace';
  const known = placement === 'after' ? ['slash', 'steal-time-previous'] : ['slash'];
  const extra = Array.from(grace.attributes).find(attribute => !known.includes(attribute.name));
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

// Reads each grace event. For a group before an event, a note's transition
// leads out of it to the next note on its string (a later grace or the
// destination). For an after-grace group it leads into the grace from the
// previous note on its string (the main event or an earlier grace).
export function readGraceEvents(located: ReturnType<typeof locateGraceGroup>) {
  const { lanes, first, end, destination, tabStaff, placement } = located;
  const tabGroups = lanes[0].groups;
  const readOnly: string[] = [];
  const events: GraceEventSpec[] = [];
  const lastInScope = placement === 'before' ? destination : end - 1;
  const firstInScope = placement === 'before' ? first : destination;
  const nextOnString = (eventIndex: number, string: number) => {
    for (let index = eventIndex + 1; index <= lastInScope; index++) {
      const match = tabGroups[index].find(note => tabStringOf(note) === string);
      if (match) return match;
    }
    return null;
  };
  const previousOnString = (eventIndex: number, string: number) => {
    for (let index = eventIndex - 1; index >= firstInScope; index--) {
      const match = tabGroups[index].find(note => tabStringOf(note) === string);
      if (match) return match;
    }
    return null;
  };
  for (let index = first; index < end; index++) {
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
        const detail = unsupportedGraceDetail(note, lane.staff === tabStaff, placement);
        if (detail) readOnly.push(`${label}${lane.staff === tabStaff ? `, string ${tabStringOf(note)}` : ' on the notation staff'} has ${detail}.`);
      }
    }
    const notes = group.map(note => {
      const string = tabStringOf(note);
      let transition: GraceTransition = 'none';
      const markers = transitionMarkersOf(note);
      const starts = markers.filter(marker => marker.getAttribute('type') === 'start');
      const stops = markers.filter(marker => marker.getAttribute('type') === 'stop');
      if (markers.some(marker => marker.getAttribute('type') !== 'start' && marker.getAttribute('type') !== 'stop')) {
        readOnly.push(`${label}, string ${string} has an unfamiliar transition marker.`);
      }
      const connects = (from: Element | null, name: string, type: 'start' | 'stop') =>
        Boolean(from && transitionMarkersOf(from).some(marker => marker.localName === name && marker.getAttribute('type') === type));
      if (placement === 'before') {
        if (starts.length > 1) readOnly.push(`${label}, string ${string} starts more than one transition.`);
        if (starts.length === 1) {
          transition = starts[0].localName as GraceTransition;
          if (!connects(nextOnString(index, string), starts[0].localName, 'stop')) {
            readOnly.push(`${label}, string ${string} has a ${TRANSITION_LABELS[transition as Exclude<GraceTransition, 'none'>]} without its next-note endpoint.`);
          }
        }
        for (const stop of stops) {
          if (!connects(previousOnString(index, string), stop.localName, 'start')) readOnly.push(`${label}, string ${string} ends a ${stop.localName} that starts outside the grace group.`);
        }
      } else {
        if (stops.length > 1) readOnly.push(`${label}, string ${string} ends more than one transition.`);
        if (stops.length === 1) {
          transition = stops[0].localName as GraceTransition;
          if (!connects(previousOnString(index, string), stops[0].localName, 'start')) {
            readOnly.push(`${label}, string ${string} ends a ${stops[0].localName} that starts outside the main note and grace group.`);
          }
        }
        for (const start of starts) {
          if (!connects(nextOnString(index, string), start.localName, 'stop')) readOnly.push(`${label}, string ${string} starts a ${start.localName} that leaves the grace group.`);
        }
      }
      return { string, fret: tabFretOf(note), transition };
    });
    events.push({ denominator, notes });
  }
  return { events, readOnly: [...new Set(readOnly)] };
}

export function inspectMusicXmlGraceGroup(source: string, score: model.Score, position: RhythmPosition, placement: GracePlacement = 'before'): GraceGroupInfo {
  const located = locateGraceGroup(source, score, position, true, placement);
  const { events, readOnly } = readGraceEvents(located);
  const existing = located.lanes.flatMap(lane => lane.groups.slice(located.first, located.end).flat());
  return { destination: located.destination, first: located.first, placement, events, readOnly, connections: attachedDependencies(existing) };
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

// Replaces the supported grace group before or after an ordinary event (or
// creates one). Everything is validated on a scratch document, so an invalid
// transition leaves the source untouched.
export function applyMusicXmlGraceGroup(source: string, score: model.Score, position: RhythmPosition, events: GraceEventSpec[],
  placement: GracePlacement = 'before'): string {
  validateGraceEvents(events);
  const located = locateGraceGroup(source, score, position, false, placement);
  const { document, part, measure, tabStaff, lanes, first, end, destination } = located;
  const current = readGraceEvents(located);
  if (current.readOnly.length) throw new Error(`This grace group is read-only: ${current.readOnly[0]}`);
  const tuning = openTabTuning(score);
  const linked = linkedStaffNotes(document);
  const destinationTab = lanes[0].groups[destination];
  const pairedTechnical = lanes.map(lane => lane.staff !== tabStaff
    && lane.groups.slice(first, end).flat().some(note => child(noteTechnical(note) ?? note, 'string')));
  repairAndDeleteNotes(document, part, lanes.flatMap(lane => lane.groups.slice(first, end).flat()));
  const graceStrings = new Set(events.flatMap(event => event.notes.map(member => member.string)));
  const spanNames = ['hammer-on', 'pull-off', 'slide', 'glissando', 'tie', 'tied'];
  const interrupted = (type: 'start' | 'stop') => destinationTab.some(note => graceStrings.has(tabStringOf(note))
    && spanNames.some(name => descendants(note, name).some(marker => marker.getAttribute('type') === type)));
  if (placement === 'before' ? interrupted('stop') : interrupted('start')) {
    throw new Error('A grace note on this string would interrupt an existing technique endpoint. Remove or move that span first.');
  }
  const created = lanes.map((lane, laneIndex) => {
    // Before: ahead of the destination. After: right behind the main event.
    const destinationGroup = lane.groups[destination];
    let cursor: Element = destinationGroup[destinationGroup.length - 1];
    return events.map(event => event.notes.map((member, index) => {
      const midi = tuning[member.string - 1] + member.fret;
      if (!Number.isInteger(midi)) throw new Error('The selected grace string has no valid tuning.');
      const note = document.createElement('note');
      const grace = document.createElement('grace'); grace.setAttribute('slash', 'yes');
      if (placement === 'after') grace.setAttribute('steal-time-previous', AFTER_GRACE_STEAL);
      note.appendChild(grace);
      if (index) note.appendChild(document.createElement('chord'));
      setPitch(note, midi);
      setText(note, 'voice', lane.voice);
      if (event.denominator) setText(note, 'type', event.denominator === 8 ? 'eighth' : '16th');
      setText(note, 'staff', String(lane.staff));
      if (lane.staff === tabStaff || pairedTechnical[laneIndex]) {
        const technical = ensure(ensure(note, 'notations'), 'technical');
        setText(technical, 'string', String(member.string)); setText(technical, 'fret', String(member.fret));
      }
      if (placement === 'before') measure.insertBefore(note, destinationGroup[0]);
      else { measure.insertBefore(note, cursor.nextSibling); cursor = note; }
      return note;
    }));
  });
  const usedSlides = new Set(descendants(measure, 'slide').concat(descendants(measure, 'glissando')).map(item => Number(item.getAttribute('number') || '1')));
  const withPartners = (main: Element, where: string) => {
    const paired = linked(main);
    if (paired.length !== lanes.length - 1) throw new Error(`${where}: the main note cannot be matched on the notation staff.`);
    return [main, ...paired];
  };
  events.forEach((event, eventIndex) => event.notes.forEach((member, memberIndex) => {
    if (member.transition === 'none') return;
    const where = `Grace event ${eventIndex + 1}, string ${member.string}`;
    const label = TRANSITION_LABELS[member.transition];
    const grace = created.map(lane => lane[eventIndex][memberIndex]);
    // The other end: before a destination it is the next note on the string;
    // after an event it is the previous one.
    let other: Element[] | null = null;
    let otherFret = 0;
    const step = placement === 'before' ? 1 : -1;
    for (let at = eventIndex + step; at >= 0 && at < events.length && !other; at += step) {
      const index = events[at].notes.findIndex(candidate => candidate.string === member.string);
      if (index >= 0) { other = created.map(lane => lane[at][index]); otherFret = events[at].notes[index].fret; }
    }
    if (!other) {
      const main = destinationTab.find(note => tabStringOf(note) === member.string);
      if (main) { other = withPartners(main, where); otherFret = tabFretOf(main); }
    }
    if (!other) {
      throw new Error(placement === 'before'
        ? `${where}: the ${label} needs a later note on string ${member.string} in this group or at the destination.`
        : `${where}: the ${label} needs a note on string ${member.string} in the main event or an earlier grace event.`);
    }
    const [fromFret, toFret] = placement === 'before' ? [member.fret, otherFret] : [otherFret, member.fret];
    const endpoint = placement === 'before' ? 'on its next note' : 'than the note it comes from';
    if (member.transition === 'hammer-on' && !(toFret > fromFret)) throw new Error(`${where}: a hammer-on needs a higher fret ${endpoint} (fret ${placement === 'before' ? toFret : fromFret}).`);
    if (member.transition === 'pull-off' && !(toFret < fromFret)) throw new Error(`${where}: a pull-off needs a lower fret ${endpoint} (fret ${placement === 'before' ? toFret : fromFret}).`);
    if (member.transition === 'slide' && toFret === fromFret) throw new Error(`${where}: a slide needs a different fret ${placement === 'before' ? 'on its next note' : 'from the note it comes from'}.`);
    let slideNumber = 1;
    if (member.transition === 'slide') { while (usedSlides.has(slideNumber)) slideNumber++; usedSlides.add(slideNumber); }
    const [origins, targets] = placement === 'before' ? [grace, other] : [other, grace];
    origins.forEach(note => addTransitionMarker(note, member.transition as Exclude<GraceTransition, 'none'>, 'start', slideNumber));
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
  if (located.first < located.end) throw new Error('This destination already has a grace group. Edit that group instead.');
  return applyMusicXmlGraceGroup(source, score, position, [{ denominator, notes: members.map(member => ({ ...member, transition: 'none' })) }]);
}

// The explicit whole-group removal offered beside a read-only grace group.
// Unsupported grace details go with the group; known spans are disconnected.
export function removeMusicXmlGraceGroup(source: string, score: model.Score, position: RhythmPosition,
  placement: GracePlacement = 'before'): { source: string; dependencies: string[] } {
  const { document, part, lanes, first, end } = locateGraceGroup(source, score, position, false, placement);
  if (first === end) throw new Error('This event has no grace group to remove.');
  const existing = lanes.flatMap(lane => lane.groups.slice(first, end).flat());
  const dependencies = attachedDependencies(existing);
  repairAndDeleteNotes(document, part, existing);
  return { source: new XMLSerializer().serializeToString(document), dependencies };
}
