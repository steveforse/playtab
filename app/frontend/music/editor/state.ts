// The form-editor state model and targeted note/technique edits.
import type { model } from '@coderline/alphatab';
import type { SourceIdentityMap } from '../source-identity';
import { child, children, descendants, directMeasures, ensure, midiToPitch, parseDocument, readDocument, removeChildren, scorePart, setPitch, setText, text } from './xml';
import { linkedStaffNotes, modelNotes, sourceTabNoteRecords } from './records';
import { deleteSourceNotes } from './notes';

export type TechniqueChoice = 'keep' | 'none' | 'thumb' | 'finger-1' | 'finger-2' | 'finger-3' | 'finger-4' |
  'hammer-on-start' | 'hammer-on-stop' | 'pull-off-start' | 'pull-off-stop' | 'slide' | 'bend';

export type EditableMusicXmlNote = {
  index: number;
  measure: number;
  beat: number;
  voice?: number;
  string: number;
  fret: number;
  technique: TechniqueChoice;
  deleted?: boolean;
  sourceIdentity?: SourceNoteIdentity;
  modelNoteId?: number;
};

export type SourceNoteIdentity = {
  id: string;
  address?: string;
  voice: string;
  graceGroup: number | null;
  graceIndex: number | null;
  chordMember: number;
};

export type MusicXmlEditorState = {
  title: string;
  tempo: number;
  tuning: number[];
  measureCount: number;
  lyricsSection: string;
  annotations: string[];
  chords: string[];
  notes: EditableMusicXmlNote[];
  origin?: { source: string; values: string };
};

export type EditorValues = Omit<MusicXmlEditorState, 'origin'>;

export const editorValues = (state: MusicXmlEditorState): EditorValues => ({
  title: state.title, tempo: state.tempo, tuning: state.tuning,
  measureCount: state.measureCount, lyricsSection: state.lyricsSection,
  annotations: state.annotations, chords: state.chords, notes: state.notes,
});

export function techniqueOf(note: Element): TechniqueChoice {
  const technical = child(child(note, 'notations') ?? note, 'technical');
  const effect = technical && children(technical).find(item => !['string', 'fret'].includes(item.localName));
  if (!effect) return 'none';
  if (effect.localName === 'fingering' && ['1', '2', '3', '4'].includes(text(effect))) return `finger-${text(effect)}` as TechniqueChoice;
  if (effect.localName === 'other-technical' && /TEF fingering\s+(?:T|Thumb)$/i.test(text(effect))) return 'thumb';
  if (effect.localName === 'hammer-on' || effect.localName === 'pull-off') return `${effect.localName}-${effect.getAttribute('type') || 'start'}` as TechniqueChoice;
  if (effect.localName === 'slide') return 'slide';
  if (effect.localName === 'bend') return 'bend';
  return 'keep';
}

export function chordName(harmony: Element) {
  const root = child(harmony, 'root');
  const step = text(child(root ?? harmony, 'root-step'));
  const alter = Number(text(child(root ?? harmony, 'root-alter')) || '0');
  const suffix = text(child(harmony, 'kind'));
  const accidental = alter === 1 ? '♯' : alter === -1 ? '♭' : '';
  const kinds: Record<string, string> = { major: '', minor: 'm', 'major-seventh': 'maj7', 'minor-seventh': 'm7', dominant: '7', diminished: 'dim', augmented: 'aug', 'suspended-fourth': 'sus4' };
  return `${step}${accidental}${kinds[suffix] ?? suffix}`;
}

