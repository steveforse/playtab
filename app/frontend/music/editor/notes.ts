// Adding and removing notes while keeping rhythm and dependent spans intact.
import type { model } from '@coderline/alphatab';
import { child, children, descendants, directMeasures, ensure, parseDocument, placeLyric, removeChildren, scorePart, setPitch, setText, sourceTabStaff, text } from './xml';
import { linkedStaffNotes, sourceBeatGroups } from './records';
import { timingBoundary } from './time';
import { openTabTuning } from './tuning';

export type NotePosition = { measure: number; beat: number; voice: number; string: number; fret: number };

export type RemovalPosition = Pick<NotePosition, 'measure' | 'beat' | 'voice'> & { string?: number };

// Deletion must be conservative: an unfamiliar attachment may carry source
// information that cannot be reconstructed after the note is removed.
export function protectedNoteAttachment(note: Element): string | null {
  const allowed: Record<string, Set<string>> = {
    note: new Set(['chord', 'pitch', 'rest', 'duration', 'voice', 'type', 'dot', 'accidental', 'stem', 'beam', 'staff', 'notations', 'grace', 'tie', 'time-modification', 'instrument', 'lyric']),
    pitch: new Set(['step', 'alter', 'octave']),
    notations: new Set(['technical', 'tied', 'slide', 'glissando']),
    technical: new Set(['string', 'fret', 'fingering', 'other-technical', 'hammer-on', 'pull-off', 'slide', 'bend']),
    'time-modification': new Set(['actual-notes', 'normal-notes', 'normal-type', 'normal-dot']),
  };
  const inspect = (parent: Element): string | null => {
    for (const item of children(parent)) {
      if (!allowed[parent.localName]?.has(item.localName)) return item.localName;
      // The note's own TEF3 fields (dynamic, pick stroke, raw secondary
      // effects) go with it; other metadata may describe something else.
      if (item.localName === 'other-technical' && !/^TEF (?:fingering\s+(?:T|Thumb|[IMAC])|dynamic \d+|stroke \d+|effect[23] \d+|brush|muted)$/i.test(text(item).trim())) return item.localName;
      if (allowed[item.localName]) {
        const nested = inspect(item);
        if (nested) return nested;
      }
    }
    return null;
  };
  // A beat's lyric moves to the promoted chord member or stays on the
  // resulting rest; only grace and later chord members would lose theirs.
  if (child(note, 'lyric') && (child(note, 'grace') || child(note, 'chord'))) return 'lyric';
  return inspect(note);
}

export function deletionMarkers(note: Element) {
  const kinds = ['hammer-on', 'pull-off', 'slide', 'glissando', 'tie', 'tied'];
  return kinds.flatMap(kind => descendants(note, kind));
}

export function removeLinkedMarkers(note: Element, staffNotes: Element[], deleting: Set<Element>) {
  const index = staffNotes.indexOf(note);
  const technical = child(child(note, 'notations') ?? note, 'technical');
  const string = text(child(technical ?? note, 'string'));
  const voice = text(child(note, 'voice')) || '1';
  const pitch = child(note, 'pitch');
  const pitchKey = pitch ? `${text(child(pitch, 'step'))}:${text(child(pitch, 'alter'))}:${text(child(pitch, 'octave'))}` : '';
  for (const marker of deletionMarkers(note)) {
    const type = marker.getAttribute('type');
    if (type !== 'start' && type !== 'stop') continue;
    const opposite = type === 'start' ? 'stop' : 'start';
    const step = type === 'start' ? 1 : -1;
    for (let cursor = index + step; cursor >= 0 && cursor < staffNotes.length; cursor += step) {
      const candidate = staffNotes[cursor];
      const candidateTechnical = child(child(candidate, 'notations') ?? candidate, 'technical');
      if ((text(child(candidate, 'voice')) || '1') !== voice) continue;
      if (string && text(child(candidateTechnical ?? candidate, 'string')) !== string) continue;
      if (!string && (marker.localName === 'tie' || marker.localName === 'tied')) {
        const candidatePitch = child(candidate, 'pitch');
        if (!candidatePitch || `${text(child(candidatePitch, 'step'))}:${text(child(candidatePitch, 'alter'))}:${text(child(candidatePitch, 'octave'))}` !== pitchKey) continue;
      }
      const counterpart = deletionMarkers(candidate).find(item => item.localName === marker.localName && item.getAttribute('type') === opposite
        && (item.getAttribute('number') || '1') === (marker.getAttribute('number') || '1'));
      if (counterpart && !deleting.has(candidate)) {
        counterpart.parentNode?.removeChild(counterpart);
      }
      if (string || counterpart) break;
    }
  }
}

