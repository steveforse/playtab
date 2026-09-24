import type { model } from '@coderline/alphatab';
import type { SourceIdentityMap } from './source-identity';
import { DURATION_DENOMINATORS, REST_SPACE_ERROR, durationTime, fillRestTime, planDurationChange, rationalTime, compareTime,
  type DurationDenominator, type RationalTime } from '../editor/rhythm';

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

type EditorValues = Omit<MusicXmlEditorState, 'origin'>;
const editorValues = (state: MusicXmlEditorState): EditorValues => ({
  title: state.title, tempo: state.tempo, tuning: state.tuning,
  measureCount: state.measureCount, lyricsSection: state.lyricsSection,
  annotations: state.annotations, chords: state.chords, notes: state.notes,
});

const children = (node: Element) => Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
const child = (node: Element, name: string) => children(node).find(candidate => candidate.localName === name);
const descendants = (node: Element | Document, name: string) => Array.from(node.getElementsByTagName('*')).filter(candidate => candidate.localName === name);
const directMeasures = (part: Element) => children(part).filter(candidate => candidate.localName === 'measure');
const text = (node: Element | undefined) => node?.textContent?.trim() ?? '';

function parseDocument(source: string) {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length || document.documentElement.localName !== 'score-partwise') {
    throw new Error('Invalid MusicXML.');
  }
  return document;
}

function sourceTabStaff(document: Document): number {
  const details = descendants(document.documentElement, 'staff-details').find(item => text(child(item, 'staff-lines')) === '5');
  return Number(details?.getAttribute('number') || '1');
}

export function sourceTabNoteRecords(document: Document) {
  const staff = sourceTabStaff(document);
  const part = descendants(document.documentElement, 'part')[0];
  if (!part) return [];
  return directMeasures(part).flatMap((measure, measureIndex) => {
    const eventByVoice = new Map<string, number>();
    const memberByVoice = new Map<string, number>();
    const graceGroupByVoice = new Map<string, number>();
    const graceIndexByVoice = new Map<string, number>();
    const graceActiveByVoice = new Map<string, boolean>();
    return children(measure).filter(note => note.localName === 'note')
      .filter(note => Number(text(child(note, 'staff')) || '1') === staff)
      .flatMap(note => {
        const voice = text(child(note, 'voice')) || '1';
        const chord = Boolean(child(note, 'chord'));
        const grace = Boolean(child(note, 'grace')) || (chord && graceActiveByVoice.get(voice) === true);
        if (!chord) {
          eventByVoice.set(voice, (eventByVoice.get(voice) ?? -1) + 1);
          memberByVoice.set(voice, 0);
          if (grace) {
            if (!graceActiveByVoice.get(voice)) graceGroupByVoice.set(voice, (graceGroupByVoice.get(voice) ?? -1) + 1);
            graceIndexByVoice.set(voice, graceActiveByVoice.get(voice) ? (graceIndexByVoice.get(voice) ?? -1) + 1 : 0);
          }
          graceActiveByVoice.set(voice, grace);
        } else memberByVoice.set(voice, (memberByVoice.get(voice) ?? 0) + 1);
        const technical = child(child(note, 'notations') ?? note, 'technical');
        if (!technical || !child(technical, 'string')) return [];
        const event = eventByVoice.get(voice) ?? 0;
        const string = Number(text(child(technical, 'string')));
        const chordMember = memberByVoice.get(voice) ?? 0;
        const graceGroup = grace ? graceGroupByVoice.get(voice) ?? 0 : null;
        const graceIndex = grace ? graceIndexByVoice.get(voice) ?? 0 : null;
        return [{ note, measure: measureIndex, beat: eventByVoice.get(voice) ?? 0,
          voice, string, fret: Number(text(child(technical, 'fret'))), grace, graceGroup, graceIndex, chordMember,
          id: `${measureIndex}:${voice}:${event}:${graceGroup ?? 'main'}:${graceIndex ?? 'main'}:${string}` }];
      });
  });
}

function sourceTabNotes(document: Document) { return sourceTabNoteRecords(document).map(record => record.note); }