export function musicXmlEditorState(source: string, score: model.Score, sourceIdentity?: SourceIdentityMap): MusicXmlEditorState {
  const document = readDocument(source);
  const part = scorePart(document);
  const tab = score.tracks?.[0]?.staves?.[0];
  const sourceNotes = sourceTabNoteRecords(document);
  if (sourceIdentity && sourceIdentity.noteIds.length !== sourceNotes.length) throw new Error('Source identity map no longer matches this score. Reopen it before editing.');
  const renderedNotes = modelNotes(score);
  const sourceByLocation = new Map<string, (typeof sourceNotes[number] & { index: number })[]>();
  sourceNotes.forEach((record, index) => {
    const key = `${record.measure}:${record.beat}:${record.string}:${record.fret}`;
    sourceByLocation.set(key, [...(sourceByLocation.get(key) ?? []), { ...record, index }]);
  });
  const fields = descendants(document.documentElement, 'miscellaneous-field');
  const lyrics = fields.find(field => field.getAttribute('name') === 'playtab-lyrics');
  const tempo = Number(descendants(document.documentElement, 'sound').find(sound => sound.getAttribute('tempo'))?.getAttribute('tempo') || score.tempo || 96);
  const annotations = descendants(document.documentElement, 'words').map(text).filter(Boolean);
  const chords = descendants(document.documentElement, 'harmony').map(chordName);
  const notes = renderedNotes.map(({ note, measure, beat, voice }, renderedIndex) => {
    const candidates = (sourceByLocation.get(`${measure}:${beat}:${6 - note.string}:${note.fret}`) ?? [])
      .filter(candidate => candidate.grace === Boolean(note.beat.graceType));
    const voiceCandidates = candidates.filter(candidate => candidate.voice === String(voice + 1));
    const matched = voiceCandidates.length === 1 ? voiceCandidates[0] : candidates.length === 1 ? candidates[0] : null;
    const sourceNote = matched?.note;
    return {
      index: matched?.index ?? -1 - renderedIndex,
      measure,
      beat,
      voice,
      string: matched?.string ?? 6 - note.string,
      fret: note.fret,
      technique: sourceNote ? techniqueOf(sourceNote) : 'none',
      modelNoteId: note.id,
      sourceIdentity: matched ? { id: sourceIdentity?.noteIds[matched.index] ?? matched.id, address: matched.id, voice: matched.voice, graceGroup: matched.graceGroup,
        graceIndex: matched.graceIndex, chordMember: matched.chordMember } : undefined,
    };
  });
  const state: MusicXmlEditorState = {
    title: score.title.replaceAll('\u00a0', ' '),
    tempo: Number.isInteger(tempo) ? tempo : 96,
    tuning: [...(tab?.tuning ?? [])],
    measureCount: score.masterBars?.length ?? (part ? directMeasures(part).length : 1),
    lyricsSection: lyrics?.textContent?.replace(/^\s*(?:LYRICS\s*&\s*CHORDS|CHORDS\s*&\s*LYRICS)\s*\r?\n?/i, '').trimEnd() ?? '',
    annotations,
    chords,
    notes,
  };
  state.origin = { source, values: JSON.stringify(editorValues(state)) };
  return state;
}

export function replaceTechnique(note: Element, choice: TechniqueChoice) {
  if (choice === 'keep') return;
  const notations = child(note, 'notations') ?? (() => { const created = note.ownerDocument!.createElement('notations'); note.appendChild(created); return created; })();
  const technical = child(notations, 'technical') ?? (() => { const created = note.ownerDocument!.createElement('technical'); notations.appendChild(created); return created; })();
  const replaceable = ['fingering', 'hammer-on', 'pull-off', 'slide', 'bend', 'other-technical'];
  children(technical).filter(item => replaceable.includes(item.localName)).forEach(item => technical.removeChild(item));
  if (choice === 'none') return;
  const document = note.ownerDocument!;
  if (choice.startsWith('finger-')) {
    const fingering = document.createElement('fingering');
    fingering.setAttribute('enclosure', 'circle');
    fingering.textContent = choice.slice(-1);
    technical.appendChild(fingering);
  } else if (choice === 'thumb') {
    const thumb = document.createElement('other-technical');
    thumb.textContent = 'TEF fingering T';
    technical.appendChild(thumb);
  } else if (choice.startsWith('hammer-on-') || choice.startsWith('pull-off-')) {
    const [kind, type] = choice.split('-').slice(0, 2).join('-') === 'hammer-on' ? ['hammer-on', choice.replace('hammer-on-', '')] : ['pull-off', choice.replace('pull-off-', '')];
    const effect = document.createElement(kind);
    effect.setAttribute('type', type);
    if (type === 'start') effect.textContent = kind === 'hammer-on' ? 'H' : 'PO';
    technical.appendChild(effect);
  } else technical.appendChild(document.createElement(choice));
}

export function setWords(document: Document, values: string[]) {
  const words = descendants(document.documentElement, 'words');
  values.forEach((value, index) => {
    if (words[index]) words[index].textContent = value;
  });
  words.slice(values.length).forEach(word => word.parentNode?.removeChild(word));
  const part = scorePart(document);
  const measure = part && directMeasures(part)[0];
  values.slice(words.length).forEach(value => {
    if (!measure) return;
    const direction = document.createElement('direction');
    const directionType = document.createElement('direction-type');
    const word = document.createElement('words');
    word.textContent = value;
    directionType.appendChild(word);
    direction.appendChild(directionType);
    measure.appendChild(direction);
  });
}