export function deleteSourceNotes(document: Document, notes: Element[]) {
  notes.forEach(note => {
    const siblings = note.parentNode ? children(note.parentNode as Element) : [];
    const next = siblings[siblings.indexOf(note) + 1];
    if (!child(note, 'chord') && next?.localName === 'note' && child(next, 'chord')) {
      // The first member carries the time advance; promote its successor,
      // along with the beat's timed lyrics so removing one note keeps them.
      removeChildren(next, 'chord');
      children(note).filter(item => item.localName === 'lyric').forEach(lyric =>
        placeLyric(next, lyric, Number(lyric.getAttribute('number') ?? '1') || 1));
      note.parentNode?.removeChild(note);
    } else if (child(note, 'chord') || child(note, 'grace')) {
      note.parentNode?.removeChild(note);
    } else {
      // Keep the beat duration when its last ordinary member is removed.
      ['pitch', 'notations', 'accidental', 'tie', 'stem', 'beam'].forEach(name => removeChildren(note, name));
      note.insertBefore(document.createElement('rest'), note.firstChild);
    }
  });
}

export function removeMusicXmlNotes(source: string, score: model.Score, position: RemovalPosition): { source: string; dependencies: string[] } | null {
  const document = parseDocument(source);
  const part = scorePart(document);
  const measure = part && directMeasures(part)[position.measure];
  const voice = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice];
  const beat = voice?.beats?.[position.beat];
  if (!measure || !beat || beat.isRest || beat.notes.length === 0 || beat.graceType) return null;
  const tabStaff = sourceTabStaff(document);
  const groups = sourceBeatGroups(measure, tabStaff, String(position.voice + 1));
  const mainGroups = groups.filter(group => !group.some(note => child(note, 'grace')));
  const mainIndex = voice!.beats.slice(0, position.beat).filter(candidate => !candidate.graceType).length;
  const group = mainGroups[mainIndex];
  if (!group || group.some(note => child(note, 'rest'))) throw new Error('The source beat cannot be matched safely for removal.');
  const boundary = timingBoundary(document, position.measure, tabStaff, text(child(group[0], 'voice')) || '1', group);
  if (boundary) throw new Error(boundary);
  const sourceMembers = group.map(note => {
    const technical = child(child(note, 'notations') ?? note, 'technical');
    return `${text(child(technical ?? note, 'string'))}:${text(child(technical ?? note, 'fret'))}`;
  }).sort();
  const renderedMembers = beat.notes.map(note => `${6 - note.string}:${note.fret}`).sort();
  if (sourceMembers.join('|') !== renderedMembers.join('|')) throw new Error('The source chord does not match the selected beat.');
  const selected = position.string === undefined ? group : group.filter(note => {
    const technical = child(child(note, 'notations') ?? note, 'technical');
    return Number(text(child(technical ?? note, 'string'))) === position.string;
  });
  if (position.string !== undefined && selected.length !== 1) return null;
  const removeWholeBeat = selected.length === group.length;
  const grace: Element[] = [];
  if (removeWholeBeat) {
    for (let index = groups.indexOf(group) - 1; index >= 0 && groups[index].every(note => child(note, 'grace')); index--) grace.unshift(...groups[index]);
  }
  const linked = linkedStaffNotes(document);
  const otherStaves = new Set(children(measure).filter(item => item.localName === 'note').map(note => Number(text(child(note, 'staff')) || '1')));
  otherStaves.delete(tabStaff);
  const toDelete = [...selected, ...grace];
  const paired = toDelete.flatMap(note => {
    const matches = linked(note);
    if (matches.length !== otherStaves.size) throw new Error('The paired notation note cannot be matched safely for removal.');
    return matches;
  });
  const all = [...toDelete, ...paired];
  for (const note of all) {
    const attachment = protectedNoteAttachment(note);
    if (attachment) throw new Error(`This note has a protected ${attachment} attachment that Playtab cannot remove safely.`);
  }
  const dependencies = new Set<string>();
  if (grace.length) dependencies.add(`${grace.length} grace note${grace.length === 1 ? '' : 's'}`);
  attachedDependencies(all).forEach(dependency => dependencies.add(dependency));
  repairAndDeleteNotes(document, part!, all);
  return { source: new XMLSerializer().serializeToString(document), dependencies: [...dependencies] };
}

export function attachedDependencies(notes: Element[]): string[] {
  const label: Record<string, string> = { 'hammer-on': 'hammer-on', 'pull-off': 'pull-off', slide: 'slide', glissando: 'slide', tie: 'tie', tied: 'tie' };
  const dependencies = new Set<string>();
  for (const note of notes) {
    for (const marker of deletionMarkers(note)) dependencies.add(label[marker.localName]);
    if (descendants(note, 'bend').length) dependencies.add('bend');
  }
  return [...dependencies];
}

export function repairAndDeleteNotes(document: Document, part: Element, notes: Element[]) {
  const deleting = new Set(notes);
  const staffNotes = new Map<string, Element[]>();
  descendants(part, 'note').filter(note => !child(note, 'rest')).forEach(note => {
    const staff = text(child(note, 'staff')) || '1';
    staffNotes.set(staff, [...(staffNotes.get(staff) ?? []), note]);
  });
  notes.forEach(note => removeLinkedMarkers(note, staffNotes.get(text(child(note, 'staff')) || '1') ?? [], deleting));
  deleteSourceNotes(document, notes);
}