// Match the original source before either representation is changed. Use
// musical position and pitch, never parallel note-array indexes: chords may
// be written in a different order on the two staves.
function linkedStaffNotes(document: Document) {
  type Fraction = [number, number];
  const fraction = (n: number, d = 1): Fraction => {
    const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
    const divisor = gcd(Math.abs(n), d) || 1;
    return [n / divisor, d / divisor];
  };
  const add = (a: Fraction, b: Fraction): Fraction => fraction(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
  const keyFor = new Map<Element, string>();
  const byStaff = new Map<number, Map<string, Element[]>>();
  const part = descendants(document.documentElement, 'part')[0];
  let divisions = 1;
  for (const [measureIndex, measure] of (part ? directMeasures(part) : []).entries()) {
    let position: Fraction = [0, 1];
    const previous = new Map<string, Fraction>();
    const graceCounts = new Map<string, number>();
    for (const item of children(measure)) {
      if (item.localName === 'attributes') divisions = Number(text(child(item, 'divisions'))) || divisions;
      const duration = fraction(Number(text(child(item, 'duration'))) || 0, divisions);
      if (item.localName === 'backup' || item.localName === 'forward') {
        position = add(position, [duration[0] * (item.localName === 'backup' ? -1 : 1), duration[1]]);
      }
      if (item.localName !== 'note') continue;
      const staff = Number(text(child(item, 'staff')) || '1');
      const voice = text(child(item, 'voice')) || '1';
      const lane = `${staff}:${voice}`;
      const onset = child(item, 'chord') ? previous.get(lane) ?? position : position;
      previous.set(lane, onset);
      const grace = Boolean(child(item, 'grace'));
      const graceKey = `${lane}:${onset.join('/')}`;
      if (grace && !child(item, 'chord')) graceCounts.set(graceKey, (graceCounts.get(graceKey) ?? 0) + 1);
      if (!grace && !child(item, 'chord')) position = add(position, duration);
      const pitch = child(item, 'pitch');
      if (!pitch) continue;
      const pitchValue = (Number(text(child(pitch, 'octave'))) + 1) * 12
        + ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[text(child(pitch, 'step'))] ?? 0)
        + Number(text(child(pitch, 'alter')) || 0);
      const key = `${measureIndex}:${onset.join('/')}:${duration.join('/')}:${grace ? graceCounts.get(graceKey) : 'main'}:${pitchValue}`;
      keyFor.set(item, key);
      if (!byStaff.has(staff)) byStaff.set(staff, new Map());
      const notes = byStaff.get(staff)!;
      notes.set(key, [...(notes.get(key) ?? []), item]);
    }
  }
  const tabStaff = sourceTabStaff(document);
  return (note: Element): Element[] => {
    const key = keyFor.get(note);
    if (!key) return [];
    const result: Element[] = [];
    for (const [staff, notes] of byStaff) {
      if (staff === tabStaff) continue;
      const candidates = notes.get(key) ?? [];
      if (candidates.length !== 1 || byStaff.get(tabStaff)?.get(key)?.length !== 1) {
        throw new Error('This note cannot be uniquely matched to its paired notation staff.');
      }
      result.push(candidates[0]);
    }
    return result;
  };
}

function modelNotes(score: model.Score) {
  const tab = score.tracks?.[0]?.staves?.[0];
  return tab?.bars?.flatMap((bar, measure) => bar.voices.flatMap((voice, voiceIndex) => voice.beats.flatMap((beat, beatIndex) => beat.notes.map(note => ({ note, measure, beat: beatIndex, voice: voiceIndex }))))) ?? [];
}