export function updateChord(harmony: Element, value: string) {
  const match = value.trim().match(/^([A-Ga-g])([#♯b♭]?)(.*)$/);
  if (!match) return false;
  const root = ensure(harmony, 'root');
  setText(root, 'root-step', match[1].toUpperCase());
  const alter = match[2] === '#' || match[2] === '♯' ? '1' : match[2] === 'b' || match[2] === '♭' ? '-1' : '';
  if (alter) setText(root, 'root-alter', alter); else removeChildren(root, 'root-alter');
  const kinds: Record<string, string> = { '': 'major', m: 'minor', min: 'minor', '7': 'dominant', maj7: 'major-seventh', m7: 'minor-seventh', dim: 'diminished', aug: 'augmented', sus4: 'suspended-fourth' };
  setText(harmony, 'kind', (kinds[match[3]] ?? match[3]) || 'major');
  return true;
}

export function setChords(document: Document, values: string[]) {
  const harmonies = descendants(document.documentElement, 'harmony');
  values.forEach((value, index) => {
    const harmony = harmonies[index];
    if (!harmony) return;
    updateChord(harmony, value);
  });
  harmonies.slice(values.length).forEach(harmony => harmony.parentNode?.removeChild(harmony));
  const part = scorePart(document);
  const measure = part && directMeasures(part)[0];
  values.slice(harmonies.length).forEach(value => {
    if (!measure) return;
    const harmony = document.createElement('harmony');
    if (updateChord(harmony, value)) measure.appendChild(harmony);
  });
}

export function setLyrics(document: Document, value: string) {
  const fields = descendants(document.documentElement, 'miscellaneous-field');
  const field = fields.find(item => item.getAttribute('name') === 'playtab-lyrics');
  if (!value.trim()) {
    if (field) field.parentNode?.removeChild(field);
    return;
  }
  const target = field ?? (() => {
    const identification = descendants(document.documentElement, 'identification')[0] ?? (() => { const created = document.createElement('identification'); document.documentElement.insertBefore(created, document.documentElement.firstChild); return created; })();
    const miscellaneous = child(identification, 'miscellaneous') ?? (() => { const created = document.createElement('miscellaneous'); identification.appendChild(created); return created; })();
    const created = document.createElement('miscellaneous-field');
    created.setAttribute('name', 'playtab-lyrics');
    miscellaneous.appendChild(created);
    return created;
  })();
  target.textContent = `LYRICS & CHORDS\n\n${value.trim()}`;
}

export function setMeasureCount(document: Document, count: number) {
  const part = scorePart(document);
  if (!part) return;
  const measures = directMeasures(part);
  while (measures.length > count) part.removeChild(measures.pop()!);
  while (measures.length < count) {
    const template = measures[measures.length - 1];
    if (!template) break;
    const copy = template.cloneNode(true) as Element;
    copy.setAttribute('number', String(measures.length + 1));
    children(copy).filter(item => ['note', 'direction', 'harmony', 'barline'].includes(item.localName)).forEach(item => copy.removeChild(item));
    const attributes = child(copy, 'attributes');
    const divisions = Number(text(attributes ? child(attributes, 'divisions') : undefined) || '1');
    const documentOwner = document;
    const note = documentOwner.createElement('note');
    const rest = documentOwner.createElement('rest');
    note.appendChild(rest);
    setText(note, 'duration', String(divisions * 4));
    setText(note, 'voice', '1');
    setText(note, 'type', 'whole');
    copy.appendChild(note);
    part.appendChild(copy);
    measures.push(copy);
  }
}

export function removePairedTechniqueForDeletedNote(sourceNotes: Element[], index: number) {
  const note = sourceNotes[index];
  const technical = child(child(note, 'notations') ?? note, 'technical');
  if (!technical) return;
  const string = text(child(technical, 'string'));
  children(technical).filter(item => item.localName === 'hammer-on' || item.localName === 'pull-off').forEach(marker => {
    const type = marker.getAttribute('type') || 'start';
    const step = type === 'stop' ? -1 : 1;
    for (let cursor = index + step; cursor >= 0 && cursor < sourceNotes.length; cursor += step) {
      const candidateTechnical = child(child(sourceNotes[cursor], 'notations') ?? sourceNotes[cursor], 'technical');
      if (!candidateTechnical || text(child(candidateTechnical, 'string')) !== string) continue;
      const paired = children(candidateTechnical).find(item => item.localName === marker.localName && (item.getAttribute('type') || 'start') === (type === 'stop' ? 'start' : 'stop'));
      if (paired) candidateTechnical.removeChild(paired);
      break;
    }
  });
}

// A fret or string edit must not silently change a connected span: the
// named span is removed explicitly first.
export function rejectIncompatibleTransitions(sourceNotes: Element[]) {
  sourceNotes.forEach((note, index) => {
    const technical = child(child(note, 'notations') ?? note, 'technical');
    if (!technical) return;
    const string = text(child(technical, 'string'));
    const fret = Number(text(child(technical, 'fret')));
    const notations = child(note, 'notations');
    const starts = [...children(technical), ...(notations ? children(notations) : [])].filter(item =>
      ['hammer-on', 'pull-off', 'slide'].includes(item.localName) && (item.getAttribute('type') || 'start') === 'start');
    for (const marker of starts) {
      for (let cursor = index + 1; cursor < sourceNotes.length; cursor++) {
        const candidate = sourceNotes[cursor];
        const candidateTechnical = child(child(candidate, 'notations') ?? candidate, 'technical');
        if (!candidateTechnical || text(child(candidateTechnical, 'string')) !== string) continue;
        const candidateNotations = child(candidate, 'notations');
        const paired = [...children(candidateTechnical), ...(candidateNotations ? children(candidateNotations) : [])].some(item => item.localName === marker.localName
          && item.getAttribute('type') === 'stop' && (marker.localName !== 'slide' || (item.getAttribute('number') || '1') === (marker.getAttribute('number') || '1')));
        if (!paired) break;
        const destinationFret = Number(text(child(candidateTechnical, 'fret')));
        const valid = marker.localName === 'hammer-on' ? destinationFret > fret : marker.localName === 'pull-off' ? destinationFret < fret : destinationFret !== fret;
        if (!valid) throw new Error(`This change would make the existing ${marker.localName} invalid. Remove that ${marker.localName} first.`);
        break;
      }
    }
  });
}

export function applyScoreSettings(document: Document, state: MusicXmlEditorState, original: EditorValues | null) {
  const root = document.documentElement;
  if (!original || state.title !== original.title) {
    const work = descendants(root, 'work')[0] ?? (() => { const created = document.createElement('work'); root.insertBefore(created, root.firstChild); return created; })();
    setText(work, 'work-title', state.title.slice(0, 160));
    descendants(root, 'movement-title').forEach(title => { title.textContent = state.title.slice(0, 160); });
  }

  if (!original || state.tempo !== original.tempo) {
    const sounds = descendants(root, 'sound');
    sounds.forEach(sound => sound.setAttribute('tempo', String(state.tempo)));
    if (!sounds.length) {
      const part = descendants(root, 'part')[0];
      const measure = part ? directMeasures(part)[0] : undefined;
      if (measure) {
        const sound = document.createElement('sound');
        sound.setAttribute('tempo', String(state.tempo));
        measure.appendChild(sound);
      }
    }
  }
  if (!original || JSON.stringify(state.tuning) !== JSON.stringify(original.tuning)) {
    const tunings = descendants(root, 'staff-tuning').filter(item => (item.parentNode?.parentNode as Element | null)?.localName === 'attributes');
    tunings.forEach(tuning => {
      const line = Number(tuning.getAttribute('line') || '1');
      const midi = state.tuning[5 - line];
      if (Number.isInteger(midi)) {
        const pitch = midiToPitch(midi);
        setText(tuning, 'tuning-step', pitch.step);
        if (pitch.alter) setText(tuning, 'tuning-alter', String(pitch.alter)); else removeChildren(tuning, 'tuning-alter');
        setText(tuning, 'tuning-octave', String(pitch.octave));
      }
    });
  }
}

export function applyMusicXmlEdits(source: string, state: MusicXmlEditorState, noteIndexes?: number[]): string {
  if (state.origin && state.origin.source !== source) throw new Error('The imported score changed since this edit began. Reopen the editor before applying it.');
  const original: EditorValues | null = state.origin ? JSON.parse(state.origin.values) as EditorValues : null;
  if (original && JSON.stringify(editorValues(state)) === state.origin!.values) return source;
  const document = parseDocument(source);
  const linkedNotes = linkedStaffNotes(document);
  if (!noteIndexes && (!original || state.title !== original.title || state.tempo !== original.tempo || JSON.stringify(state.tuning) !== JSON.stringify(original.tuning))) {
    applyScoreSettings(document, state, original);
  }
  const sourceRecords = sourceTabNoteRecords(document);
  const sourceNotes = sourceRecords.map(record => record.note);
  const tuning = state.tuning.length === 5 ? state.tuning : [62, 59, 55, 50, 67];
  const deletedNoteIndexes = new Set(state.notes.filter(edit => edit.deleted).map(edit => edit.index));
  const pairedDeletions: Element[] = [];
  state.notes.forEach(edit => {
    if (noteIndexes && !noteIndexes.includes(edit.index)) return;
    const before = original?.notes.find(note => note.index === edit.index);
    if (before && JSON.stringify(edit) === JSON.stringify(before)) return;
    if (edit.index < 0) throw new Error('This rendered note cannot be uniquely matched to its MusicXML source. Its source details are preserved, but this note cannot be edited safely.');
    if (before?.sourceIdentity && edit.sourceIdentity?.id !== before.sourceIdentity.id) throw new Error('The source note identity changed during this edit. Reopen the editor before applying it.');
    const matching = before?.sourceIdentity ? sourceRecords.filter(record => record.id === (before.sourceIdentity!.address ?? before.sourceIdentity!.id)) : [];
    if (before?.sourceIdentity && matching.length !== 1) throw new Error('This source note identity is ambiguous. Its source details are preserved, but it cannot be edited safely.');
    const note = matching[0]?.note ?? sourceNotes[edit.index];
    if (!note) {
      if (original) throw new Error('This source note is no longer available. Reopen the editor before applying the change.');
      return;
    }
    if (before) {
      const technical = child(child(note, 'notations') ?? note, 'technical');
      if (Number(text(child(technical ?? note, 'string'))) !== before.string || Number(text(child(technical ?? note, 'fret'))) !== before.fret) {
        throw new Error('This source note no longer matches the selected fret. Reopen the editor before applying the change.');
      }
    }
    const paired = linkedNotes(note);
    if (edit.deleted) { pairedDeletions.push(...paired); return; }
    if (!before || edit.string !== before.string || edit.fret !== before.fret) {
      if ([note, ...paired].some(item => descendants(item, 'tie').length || descendants(item, 'tied').length)) {
        throw new Error('This note is tied. Remove the tie before changing its pitch or string.');
      }
      const notations = child(note, 'notations') ?? (() => { const created = document.createElement('notations'); note.appendChild(created); return created; })();
      const technical = child(notations, 'technical') ?? (() => { const created = document.createElement('technical'); notations.appendChild(created); return created; })();
      setText(technical, 'string', String(edit.string));
      setText(technical, 'fret', String(edit.fret));
      setPitch(note, tuning[edit.string - 1] + edit.fret);
      paired.forEach(partner => setPitch(partner, tuning[edit.string - 1] + edit.fret));
    }
    // The inspector exposes one choice, but a source note can carry several
    // independent markings (including a stop followed by another start).
    // An unchanged choice must preserve all of those source elements.
    if (edit.technique !== techniqueOf(note)) replaceTechnique(note, edit.technique);
  });
  if (state.notes.some(edit => {
    const before = original?.notes.find(note => note.index === edit.index);
    return !before || edit.string !== before.string || edit.fret !== before.fret || edit.deleted;
  })) rejectIncompatibleTransitions(sourceNotes);
  const notesToDelete = sourceNotes.filter((_, index) => deletedNoteIndexes.has(index) && (!noteIndexes || noteIndexes.includes(index)));
  notesToDelete.forEach(note => removePairedTechniqueForDeletedNote(sourceNotes, sourceNotes.indexOf(note)));
  deleteSourceNotes(document, [...notesToDelete, ...pairedDeletions]);

  if (!noteIndexes) {
    if (!original || state.lyricsSection !== original.lyricsSection) setLyrics(document, state.lyricsSection);
    if (!original || JSON.stringify(state.annotations) !== JSON.stringify(original.annotations)) setWords(document, state.annotations);
    if (!original || JSON.stringify(state.chords) !== JSON.stringify(original.chords)) setChords(document, state.chords);
    if (!original || state.measureCount !== original.measureCount) setMeasureCount(document, Math.max(1, Math.min(256, Math.round(state.measureCount))));
  }
  return new XMLSerializer().serializeToString(document);
}