export function newChordMember(document: Document, anchor: Element, midi: number, string?: number, fret?: number): Element {
  const added = document.createElement('note');
  added.appendChild(document.createElement('chord'));
  setPitch(added, midi);
  // Carry only the beat's timing and staff identity. Lyrics, ties, grace
  // markers, techniques and other note-owned data belong to the source note.
  for (const name of ['duration', 'voice', 'type', 'dot', 'time-modification', 'staff']) {
    children(anchor).filter(item => item.localName === name).forEach(item => added.appendChild(item.cloneNode(true)));
  }
  if (string !== undefined && fret !== undefined) {
    const technical = ensure(ensure(added, 'notations'), 'technical');
    setText(technical, 'string', String(string));
    setText(technical, 'fret', String(fret));
  }
  return added;
}

export function replaceRestWithNote(rest: Element, midi: number, string?: number, fret?: number) {
  removeChildren(rest, 'rest');
  setPitch(rest, midi);
  const pitch = child(rest, 'pitch')!;
  rest.insertBefore(pitch, child(rest, 'duration') ?? rest.firstChild);
  if (string !== undefined && fret !== undefined) {
    const technical = ensure(ensure(rest, 'notations'), 'technical');
    setText(technical, 'string', String(string));
    setText(technical, 'fret', String(fret));
  }
}

// Add to the original MusicXML in one transaction, including its verified
// duplicate notation staff. Never shift the source beat's duration or onset.
export function addMusicXmlNote(source: string, score: model.Score, position: NotePosition): string {
  const document = parseDocument(source);
  const part = scorePart(document);
  const measure = part && directMeasures(part)[position.measure];
  const beat = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice]?.beats?.[position.beat];
  if (!measure || !beat || beat.graceType) throw new Error('This source beat cannot be mapped safely for note insertion.');
  if (beat.notes.some(note => 6 - note.string === position.string)) throw new Error('This string already has a note at this beat.');
  const tabStaff = sourceTabStaff(document);
  const tabGroups = sourceBeatGroups(measure, tabStaff, String(position.voice + 1));
  const group = tabGroups[position.beat];
  if (!group || group.some(note => child(note, 'grace'))) throw new Error('This source beat cannot be mapped safely for note insertion.');
  const boundary = timingBoundary(document, position.measure, tabStaff, text(child(group[0], 'voice')) || '1', group);
  if (boundary) throw new Error(boundary);
  const midi = openTabTuning(score)[position.string - 1] + position.fret;
  if (!Number.isInteger(midi)) throw new Error('The selected string has no valid source tuning.');
  const otherStaves = new Set(children(measure).filter(item => item.localName === 'note').map(note => Number(text(child(note, 'staff')) || '1')));
  otherStaves.delete(tabStaff);
  if (group.length === 1 && child(group[0], 'rest')) {
    if (!beat.isRest) throw new Error('The source rest does not match the selected beat.');
    const pairedRests = [...otherStaves].map(staff => {
      const paired = sourceBeatGroups(measure, staff)[position.beat];
      if (!paired || paired.length !== 1 || !child(paired[0], 'rest') || text(child(paired[0], 'duration')) !== text(child(group[0], 'duration'))) {
        throw new Error('The paired notation rest cannot be matched safely.');
      }
      return paired[0];
    });
    replaceRestWithNote(group[0], midi, position.string, position.fret);
    pairedRests.forEach(rest => replaceRestWithNote(rest, midi));
  } else {
    if (beat.isRest || group.some(note => child(note, 'rest'))) throw new Error('The source chord does not match the selected beat.');
    const sourceMembers = group.map(note => {
      const technical = child(child(note, 'notations') ?? note, 'technical');
      return `${text(child(technical ?? note, 'string'))}:${text(child(technical ?? note, 'fret'))}`;
    }).sort();
    const renderedMembers = beat.notes.map(note => `${6 - note.string}:${note.fret}`).sort();
    if (sourceMembers.join('|') !== renderedMembers.join('|')) throw new Error('The source chord does not match the selected beat.');
    const linked = linkedStaffNotes(document);
    const paired = linked(group[0]);
    if (paired.length !== otherStaves.size) throw new Error('The paired notation chord cannot be matched safely.');
    const insert = (anchor: Element, string?: number, fret?: number) => {
      const siblings = children(anchor.parentNode as Element);
      const index = siblings.indexOf(anchor);
      let last = anchor;
      for (let cursor = index + 1; cursor < siblings.length && siblings[cursor].localName === 'note' && child(siblings[cursor], 'chord'); cursor++) last = siblings[cursor];
      last.parentNode!.insertBefore(newChordMember(document, anchor, midi, string, fret), last.nextSibling);
    };
    insert(group[0], position.string, position.fret);
    paired.forEach(note => insert(note));
  }
  return new XMLSerializer().serializeToString(document);
}