function midiToPitch(midi: number) {
  const names: [string, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
  const [step, alter] = names[((midi % 12) + 12) % 12];
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

function techniqueOf(note: Element): TechniqueChoice {
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

function chordName(harmony: Element) {
  const root = child(harmony, 'root');
  const step = text(child(root ?? harmony, 'root-step'));
  const alter = Number(text(child(root ?? harmony, 'root-alter')) || '0');
  const suffix = text(child(harmony, 'kind'));
  const accidental = alter === 1 ? '♯' : alter === -1 ? '♭' : '';
  const kinds: Record<string, string> = { major: '', minor: 'm', 'major-seventh': 'maj7', 'minor-seventh': 'm7', dominant: '7', diminished: 'dim', augmented: 'aug', 'suspended-fourth': 'sus4' };
  return `${step}${accidental}${kinds[suffix] ?? suffix}`;
}

export function musicXmlEditorState(source: string, score: model.Score, sourceIdentity?: SourceIdentityMap): MusicXmlEditorState {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
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

function ensure(parent: Element, name: string) {
  const existing = child(parent, name);
  if (existing) return existing;
  const created = parent.ownerDocument!.createElement(name);
  parent.appendChild(created);
  return created;
}

function setText(parent: Element, name: string, value: string) {
  ensure(parent, name).textContent = value;
}

function removeChildren(parent: Element, name: string) {
  children(parent).filter(item => item.localName === name).forEach(item => parent.removeChild(item));
}

function setPitch(note: Element, midi: number) {
  const pitch = ensure(note, 'pitch');
  const value = midiToPitch(midi);
  setText(pitch, 'step', value.step);
  if (value.alter) {
    const alter = child(pitch, 'alter') ?? pitch.ownerDocument!.createElement('alter');
    alter.textContent = String(value.alter);
    pitch.insertBefore(alter, child(pitch, 'octave') ?? null);
  } else removeChildren(pitch, 'alter');
  setText(pitch, 'octave', String(value.octave));
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

function setWords(document: Document, values: string[]) {
  const words = descendants(document.documentElement, 'words');
  values.forEach((value, index) => {
    if (words[index]) words[index].textContent = value;
  });
  words.slice(values.length).forEach(word => word.parentNode?.removeChild(word));
  const part = descendants(document.documentElement, 'part')[0];
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

function updateChord(harmony: Element, value: string) {
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

function setChords(document: Document, values: string[]) {
  const harmonies = descendants(document.documentElement, 'harmony');
  values.forEach((value, index) => {
    const harmony = harmonies[index];
    if (!harmony) return;
    updateChord(harmony, value);
  });
  harmonies.slice(values.length).forEach(harmony => harmony.parentNode?.removeChild(harmony));
  const part = descendants(document.documentElement, 'part')[0];
  const measure = part && directMeasures(part)[0];
  values.slice(harmonies.length).forEach(value => {
    if (!measure) return;
    const harmony = document.createElement('harmony');
    if (updateChord(harmony, value)) measure.appendChild(harmony);
  });
}

function setLyrics(document: Document, value: string) {
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

function setMeasureCount(document: Document, count: number) {
  const part = descendants(document.documentElement, 'part')[0];
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

function removePairedTechniqueForDeletedNote(sourceNotes: Element[], index: number) {
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

function removeIncompatibleDirectionalTechniques(sourceNotes: Element[]) {
  sourceNotes.forEach((note, index) => {
    const technical = child(child(note, 'notations') ?? note, 'technical');
    if (!technical) return;
    const string = text(child(technical, 'string'));
    const fret = Number(text(child(technical, 'fret')));
    children(technical).filter(item => (item.localName === 'hammer-on' || item.localName === 'pull-off') && (item.getAttribute('type') || 'start') === 'start').forEach(marker => {
      for (let cursor = index + 1; cursor < sourceNotes.length; cursor++) {
        const candidateTechnical = child(child(sourceNotes[cursor], 'notations') ?? sourceNotes[cursor], 'technical');
        if (!candidateTechnical || text(child(candidateTechnical, 'string')) !== string) continue;
        const paired = children(candidateTechnical).find(item => item.localName === marker.localName && (item.getAttribute('type') || 'start') === 'stop');
        if (!paired) continue;
        const destinationFret = Number(text(child(candidateTechnical, 'fret')));
        const validDirection = marker.localName === 'hammer-on' ? destinationFret > fret : destinationFret < fret;
        if (!validDirection) {
          technical.removeChild(marker);
          candidateTechnical.removeChild(paired);
        }
        break;
      }
    });
  });
}

function applyScoreSettings(document: Document, state: MusicXmlEditorState, original: EditorValues | null) {
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
  })) removeIncompatibleDirectionalTechniques(sourceNotes);
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

type NotePosition = { measure: number; beat: number; voice: number; string: number; fret: number };
type RemovalPosition = Pick<NotePosition, 'measure' | 'beat' | 'voice'> & { string?: number };

function sourceBeatGroups(measure: Element, staff: number, voice?: string): Element[][] {
  const groups: Element[][] = [];
  children(measure).filter(item => item.localName === 'note' && Number(text(child(item, 'staff')) || '1') === staff
    && (voice === undefined || (text(child(item, 'voice')) || '1') === voice)).forEach(note => {
    if (child(note, 'chord') && groups.length) groups[groups.length - 1].push(note);
    else groups.push([note]);
  });
  return groups;
}

type Rational = readonly [bigint, bigint];
const rational = (numerator: bigint, denominator = 1n): Rational => {
  if (denominator <= 0n) throw new Error('The source has invalid timing divisions.');
  const gcd = (left: bigint, right: bigint): bigint => right === 0n ? left : gcd(right, left % right);
  const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator) || 1n;
  return [numerator / divisor, denominator / divisor];
};
const addTime = (left: Rational, right: Rational): Rational => rational(left[0] * right[1] + right[0] * left[1], left[1] * right[1]);
const subtractTime = (left: Rational, right: Rational): Rational => rational(left[0] * right[1] - right[0] * left[1], left[1] * right[1]);
const timeGreater = (left: Rational, right: Rational) => left[0] * right[1] > right[0] * left[1];

function timingBoundary(document: Document, measureIndex: number, staff: number, voice: string, event?: Element[]): string | null {
  const part = descendants(document.documentElement, 'part')[0];
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
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
  const measure = part ? directMeasures(part)[position.measure] : undefined;
  const group = measure && position.event !== undefined ? sourceBeatGroups(measure, position.staff, position.voice)[position.event] : undefined;
  return timingBoundary(document, position.measure, position.staff, position.voice, group);
}

// Deletion must be conservative: an unfamiliar attachment may carry source
// information that cannot be reconstructed after the note is removed.
function protectedNoteAttachment(note: Element): string | null {
  const allowed: Record<string, Set<string>> = {
    note: new Set(['chord', 'pitch', 'rest', 'duration', 'voice', 'type', 'dot', 'accidental', 'stem', 'beam', 'staff', 'notations', 'grace', 'tie', 'time-modification', 'instrument']),
    pitch: new Set(['step', 'alter', 'octave']),
    notations: new Set(['technical', 'tied', 'slide', 'glissando']),
    technical: new Set(['string', 'fret', 'fingering', 'other-technical', 'hammer-on', 'pull-off', 'slide', 'bend']),
    'time-modification': new Set(['actual-notes', 'normal-notes', 'normal-type', 'normal-dot']),
  };
  const inspect = (parent: Element): string | null => {
    for (const item of children(parent)) {
      if (!allowed[parent.localName]?.has(item.localName)) return item.localName;
      if (item.localName === 'other-technical' && !/TEF fingering\s+(?:T|Thumb)$/i.test(text(item))) return item.localName;
      if (allowed[item.localName]) {
        const nested = inspect(item);
        if (nested) return nested;
      }
    }
    return null;
  };
  return inspect(note);
}

function deletionMarkers(note: Element) {
  const kinds = ['hammer-on', 'pull-off', 'slide', 'glissando', 'tie', 'tied'];
  return kinds.flatMap(kind => descendants(note, kind));
}

function removeLinkedMarkers(note: Element, staffNotes: Element[], deleting: Set<Element>) {
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

function deleteSourceNotes(document: Document, notes: Element[]) {
  notes.forEach(note => {
    const siblings = note.parentNode ? children(note.parentNode as Element) : [];
    const next = siblings[siblings.indexOf(note) + 1];
    if (!child(note, 'chord') && next?.localName === 'note' && child(next, 'chord')) {
      // The first member carries the time advance; promote its successor.
      removeChildren(next, 'chord');
      note.parentNode?.removeChild(note);
    } else if (child(note, 'chord') || child(note, 'grace')) {
      note.parentNode?.removeChild(note);
    } else {
      // Keep the event duration when its last ordinary member is removed.
      ['pitch', 'notations', 'accidental', 'tie', 'stem', 'beam'].forEach(name => removeChildren(note, name));
      note.insertBefore(document.createElement('rest'), note.firstChild);
    }
  });
}

export function removeMusicXmlNotes(source: string, score: model.Score, position: RemovalPosition): { source: string; dependencies: string[] } | null {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
  const measure = part && directMeasures(part)[position.measure];
  const voice = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice];
  const beat = voice?.beats?.[position.beat];
  if (!measure || !beat || beat.isRest || beat.notes.length === 0 || beat.graceType) return null;
  const tabStaff = sourceTabStaff(document);
  const groups = sourceBeatGroups(measure, tabStaff, String(position.voice + 1));
  const mainGroups = groups.filter(group => !group.some(note => child(note, 'grace')));
  const mainIndex = voice!.beats.slice(0, position.beat).filter(candidate => !candidate.graceType).length;
  const group = mainGroups[mainIndex];
  if (!group || group.some(note => child(note, 'rest'))) throw new Error('The source event cannot be matched safely for removal.');
  const boundary = timingBoundary(document, position.measure, tabStaff, text(child(group[0], 'voice')) || '1', group);
  if (boundary) throw new Error(boundary);
  const sourceMembers = group.map(note => {
    const technical = child(child(note, 'notations') ?? note, 'technical');
    return `${text(child(technical ?? note, 'string'))}:${text(child(technical ?? note, 'fret'))}`;
  }).sort();
  const renderedMembers = beat.notes.map(note => `${6 - note.string}:${note.fret}`).sort();
  if (sourceMembers.join('|') !== renderedMembers.join('|')) throw new Error('The source chord does not match the selected event.');
  const selected = position.string === undefined ? group : group.filter(note => {
    const technical = child(child(note, 'notations') ?? note, 'technical');
    return Number(text(child(technical ?? note, 'string'))) === position.string;
  });
  if (position.string !== undefined && selected.length !== 1) return null;
  const removeWholeEvent = selected.length === group.length;
  const grace: Element[] = [];
  if (removeWholeEvent) {
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
  for (const note of all) {
    for (const marker of deletionMarkers(note)) {
      const label: Record<string, string> = { 'hammer-on': 'hammer-on', 'pull-off': 'pull-off', slide: 'slide', glissando: 'slide', tie: 'tie', tied: 'tie' };
      dependencies.add(label[marker.localName]);
    }
    if (descendants(note, 'bend').length) dependencies.add('bend');
  }
  const deleting = new Set(all);
  const staffNotes = new Map<string, Element[]>();
  descendants(part!, 'note').filter(note => !child(note, 'rest')).forEach(note => {
    const staff = text(child(note, 'staff')) || '1';
    staffNotes.set(staff, [...(staffNotes.get(staff) ?? []), note]);
  });
  all.forEach(note => removeLinkedMarkers(note, staffNotes.get(text(child(note, 'staff')) || '1') ?? [], deleting));
  deleteSourceNotes(document, all);
  return { source: new XMLSerializer().serializeToString(document), dependencies: [...dependencies] };
}

function newChordMember(document: Document, anchor: Element, midi: number, string?: number, fret?: number): Element {
  const added = document.createElement('note');
  added.appendChild(document.createElement('chord'));
  setPitch(added, midi);
  // Carry only the event's timing and staff identity. Lyrics, ties, grace
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

function replaceRestWithNote(rest: Element, midi: number, string?: number, fret?: number) {
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
// duplicate notation staff. Never shift the source event's duration or onset.
export function addMusicXmlNote(source: string, score: model.Score, position: NotePosition): string {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
  const measure = part && directMeasures(part)[position.measure];
  const beat = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice]?.beats?.[position.beat];
  if (!measure || !beat || beat.graceType) throw new Error('This source event cannot be mapped safely for note insertion.');
  if (beat.notes.some(note => 6 - note.string === position.string)) throw new Error('This string already has a note at this event.');
  const tabStaff = sourceTabStaff(document);
  const tabGroups = sourceBeatGroups(measure, tabStaff, String(position.voice + 1));
  const group = tabGroups[position.beat];
  if (!group || group.some(note => child(note, 'grace'))) throw new Error('This source event cannot be mapped safely for note insertion.');
  const boundary = timingBoundary(document, position.measure, tabStaff, text(child(group[0], 'voice')) || '1', group);
  if (boundary) throw new Error(boundary);
  const midi = score.tracks[0].staves[0].tuning[position.string - 1] + position.fret;
  if (!Number.isInteger(midi)) throw new Error('The selected string has no valid source tuning.');
  const otherStaves = new Set(children(measure).filter(item => item.localName === 'note').map(note => Number(text(child(note, 'staff')) || '1')));
  otherStaves.delete(tabStaff);
  if (group.length === 1 && child(group[0], 'rest')) {
    if (!beat.isRest) throw new Error('The source rest does not match the selected event.');
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
    if (beat.isRest || group.some(note => child(note, 'rest'))) throw new Error('The source chord does not match the selected event.');
    const sourceMembers = group.map(note => {
      const technical = child(child(note, 'notations') ?? note, 'technical');
      return `${text(child(technical ?? note, 'string'))}:${text(child(technical ?? note, 'fret'))}`;
    }).sort();
    const renderedMembers = beat.notes.map(note => `${6 - note.string}:${note.fret}`).sort();
    if (sourceMembers.join('|') !== renderedMembers.join('|')) throw new Error('The source chord does not match the selected event.');
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

export type RhythmPosition = { measure: number; beat: number; voice: number };
export type MusicXmlDurationInfo = { denominator: DurationDenominator | null; dots: number; rest: boolean; reason?: string };

export function inspectMusicXmlDuration(source: string, position: RhythmPosition): MusicXmlDurationInfo {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
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

function sourceDivisions(part: Element, measureIndex: number): bigint {
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

function setMeasureDivisions(measure: Element, divisions: bigint) {
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

function rescaleDivisions(part: Element, measureIndex: number, oldDivisions: bigint, newDivisions: bigint) {
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

function eventTime(group: Element[], divisions: bigint): RationalTime {
  const values = group.map(note => text(child(note, 'duration')));
  if (values.some(value => !/^\d+$/.test(value))) throw new Error('This event has an unsupported source duration.');
  if (new Set(values).size !== 1) throw new Error('This chord has inconsistent member durations.');
  return rationalTime(BigInt(values[0]), divisions);
}

function simpleRest(group: Element[]) {
  return group.length === 1 && Boolean(child(group[0], 'rest'))
    && children(group[0]).every(item => ['rest', 'duration', 'voice', 'type', 'dot', 'staff'].includes(item.localName))
    && !child(group[0], 'time-modification');
}

function writeDuration(group: Element[], denominator: DurationDenominator, dotted: boolean, ticks: bigint) {
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

function makeRest(document: Document, voice: string, staff: number, denominator: DurationDenominator, ticks: bigint) {
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

function rhythmLanes(document: Document, measure: Element, tabStaff: number, voice: string, eventIndex: number) {
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

export function changeMusicXmlDuration(source: string, score: model.Score, position: RhythmPosition,
  denominator: DurationDenominator, dotted = false): string {
  if (!DURATION_DENOMINATORS.includes(denominator)) throw new Error('Unsupported note duration.');
  const rendered = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice]?.beats?.[position.beat];
  if (!rendered || rendered.graceType) throw new Error('Select an ordinary event to change its duration.');
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
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

function shiftedEventProtection(group: Element[]): string | null {
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
  const part = descendants(document.documentElement, 'part')[0];
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
  const midi = kind === 'note' ? score.tracks[0].staves[0].tuning[options.string! - 1] + options.fret! : null;
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

const durationTypes: Record<string, DurationDenominator> = { whole: 1, half: 2, quarter: 4, eighth: 8,
  '16th': 16, '32nd': 32, '64th': 64 };

function setTripletRatio(note: Element, childDenominator: DurationDenominator) {
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

function setTupletMarker(note: Element, type: 'start' | 'stop') {
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
  const part = descendants(document.documentElement, 'part')[0];
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

function isThreeTwo(group: Element[]) {
  return group.length > 0 && group.every(note => {
    const modification = child(note, 'time-modification');
    return modification && text(child(modification, 'actual-notes')) === '3'
      && text(child(modification, 'normal-notes')) === '2';
  });
}

function tripletStart(groups: Element[][], selected: number): number | null {
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

function removableTripletRest(group: Element[]): boolean {
  if (group.length !== 1 || !child(group[0], 'rest') || !isThreeTwo(group)) return false;
  const note = group[0];
  if (children(note).some(item => !['rest', 'duration', 'voice', 'type', 'time-modification', 'staff', 'notations'].includes(item.localName))) return false;
  const notations = child(note, 'notations');
  return !notations || children(notations).every(item => item.localName === 'tuplet');
}

export type MusicXmlTripletInfo = { triplet: boolean; canRemove: boolean; start?: number; reason?: string };

export function inspectMusicXmlTriplet(source: string, position: RhythmPosition): MusicXmlTripletInfo {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
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
  const part = descendants(document.documentElement, 'part')[0];
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
