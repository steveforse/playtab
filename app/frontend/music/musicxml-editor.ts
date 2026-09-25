import type { model } from '@coderline/alphatab';
import type { SourceIdentityMap } from './source-identity';
import { DURATION_DENOMINATORS, REST_SPACE_ERROR, addTime as addRhythmTime, subtractTime as subtractRhythmTime, durationTime, fillRestTime, planDurationChange, rationalTime, compareTime,
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

// A fret or string edit must not silently change a connected span: the
// named span is removed explicitly first.
function rejectIncompatibleTransitions(sourceNotes: Element[]) {
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
    note: new Set(['chord', 'pitch', 'rest', 'duration', 'voice', 'type', 'dot', 'accidental', 'stem', 'beam', 'staff', 'notations', 'grace', 'tie', 'time-modification', 'instrument', 'lyric']),
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
  // An event's lyric moves to the promoted chord member or stays on the
  // resulting rest; only grace and later chord members would lose theirs.
  if (child(note, 'lyric') && (child(note, 'grace') || child(note, 'chord'))) return 'lyric';
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
      // The first member carries the time advance; promote its successor,
      // along with the event's timed lyrics so removing one note keeps them.
      removeChildren(next, 'chord');
      children(note).filter(item => item.localName === 'lyric').forEach(lyric =>
        placeLyric(next, lyric, Number(lyric.getAttribute('number') ?? '1') || 1));
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
  attachedDependencies(all).forEach(dependency => dependencies.add(dependency));
  repairAndDeleteNotes(document, part!, all);
  return { source: new XMLSerializer().serializeToString(document), dependencies: [...dependencies] };
}

function attachedDependencies(notes: Element[]): string[] {
  const label: Record<string, string> = { 'hammer-on': 'hammer-on', 'pull-off': 'pull-off', slide: 'slide', glissando: 'slide', tie: 'tie', tied: 'tie' };
  const dependencies = new Set<string>();
  for (const note of notes) {
    for (const marker of deletionMarkers(note)) dependencies.add(label[marker.localName]);
    if (descendants(note, 'bend').length) dependencies.add('bend');
  }
  return [...dependencies];
}

function repairAndDeleteNotes(document: Document, part: Element, notes: Element[]) {
  const deleting = new Set(notes);
  const staffNotes = new Map<string, Element[]>();
  descendants(part, 'note').filter(note => !child(note, 'rest')).forEach(note => {
    const staff = text(child(note, 'staff')) || '1';
    staffNotes.set(staff, [...(staffNotes.get(staff) ?? []), note]);
  });
  notes.forEach(note => removeLinkedMarkers(note, staffNotes.get(text(child(note, 'staff')) || '1') ?? [], deleting));
  deleteSourceNotes(document, notes);
}

export type GraceRemoval = { source: string; dependencies: string[]; groupRemoved: boolean };

// Removes one string of a grace event, or the whole event when no string is
// given (or its last string is selected). Grace notes own no measure time, so
// no rest is left behind; the group disappears with its final event.
export function removeMusicXmlGrace(source: string, score: model.Score, position: RemovalPosition): GraceRemoval {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
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

export function insertMusicXmlMeasure(source: string, score: model.Score, measureIndex: number,
  placement: 'before' | 'after'): string {
  if (placement !== 'before' && placement !== 'after') throw new Error('Invalid measure insertion position.');
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
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

function spanMarkerKey(marker: Element, note: Element): string {
  const voice = text(child(note, 'voice')) || '1';
  const staff = text(child(note, 'staff')) || '1';
  const technical = child(child(note, 'notations') ?? note, 'technical');
  const string = text(child(technical ?? note, 'string'));
  const pitch = child(note, 'pitch');
  const pitchKey = pitch ? `${text(child(pitch, 'step'))}:${text(child(pitch, 'alter'))}:${text(child(pitch, 'octave'))}` : '';
  const identity = marker.localName === 'tie' || marker.localName === 'tied' ? string || pitchKey : string;
  return `${marker.localName}:${marker.getAttribute('number') || '1'}:${staff}:${voice}:${identity}`;
}

function excludedCopySpans(original: Element, copy: Element): { excluded: string[]; outgoing: string[] } {
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
  const part = descendants(document.documentElement, 'part')[0];
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

function effectiveAttributes(measures: Element[], throughIndex: number): Element {
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

function inheritedTempo(measures: Element[], throughIndex: number): string | null {
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
  const part = descendants(document.documentElement, 'part')[0];
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

function meterRange(measures: Element[], measureIndex: number, scope: MeterScope) {
  const stop = scope === 'this' ? measureIndex + 1 : measures.findIndex((measure, index) => index > measureIndex && explicitTime(measure).length > 0);
  return { firstMeasure: measureIndex + 1,
    lastMeasure: stop < 0 ? measures.length : scope === 'this' ? measureIndex + 1 : stop };
}

export function inspectMusicXmlMeterRange(source: string, score: model.Score, measureIndex: number, scope: MeterScope) {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
  const measures = part ? directMeasures(part) : [];
  if (!measures[measureIndex] || measures.length !== score.masterBars.length) {
    throw new Error('The selected source measure cannot be identified safely.');
  }
  return meterRange(measures, measureIndex, scope);
}

function explicitTime(measure: Element) {
  return children(measure).filter(item => item.localName === 'attributes')
    .flatMap(item => children(item).filter(value => value.localName === 'time'));
}

function setMeasureTime(measure: Element, numerator: number, denominator: number) {
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

function resizeMeterBar(document: Document, part: Element, measureIndex: number, oldCapacity: RationalTime,
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
  if (backups.length !== lanes.size - 1 || backups.some(item => eventTime([item], oldDivisions)[0] * oldCapacity[1]
    !== oldCapacity[0] * eventTime([item], oldDivisions)[1])) {
    throw new Error(`Measure ${measureIndex + 1}: voice timing cannot be aligned safely.`);
  }
  const delta = subtractRhythmTime(newCapacity, oldCapacity);
  const changes: { lane: { staff: number; voice: string; groups: Element[][] }; remove: Element[]; rests: DurationDenominator[];
    reference: Node | null }[] = [];
  for (const lane of lanes.values()) {
    const { groups, voice } = lane;
    let total = rationalTime(0n);
    for (const group of groups) if (!child(group[0], 'grace')) total = addRhythmTime(total, eventTime(group, oldDivisions));
    if (compareTime(total, oldCapacity) !== 0) {
      throw new Error(`Measure ${measureIndex + 1}, voice ${voice}: source timing does not match the current meter.`);
    }
    const trailing: Element[][] = [];
    for (let index = groups.length - 1; index >= 0 && simpleRest(groups[index]); index--) trailing.unshift(groups[index]);
    let trailingTime = rationalTime(0n);
    for (const group of trailing) trailingTime = addRhythmTime(trailingTime, eventTime(group, oldDivisions));
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
  const part = descendants(document.documentElement, 'part')[0];
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

function firstLaneLength(measure: Element, divisions: bigint): RationalTime {
  const notes = children(measure).filter(item => item.localName === 'note');
  const first = notes[0];
  if (!first) throw new Error('The first measure has no source voice to resize.');
  const voice = text(child(first, 'voice')) || '1';
  const staff = text(child(first, 'staff')) || '1';
  let result = rationalTime(0n);
  for (const note of notes) {
    if ((text(child(note, 'voice')) || '1') !== voice || (text(child(note, 'staff')) || '1') !== staff
      || child(note, 'chord') || child(note, 'grace')) continue;
    result = addRhythmTime(result, eventTime([note], divisions));
  }
  return result;
}

export function changeMusicXmlPickup(source: string, score: model.Score, numerator: number,
  denominator: 2 | 4 | 8 | 16 | 32 | 64): string {
  if (!Number.isInteger(numerator) || numerator < 1 || ![2, 4, 8, 16, 32, 64].includes(denominator)) {
    throw new Error('Choose a positive pickup length with denominator 2, 4, 8, 16, 32, or 64.');
  }
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
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

export type TiePosition = { measure: number; beat: number; voice: number; string: number; fret: number };

function tieSourceRecords(document: Document, score: model.Score) {
  const part = descendants(document.documentElement, 'part')[0];
  if (!part || directMeasures(part).length !== score.masterBars.length) {
    throw new Error('The tie source measure count does not match the rendered score.');
  }
  return sourceTabNoteRecords(document).filter(record => !record.grace);
}

function tieRecord(records: ReturnType<typeof tieSourceRecords>, position: TiePosition) {
  const matches = records.filter(record => record.measure === position.measure && record.beat === position.beat
    && record.voice === String(position.voice) && record.string === position.string && record.fret === position.fret);
  if (matches.length !== 1) throw new Error('The selected tie endpoint cannot be uniquely identified in the source.');
  return matches[0];
}

function samePitch(left: Element, right: Element) {
  const pitch = (note: Element) => {
    const value = child(note, 'pitch');
    return value ? `${text(child(value, 'step'))}:${text(child(value, 'alter'))}:${text(child(value, 'octave'))}` : null;
  };
  return pitch(left) !== null && pitch(left) === pitch(right);
}

function transitionMarkers(note: Element) {
  return ['tie', 'tied', 'hammer-on', 'pull-off', 'slide', 'glissando'].flatMap(name => descendants(note, name));
}

function addTieMarker(note: Element, type: 'start' | 'stop') {
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

function removeTieMarker(note: Element, type: 'start' | 'stop') {
  for (const name of ['tie', 'tied']) for (const marker of descendants(note, name)) {
    if (marker.getAttribute('type') === type) marker.parentNode?.removeChild(marker);
  }
  const notations = child(note, 'notations');
  if (notations && !children(notations).length) note.removeChild(notations);
}

export function inspectMusicXmlTie(source: string, score: model.Score, position: TiePosition) {
  const document = parseDocument(source);
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
  const part = descendants(document.documentElement, 'part')[0]!;
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

export type RepeatRegion = { start: number; end: number; count: number };

function sourceRepeatRegions(measures: Element[]): RepeatRegion[] {
  const regions: RepeatRegion[] = [];
  let opening: number | null = null;
  for (const [index, measure] of measures.entries()) {
    for (const marker of descendants(measure, 'repeat')) {
      const direction = marker.getAttribute('direction');
      if (direction === 'forward') {
        if (opening !== null) throw new Error('Nested or overlapping imported repeats are preserved but cannot be edited here.');
        opening = index;
      } else if (direction === 'backward') {
        if (opening === null) throw new Error('An imported repeat end has no explicit start; redefine it before authoring another repeat.');
        const count = Number(marker.getAttribute('times') || '2');
        if (!Number.isInteger(count) || count < 2) throw new Error('An imported repeat has an unsupported play count.');
        regions.push({ start: opening, end: index, count });
        opening = null;
      } else throw new Error('An imported repeat has an unsupported direction.');
    }
  }
  if (opening !== null) throw new Error('An imported repeat start has no end; redefine it before authoring another repeat.');
  return regions;
}

export function inspectMusicXmlRepeats(source: string): RepeatRegion[] {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
  if (!part) throw new Error('The repeat source has no music part.');
  return sourceRepeatRegions(directMeasures(part));
}

function repeatBarline(document: Document, measure: Element, location: 'left' | 'right'): Element {
  let value = children(measure).find(item => item.localName === 'barline' && item.getAttribute('location') === location);
  if (!value) {
    value = document.createElement('barline'); value.setAttribute('location', location);
    if (location === 'left') measure.insertBefore(value, children(measure).find(item => item.localName === 'note') ?? null);
    else measure.appendChild(value);
  }
  return value;
}

export function addMusicXmlRepeat(source: string, score: model.Score, start: number, end: number, count: number): string {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
  const measures = part ? directMeasures(part) : [];
  if (!part || measures.length !== score.masterBars.length) throw new Error('The repeat source measures do not match the rendered score.');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= measures.length || start >= end) {
    throw new Error('Choose a repeat start before its end within this score.');
  }
  if (!Number.isInteger(count) || count < 2 || count > 8) throw new Error('Repeat count must be from 2 to 8.');
  const existing = sourceRepeatRegions(measures);
  const endingRanges = existing.map(region => knownRepeatEndings(measures, existing, region))
    .filter((item): item is RepeatEndings => item !== null);
  const endingMarkers = measures.reduce((total, measure) => total + descendants(measure, 'ending').length, 0);
  if (endingMarkers !== endingRanges.length * 4) {
    throw new Error('Existing repeat endings must be reviewed before adding another repeat.');
  }
  if (existing.some(region => start <= region.end && end >= region.start)) {
    throw new Error('Nested or overlapping repeat regions cannot be authored.');
  }
  if (endingRanges.some(item => start <= item.secondEnd && end >= item.firstStart)) {
    throw new Error('A new repeat cannot overlap existing first or second endings.');
  }
  const visits = measures.length + [...existing, { start, end, count }]
    .reduce((total, region) => total + (region.end - region.start + 1) * (region.count - 1), 0);
  if (visits > 4096) throw new Error('Repeat playback would exceed 4096 played measures.');
  const forward = document.createElement('repeat'); forward.setAttribute('direction', 'forward');
  repeatBarline(document, measures[start], 'left').appendChild(forward);
  const backward = document.createElement('repeat'); backward.setAttribute('direction', 'backward');
  backward.setAttribute('times', String(count));
  repeatBarline(document, measures[end], 'right').appendChild(backward);
  return new XMLSerializer().serializeToString(document);
}

export function addMusicXmlEndings(source: string, score: model.Score, repeatStart: number, repeatEnd: number,
  firstStart: number, secondEnd: number): string {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
  const measures = part ? directMeasures(part) : [];
  if (measures.length !== score.masterBars.length) throw new Error('The ending source measures do not match the rendered score.');
  const regions = sourceRepeatRegions(measures);
  const region = regions.find(item => item.start === repeatStart && item.end === repeatEnd);
  if (!region) throw new Error('Choose a known repeat region before adding endings.');
  if (region.count !== 2) throw new Error('First and second endings require a repeat count of 2.');
  if (!Number.isInteger(firstStart) || firstStart < repeatStart || firstStart > repeatEnd) {
    throw new Error('The first ending must start inside its repeat and end at the backward-repeat measure.');
  }
  const secondStart = repeatEnd + 1;
  if (!Number.isInteger(secondEnd) || secondEnd < secondStart || secondEnd >= measures.length) {
    throw new Error('The second ending must start immediately after the repeat and end within this score.');
  }
  if (regions.some(item => item !== region && item.start <= secondEnd && item.end >= firstStart)) {
    throw new Error('Ending measures cannot overlap another repeat.');
  }
  if (measures.slice(firstStart, secondEnd + 1).some(measure => descendants(measure, 'ending').length)) {
    throw new Error('Imported endings in this range must be reviewed before authoring new endings.');
  }
  const ending = (measure: Element, location: 'left' | 'right', number: string, type: 'start' | 'stop') => {
    const marker = document.createElement('ending'); marker.setAttribute('number', number); marker.setAttribute('type', type);
    const barline = repeatBarline(document, measure, location);
    if (type === 'stop') barline.insertBefore(marker, child(barline, 'repeat') ?? null);
    else barline.appendChild(marker);
  };
  ending(measures[firstStart], 'left', '1', 'start');
  ending(measures[repeatEnd], 'right', '1', 'stop');
  ending(measures[secondStart], 'left', '2', 'start');
  ending(measures[secondEnd], 'right', '2', 'stop');
  return new XMLSerializer().serializeToString(document);
}

export type RepeatEndings = { firstStart: number; firstEnd: number; secondStart: number; secondEnd: number };

function knownRepeatEndings(measures: Element[], regions: RepeatRegion[], region: RepeatRegion): RepeatEndings | null {
  const nextStart = regions.filter(item => item.start > region.end).map(item => item.start).sort((a, b) => a - b)[0] ?? measures.length;
  const markers = measures.slice(region.start, nextStart).flatMap((measure, offset) =>
    descendants(measure, 'ending').map(ending => ({ measure: region.start + offset,
      location: ending.parentElement?.getAttribute('location'), number: ending.getAttribute('number'),
      type: ending.getAttribute('type') })));
  if (!markers.length) return null;
  const first = markers.find(item => item.number === '1' && item.type === 'start');
  const secondStop = markers.find(item => item.number === '2' && item.type === 'stop');
  const expected = first && secondStop && [
    { measure: first.measure, location: 'left', number: '1', type: 'start' },
    { measure: region.end, location: 'right', number: '1', type: 'stop' },
    { measure: region.end + 1, location: 'left', number: '2', type: 'start' },
    { measure: secondStop.measure, location: 'right', number: '2', type: 'stop' },
  ];
  if (!expected || region.count !== 2 || first.measure < region.start || first.measure > region.end
    || secondStop.measure <= region.end || markers.length !== 4
    || !expected.every(item => markers.some(marker => Object.keys(item).every(key =>
      marker[key as keyof typeof marker] === item[key as keyof typeof item])))) {
    throw new Error('This imported ending map is preserved but cannot be edited safely.');
  }
  return { firstStart: first.measure, firstEnd: region.end, secondStart: region.end + 1, secondEnd: secondStop.measure };
}

export function inspectMusicXmlRepeatEndings(source: string, start: number, end: number): RepeatEndings | null {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
  if (!part) throw new Error('The repeat source has no music part.');
  const measures = directMeasures(part);
  const regions = sourceRepeatRegions(measures);
  const region = regions.find(item => item.start === start && item.end === end);
  if (!region) throw new Error('The selected repeat region cannot be identified.');
  return knownRepeatEndings(measures, regions, region);
}

export function removeMusicXmlRepeat(source: string, score: model.Score, start: number, end: number): string {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
  const measures = part ? directMeasures(part) : [];
  if (measures.length !== score.masterBars.length) throw new Error('The repeat source measures do not match the rendered score.');
  const regions = sourceRepeatRegions(measures);
  const region = regions.find(item => item.start === start && item.end === end);
  if (!region) throw new Error('The selected repeat region cannot be identified.');
  const endings = knownRepeatEndings(measures, regions, region);
  const removeMarker = (measure: number, tag: 'repeat' | 'ending', location: 'left' | 'right',
    attributes: Record<string, string>) => {
    const barline = children(measures[measure]).find(item => item.localName === 'barline' && item.getAttribute('location') === location);
    const marker = barline && children(barline).find(item => item.localName === tag &&
      Object.entries(attributes).every(([key, value]) => item.getAttribute(key) === value));
    if (!marker || !barline) throw new Error('The repeat endpoint changed before removal.');
    barline.removeChild(marker);
    if (!children(barline).length) barline.parentNode?.removeChild(barline);
  };
  removeMarker(region.start, 'repeat', 'left', { direction: 'forward' });
  removeMarker(region.end, 'repeat', 'right', { direction: 'backward' });
  if (endings) {
    removeMarker(endings.firstStart, 'ending', 'left', { number: '1', type: 'start' });
    removeMarker(endings.firstEnd, 'ending', 'right', { number: '1', type: 'stop' });
    removeMarker(endings.secondStart, 'ending', 'left', { number: '2', type: 'start' });
    removeMarker(endings.secondEnd, 'ending', 'right', { number: '2', type: 'stop' });
  }
  return new XMLSerializer().serializeToString(document);
}

export type GraceMember = { string: number; fret: number };
export type GraceTransition = 'none' | 'hammer-on' | 'pull-off' | 'slide';
export type GraceNoteSpec = GraceMember & { transition: GraceTransition };
// A null denominator is an imported grace event without a <type>; it stays
// unwritten so opening and applying the dialog never normalizes it.
export type GraceEventSpec = { denominator: 8 | 16 | null; notes: GraceNoteSpec[] };
export type GraceGroupInfo = { destination: number; events: GraceEventSpec[]; readOnly: string[]; connections: string[] };

const GRACE_TRANSITIONS: GraceTransition[] = ['none', 'hammer-on', 'pull-off', 'slide'];
const TRANSITION_LABELS: Record<Exclude<GraceTransition, 'none'>, string> = { 'hammer-on': 'hammer-on', 'pull-off': 'pull-off', slide: 'slide' };
const isGraceGroup = (group: Element[] | undefined) => Boolean(group?.length && group.every(note => child(note, 'grace')));
const noteTechnical = (note: Element) => child(child(note, 'notations') ?? note, 'technical');
const tabStringOf = (note: Element) => Number(text(child(noteTechnical(note) ?? note, 'string')));
const tabFretOf = (note: Element) => Number(text(child(noteTechnical(note) ?? note, 'fret')));

function transitionMarkersOf(note: Element) {
  const technical = noteTechnical(note);
  const notations = child(note, 'notations');
  return [
    ...(technical ? children(technical).filter(item => item.localName === 'hammer-on' || item.localName === 'pull-off') : []),
    ...(notations ? children(notations).filter(item => item.localName === 'slide') : []),
  ];
}

function locateGraceGroup(source: string, score: model.Score, position: RhythmPosition) {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
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
function unsupportedGraceDetail(note: Element, tab: boolean): string | null {
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

function readGraceEvents(located: ReturnType<typeof locateGraceGroup>) {
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
  const located = locateGraceGroup(source, score, position);
  const { events, readOnly } = readGraceEvents(located);
  const existing = located.lanes.flatMap(lane => lane.groups.slice(located.first, located.destination).flat());
  return { destination: located.destination, events, readOnly, connections: attachedDependencies(existing) };
}

function ensureNotations(note: Element) {
  const existing = child(note, 'notations');
  if (existing) return existing;
  const created = note.ownerDocument!.createElement('notations');
  note.insertBefore(created, children(note).find(item => ['lyric', 'play', 'listen'].includes(item.localName)) ?? null);
  return created;
}

function addTransitionMarker(note: Element, kind: Exclude<GraceTransition, 'none'>, type: 'start' | 'stop', slideNumber: number) {
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

function validateGraceEvents(events: GraceEventSpec[]) {
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
  const tuning = score.tracks[0].staves[0].tuning;
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

function annotatedSourceNote(document: Document, score: model.Score, position: TiePosition) {
  const part = descendants(document.documentElement, 'part')[0];
  if (!part || directMeasures(part).length !== score.masterBars.length) throw new Error('The source measure count does not match the rendered score.');
  const matches = sourceTabNoteRecords(document).filter(record => record.measure === position.measure && record.beat === position.beat
    && record.voice === String(position.voice) && record.string === position.string && record.fret === position.fret);
  if (matches.length !== 1) throw new Error('The selected note cannot be uniquely identified in the source.');
  return matches[0].note;
}

function pickingValue(marker: Element): PickingHand | null {
  if (marker.localName !== 'other-technical') return null;
  const value = text(marker);
  const tef = value.match(/^TEF fingering\s+(T|Thumb|I|M)$/i);
  if (tef) return tef[1].toUpperCase().startsWith('T') ? 'T' : tef[1].toUpperCase() as PickingHand;
  if (/^(?:Unresolved TEF fingering annotation code|TEF fingering code)\s+6$/i.test(value)) return 'T';
  const pdf = value.match(/^TEF right-hand fingering\s+([mpt])$/i);
  return pdf ? (pdf[1].toLowerCase() === 'm' ? 'M' : 'T') : null;
}

const pickingMarkers = (technical: Element | undefined) => technical ? children(technical).filter(item => pickingValue(item) !== null) : [];
const frettingMarkers = (technical: Element | undefined) => technical ? children(technical).filter(item => item.localName === 'fingering') : [];

function readHands(note: Element): Pick<NoteTechniqueInfo, 'picking' | 'pickingReason' | 'fretting' | 'frettingReason'> {
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

function readBend(note: Element): Pick<NoteTechniqueInfo, 'bend' | 'bendReason'> {
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
  const note = annotatedSourceNote(parseDocument(source), score, position);
  return { ...readHands(note), ...readBend(note) };
}

function technicalFor(note: Element) {
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

export type ChordQuality = 'major' | 'minor' | 'dominant' | 'major-seventh' | 'minor-seventh' | 'diminished' | 'augmented' | 'suspended-fourth';
export type ChordRoot = { step: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'; alter: -1 | 0 | 1 };
export type ChordSpelling = ChordRoot & { quality: ChordQuality; bass: ChordRoot | null };
export type AnchorKind = 'chord' | 'words' | 'section';
// An anchored item may be written once per staff (TEF imports duplicate
// chords and words on the notation and TAB staves); edits touch every copy.
export type AnchorItem = { text: string; chord?: ChordSpelling; reason?: string };
export type AnchorInfo = { chords: AnchorItem[]; words: AnchorItem[]; sections: AnchorItem[] };
export const ANCHOR_TEXT_LIMIT = 160;

const CHORD_SUFFIX: Record<ChordQuality, string> = { major: '', minor: 'm', dominant: '7', 'major-seventh': 'maj7', 'minor-seventh': 'm7',
  diminished: 'dim', augmented: 'aug', 'suspended-fourth': 'sus4' };
const rootName = (root: ChordRoot) => `${root.step}${root.alter === 1 ? '♯' : root.alter === -1 ? '♭' : ''}`;
export function chordSpellingName(chord: ChordSpelling) {
  return `${rootName(chord)}${CHORD_SUFFIX[chord.quality]}${chord.bass ? `/${rootName(chord.bass)}` : ''}`;
}

function measureTimeline(part: Element, measureIndex: number) {
  const measure = directMeasures(part)[measureIndex];
  const divisions = sourceDivisions(part, measureIndex);
  const onsets = new Map<Element, Rational>();
  let position = rational(0n);
  let last = position;
  const amount = (item: Element, name: string) => {
    const value = text(child(item, name));
    return /^-?\d+$/.test(value) ? rational(BigInt(value), divisions) : value ? null : rational(0n);
  };
  for (const item of children(measure)) {
    if (item.localName === 'backup' || item.localName === 'forward') {
      const duration = amount(item, 'duration') ?? rational(0n);
      position = item.localName === 'backup' ? subtractTime(position, duration) : addTime(position, duration);
    } else if (item.localName === 'harmony' || item.localName === 'direction') {
      const offset = amount(item, 'offset');
      if (offset) onsets.set(item, addTime(position, offset));
    } else if (item.localName === 'note') {
      const start = child(item, 'chord') ? last : position;
      onsets.set(item, start);
      last = start;
      if (!child(item, 'chord') && !child(item, 'grace')) position = addTime(position, amount(item, 'duration') ?? rational(0n));
    }
  }
  return { measure, onsets };
}

const sameTime = (left: Rational | undefined, right: Rational) => Boolean(left && left[0] * right[1] === right[0] * left[1]);

function readChord(harmony: Element): { text: string; chord?: ChordSpelling; reason?: string } {
  const root = child(harmony, 'root');
  const kind = child(harmony, 'kind');
  const readRoot = (node: Element | undefined, prefix: 'root' | 'bass'): ChordRoot | null => {
    if (!node || children(node).some(item => ![`${prefix}-step`, `${prefix}-alter`].includes(item.localName))) return null;
    const step = text(child(node, `${prefix}-step`)).toUpperCase();
    const alterText = text(child(node, `${prefix}-alter`)) || '0';
    if (!/^[A-G]$/.test(step) || !['-1', '0', '1'].includes(alterText)) return null;
    return { step: step as ChordRoot['step'], alter: Number(alterText) as ChordRoot['alter'] };
  };
  const spelledRoot = readRoot(root, 'root');
  const quality = text(kind) as ChordQuality;
  const displayed = kind?.getAttribute('text');
  const rawText = `${text(child(root ?? harmony, 'root-step'))}${({ '1': '♯', '-1': '♭' } as Record<string, string>)[text(child(root ?? harmony, 'root-alter'))] ?? ''}${displayed ?? quality}`;
  const bassNode = child(harmony, 'bass');
  const bass = bassNode ? readRoot(bassNode, 'bass') : null;
  const extra = children(harmony).find(item => !['root', 'kind', 'bass', 'offset', 'staff'].includes(item.localName));
  const extraAttribute = Array.from(harmony.attributes).find(attribute => attribute.name !== 'placement' && !attribute.name.startsWith('data-playtab-'));
  const known = Object.hasOwn(CHORD_SUFFIX, quality);
  if (!spelledRoot || !known || (bassNode && !bass) || extra || extraAttribute
    || (displayed !== null && displayed !== undefined && displayed !== CHORD_SUFFIX[quality])
    || Array.from(kind!.attributes).some(attribute => attribute.name !== 'text')) {
    return { text: rawText || 'Unnamed chord', reason: `The imported chord “${rawText || 'unnamed'}” uses a spelling or quality this dialog cannot rewrite faithfully; it is kept until you replace it.` };
  }
  const chord = { ...spelledRoot, quality, bass };
  return { text: chordSpellingName(chord), chord };
}

function anchorGroups(part: Element, measureIndex: number, onset: Rational) {
  const { measure, onsets } = measureTimeline(part, measureIndex);
  const group = <T extends { key: string; element: Element }>(entries: T[]) => {
    const grouped = new Map<string, T[]>();
    entries.forEach(entry => grouped.set(entry.key, [...(grouped.get(entry.key) ?? []), entry]));
    return [...grouped.values()];
  };
  const harmonies = children(measure).filter(item => item.localName === 'harmony' && sameTime(onsets.get(item), onset));
  const words = children(measure).filter(item => item.localName === 'direction' && sameTime(onsets.get(item), onset))
    .flatMap(direction => children(direction).filter(type => type.localName === 'direction-type').flatMap(type => children(type).filter(item => item.localName === 'words' && text(item))));
  const sections = descendants(measure, 'rehearsal');
  return {
    measure, onsets,
    chords: group(harmonies.map(element => ({ key: new XMLSerializer().serializeToString(element).replace(/<staff>\d+<\/staff>/, ''), element }))),
    words: group(words.map(element => ({ key: text(element), element }))),
    sections: group(sections.map(element => ({ key: text(element), element }))),
  };
}

function anchorEvent(document: Document, score: model.Score, position: RhythmPosition) {
  const part = descendants(document.documentElement, 'part')[0];
  const measure = part && directMeasures(part)[position.measure];
  const rendered = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice]?.beats?.[position.beat];
  if (!measure || !rendered || rendered.graceType) throw new Error('Select an ordinary event to anchor text to it.');
  const tabStaff = sourceTabStaff(document);
  const lanes = rhythmLanes(document, measure, tabStaff, String(position.voice + 1), position.beat);
  const anchors = lanes.map(lane => ({ staff: lane.staff, note: lane.groups[position.beat].find(note => !child(note, 'grace')) }));
  if (anchors.some(anchor => !anchor.note)) throw new Error('The selected event cannot be anchored safely.');
  const onset = measureTimeline(part, position.measure).onsets.get(anchors[0].note!);
  if (!onset) throw new Error('The selected event cannot be anchored safely.');
  return { part, measure, tabStaff, anchors: anchors as { staff: number; note: Element }[], onset };
}

export function inspectMusicXmlAnchor(source: string, score: model.Score, position: RhythmPosition): AnchorInfo {
  const document = parseDocument(source);
  const { part, onset } = anchorEvent(document, score, position);
  const groups = anchorGroups(part, position.measure, onset);
  return {
    chords: groups.chords.map(items => readChord(items[0].element)),
    words: groups.words.map(items => ({ text: items[0].key })),
    sections: groups.sections.map(items => ({ text: items[0].key })),
  };
}

function validChordRoot(root: ChordRoot | null | undefined) {
  return Boolean(root && /^[A-G]$/.test(root.step) && [-1, 0, 1].includes(root.alter));
}

function writeChord(harmony: Element, chord: ChordSpelling) {
  const document = harmony.ownerDocument!;
  const kept = children(harmony).filter(item => item.localName === 'offset' || item.localName === 'staff');
  children(harmony).forEach(item => harmony.removeChild(item));
  Array.from(harmony.attributes).filter(attribute => attribute.name.startsWith('data-playtab-')).forEach(attribute => harmony.removeAttribute(attribute.name));
  const root = document.createElement('root');
  setText(root, 'root-step', chord.step);
  if (chord.alter) setText(root, 'root-alter', String(chord.alter));
  harmony.appendChild(root);
  setText(harmony, 'kind', chord.quality);
  if (chord.bass) {
    const bass = document.createElement('bass');
    setText(bass, 'bass-step', chord.bass.step);
    if (chord.bass.alter) setText(bass, 'bass-alter', String(chord.bass.alter));
    harmony.appendChild(bass);
  }
  kept.forEach(item => harmony.appendChild(item));
}

function removeAnchored(element: Element) {
  const direction = element.localName === 'harmony' ? element : element.parentNode?.parentNode as Element;
  if (element.localName !== 'harmony') {
    const type = element.parentNode as Element;
    const lastType = children(type).length === 1 && children(direction).filter(item => item.localName === 'direction-type').length === 1;
    // A direction needs a direction-type, and its <sound> (a bar tempo, for
    // example) only keeps its meaning inside the direction: leave empty words.
    if (lastType && child(direction, 'sound')) { element.textContent = ''; return; }
    type.removeChild(element);
    if (children(type).length) return;
    direction.removeChild(type);
    if (children(direction).some(item => item.localName === 'direction-type')) return;
  }
  direction.parentNode?.removeChild(direction);
}

// Adds (index null), replaces, or removes (value null) one anchored item.
// Chords and annotations anchor at the selected event's onset on every
// staff lane; sections are rehearsal marks at the measure start.
export function changeMusicXmlAnchor(source: string, score: model.Score, position: RhythmPosition, kind: AnchorKind,
  index: number | null, value: ChordSpelling | string | null): string {
  if (typeof value === 'string' && (!value.trim() || value.trim().length > ANCHOR_TEXT_LIMIT)) {
    throw new Error(`Text must be 1–${ANCHOR_TEXT_LIMIT} characters.`);
  }
  if (value && typeof value !== 'string' && (!validChordRoot(value) || !Object.hasOwn(CHORD_SUFFIX, value.quality) || (value.bass && !validChordRoot(value.bass)))) {
    throw new Error('Choose a chord root, accidental, quality, and optional bass.');
  }
  if (value !== null && (kind === 'chord') === (typeof value === 'string')) throw new Error('This anchored item needs a matching value.');
  if (index === null && value === null) throw new Error('Choose an existing item to remove.');
  const document = parseDocument(source);
  const { part, measure, anchors, onset } = anchorEvent(document, score, position);
  const groups = anchorGroups(part, position.measure, onset);
  const list = kind === 'chord' ? groups.chords : kind === 'words' ? groups.words : groups.sections;
  if (index !== null) {
    const elements = list[index]?.map(item => item.element);
    if (!elements) throw new Error('The selected item is no longer at this position. Open the dialog again.');
    for (const element of elements) {
      if (value === null) removeAnchored(element);
      else if (kind === 'chord') writeChord(element, value as ChordSpelling);
      else element.textContent = (value as string).trim();
    }
    return new XMLSerializer().serializeToString(document);
  }
  if (kind === 'section') {
    const direction = document.createElement('direction');
    const type = ensure(direction, 'direction-type');
    setText(type, 'rehearsal', (value as string).trim());
    const first = children(measure).find(item => item.localName === 'note' || item.localName === 'backup' || item.localName === 'forward'
      || item.localName === 'harmony' || item.localName === 'direction');
    measure.insertBefore(direction, first ?? null);
    return new XMLSerializer().serializeToString(document);
  }
  for (const anchor of anchors) {
    const element = document.createElement(kind === 'chord' ? 'harmony' : 'direction');
    if (kind === 'chord') writeChord(element, value as ChordSpelling);
    else setText(ensure(element, 'direction-type'), 'words', (value as string).trim());
    setText(element, 'staff', String(anchor.staff));
    measure.insertBefore(element, anchor.note);
  }
  return new XMLSerializer().serializeToString(document);
}

export type LyricSyllabic = 'single' | 'begin' | 'middle' | 'end';
export type EventLyric = { verse: number; text: string; syllabic: LyricSyllabic; reason?: string };
export const LYRIC_VERSES = 8;
export const STANDALONE_LYRICS_LIMIT = 20_000;
const SYLLABIC: LyricSyllabic[] = ['single', 'begin', 'middle', 'end'];

// Timed lyrics live on the first note of an event, once per staff lane.
function lyricEvent(document: Document, score: model.Score, position: RhythmPosition) {
  const part = descendants(document.documentElement, 'part')[0];
  const measure = part && directMeasures(part)[position.measure];
  const rendered = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice]?.beats?.[position.beat];
  if (!measure || !rendered || rendered.graceType) throw new Error('Select an ordinary event to edit its lyric.');
  const lanes = rhythmLanes(document, measure, sourceTabStaff(document), String(position.voice + 1), position.beat);
  return lanes.map(lane => lane.groups[position.beat]);
}

function readLyrics(group: Element[]): EventLyric[] {
  const lyrics = group.flatMap(note => children(note).filter(item => item.localName === 'lyric'));
  const byVerse = new Map<number, Element[]>();
  const unnumbered: EventLyric[] = [];
  for (const lyric of lyrics) {
    const number = lyric.getAttribute('number') ?? '1';
    const verse = /^[1-8]$/.test(number) ? Number(number) : NaN;
    if (Number.isNaN(verse)) {
      unnumbered.push({ verse: 0, text: descendants(lyric, 'text').map(text).join(''), syllabic: 'single', reason: `The lyric verse “${number}” is kept as written.` });
      continue;
    }
    byVerse.set(verse, [...(byVerse.get(verse) ?? []), lyric]);
  }
  const numbered = [...byVerse.entries()].sort(([left], [right]) => left - right).map(([verse, entries]) => {
    const lyric = entries[0];
    const syllabic = (text(child(lyric, 'syllabic')) || 'single') as LyricSyllabic;
    const value = descendants(lyric, 'text').map(text).join('');
    const extra = children(lyric).find(item => !['syllabic', 'text'].includes(item.localName));
    const reason = entries.length > 1 ? `Verse ${verse} has more than one lyric on this event; it is kept as written.`
      : extra ? `Verse ${verse} has ${extra.localName === 'extend' ? 'an extension line' : `a ${extra.localName} setting`}; it is kept as written.`
        : descendants(lyric, 'text').length !== 1 || !SYLLABIC.includes(syllabic) ? `Verse ${verse} uses a lyric layout this dialog cannot rewrite; it is kept as written.`
          : Array.from(lyric.attributes).some(attribute => attribute.name !== 'number') ? `Verse ${verse} has lyric styling; it is kept as written.` : undefined;
    return { verse, text: value, syllabic: SYLLABIC.includes(syllabic) ? syllabic : 'single', ...(reason ? { reason } : {}) };
  });
  return [...numbered, ...unnumbered];
}

export function inspectMusicXmlLyrics(source: string, score: model.Score, position: RhythmPosition): EventLyric[] {
  return readLyrics(lyricEvent(parseDocument(source), score, position)[0]);
}

function placeLyric(note: Element, lyric: Element, verse: number) {
  const later = children(note).find(item => item.localName === 'lyric' && Number(item.getAttribute('number') ?? '1') > verse)
    ?? children(note).find(item => ['play', 'listen'].includes(item.localName));
  note.insertBefore(lyric, later ?? null);
}

// Sets (or removes, with null) one verse on the selected event in every
// staff lane. Other verses, events and the standalone text are untouched.
export function setMusicXmlLyric(source: string, score: model.Score, position: RhythmPosition, verse: number,
  value: { text: string; syllabic: LyricSyllabic } | null): string {
  if (!Number.isInteger(verse) || verse < 1 || verse > LYRIC_VERSES) throw new Error(`Choose a verse from 1 to ${LYRIC_VERSES}.`);
  if (value && (!value.text.trim() || value.text.trim().length > ANCHOR_TEXT_LIMIT)) {
    throw new Error(`Lyric text must be 1–${ANCHOR_TEXT_LIMIT} characters. Use Remove lyric to clear a verse.`);
  }
  if (value && !SYLLABIC.includes(value.syllabic)) throw new Error('Choose Single, Begin, Middle, or End.');
  const document = parseDocument(source);
  const groups = lyricEvent(document, score, position);
  const current = readLyrics(groups[0]).find(lyric => lyric.verse === verse);
  if (current?.reason && value) throw new Error(current.reason);
  if (!current && !value) return source;
  for (const group of groups) {
    group.flatMap(note => children(note).filter(item => item.localName === 'lyric' && (item.getAttribute('number') ?? '1') === String(verse)))
      .forEach(item => item.parentNode!.removeChild(item));
    if (!value) continue;
    const lyric = document.createElement('lyric');
    lyric.setAttribute('number', String(verse));
    setText(lyric, 'syllabic', value.syllabic);
    setText(lyric, 'text', value.text.trim());
    placeLyric(group[0], lyric, verse);
  }
  return new XMLSerializer().serializeToString(document);
}

export function setMusicXmlStandaloneLyrics(source: string, value: string): string {
  if (value.length > STANDALONE_LYRICS_LIMIT) throw new Error(`Lyrics & chords text is limited to ${STANDALONE_LYRICS_LIMIT.toLocaleString('en-US')} characters.`);
  const document = parseDocument(source);
  setLyrics(document, value.replaceAll('\0', ''));
  return new XMLSerializer().serializeToString(document);
}

export type TuningMode = 'frets' | 'pitches';
export type ScoreSettings = { title: string; tempo: number; tuning: number[]; mode: TuningMode };
export type ScoreSettingsInfo = { title: string; tempo: number; tuning: number[]; tuningRange: { first: number; last: number } };
export const TEMPO_LIMITS = { min: 30, max: 240 } as const;
export const TUNING_LIMITS = { min: 36, max: 96 } as const;

const pitchMidi = (pitch: Element | undefined) => {
  if (!pitch) return null;
  const step = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[text(child(pitch, 'step'))];
  const octave = Number(text(child(pitch, 'octave')));
  const alter = Number(text(child(pitch, 'alter')) || '0');
  return step === undefined || !Number.isInteger(octave) || !Number.isInteger(alter) ? null : (octave + 1) * 12 + step + alter;
};
const tuningMidi = (tuning: Element) => {
  const step = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[text(child(tuning, 'tuning-step'))];
  const octave = Number(text(child(tuning, 'tuning-octave')));
  const alter = Number(text(child(tuning, 'tuning-alter')) || '0');
  return step === undefined || !Number.isInteger(octave) || !Number.isInteger(alter) ? null : (octave + 1) * 12 + step + alter;
};

function tabTuningDetails(measure: Element, tabStaff: number) {
  return children(measure).filter(item => item.localName === 'attributes')
    .flatMap(attributes => children(attributes).filter(item => item.localName === 'staff-details'
      && (item.getAttribute('number') || '1') === String(tabStaff) && children(item).some(tuning => tuning.localName === 'staff-tuning')));
}

function scoreTuningState(document: Document, score: model.Score) {
  const part = descendants(document.documentElement, 'part')[0];
  if (!part) throw new Error('This score has no part to configure.');
  const measures = directMeasures(part);
  const tabStaff = sourceTabStaff(document);
  const initial = [...(score.tracks?.[0]?.staves?.[0]?.tuning ?? [])];
  const first = tabTuningDetails(measures[0], tabStaff)[0];
  for (const tuning of first ? children(first).filter(item => item.localName === 'staff-tuning') : []) {
    const midi = tuningMidi(tuning);
    const line = Number(tuning.getAttribute('line'));
    if (midi !== null && line >= 1 && line <= 5) initial[5 - line] = midi;
  }
  const next = measures.findIndex((measure, index) => index > 0 && tabTuningDetails(measure, tabStaff).length > 0);
  return { part, measures, tabStaff, initial, end: next < 0 ? measures.length : next, firstDetails: first };
}

function tempoDirectives(measure: Element, onsets: Map<Element, Rational>, onset: Rational) {
  return children(measure).filter(item => item.localName === 'direction' && sameTime(onsets.get(item), onset)
    && (descendants(item, 'metronome').length || child(item, 'sound')?.getAttribute('tempo')));
}

function directiveTempo(direction: Element) {
  const sound = Number(child(direction, 'sound')?.getAttribute('tempo'));
  if (Number.isFinite(sound) && sound > 0) return Math.round(sound);
  const perMinute = Number(text(descendants(direction, 'per-minute')[0]));
  return Number.isFinite(perMinute) && perMinute > 0 ? Math.round(perMinute) : null;
}

function setDirectiveTempo(direction: Element, tempo: number) {
  descendants(direction, 'per-minute').forEach(item => { item.textContent = String(tempo); });
  const sound = child(direction, 'sound');
  if (sound?.getAttribute('tempo')) sound.setAttribute('tempo', String(tempo));
}

function newTempoDirection(document: Document, tempo: number, staff: number) {
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
  const document = parseDocument(source);
  const { part, initial, end } = scoreTuningState(document, score);
  const { measure, onsets } = measureTimeline(part, 0);
  const opening = tempoDirectives(measure, onsets, rational(0n)).map(directiveTempo).find(value => value !== null);
  const title = text(descendants(document.documentElement, 'work-title')[0]) || text(descendants(document.documentElement, 'movement-title')[0]) || score.title;
  return { title, tempo: opening ?? Math.round(score.tempo || 120), tuning: initial, tuningRange: { first: 1, last: end } };
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
    throw new Error(`Each open string must be a MIDI pitch from ${TUNING_LIMITS.min} to ${TUNING_LIMITS.max}.`);
  }
  if (settings.mode !== 'frets' && settings.mode !== 'pitches') throw new Error('Choose Keep frets or Keep pitches.');
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
  const before = previewTuningConflicts(parseDocument(source), initial);
  const conflict = previewTuningConflicts(document, initial).find(item => !before.has(item.key));
  if (conflict) {
    throw new Error(`${conflict.where}: this score changes tuning again at measure ${end + 1}, and the preview plays one tuning per staff, so this note would sound wrong. No tuning change was applied.`);
  }
  return { source: new XMLSerializer().serializeToString(document), tuningRange };
}

// alphaTab keeps one tuning per staff (the last written value per string
// wins), so every written TAB pitch must agree with that tuning to preview.
function previewTuningConflicts(document: Document, fallback: number[]) {
  const tabStaff = sourceTabStaff(document);
  const part = descendants(document.documentElement, 'part')[0];
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

function tempoBefore(part: Element, measureIndex: number, onset: Rational, fallback: number) {
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
  const document = parseDocument(source);
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

export type TransitionKind = 'tie' | 'hammer-on' | 'pull-off' | 'slide';
export type NoteTransition = { kind: TransitionKind; direction: 'outgoing' | 'incoming'; other: { measure: number; event: number; fret: number } | null };
const TRANSITION_KINDS: TransitionKind[] = ['tie', 'hammer-on', 'pull-off', 'slide'];

function transitionLane(document: Document, score: model.Score, position: TiePosition) {
  const part = descendants(document.documentElement, 'part')[0];
  if (!part || directMeasures(part).length !== score.masterBars.length) throw new Error('The source measure count does not match the rendered score.');
  const records = sourceTabNoteRecords(document);
  const matches = records.filter(record => record.measure === position.measure && record.beat === position.beat
    && record.voice === String(position.voice) && record.string === position.string && record.fret === position.fret);
  if (matches.length !== 1) throw new Error('The selected note cannot be uniquely identified in the source.');
  const record = matches[0];
  return { record, lane: records.filter(item => item.voice === record.voice && item.string === record.string) };
}

function kindMarkers(note: Element, kind: TransitionKind, type: 'start' | 'stop') {
  const names = kind === 'tie' ? ['tie', 'tied'] : [kind];
  return descendants(note, names[0]).concat(names[1] ? descendants(note, names[1]) : [])
    .filter(marker => (marker.getAttribute('type') || (kind === 'tie' ? '' : 'start')) === type);
}

export function inspectMusicXmlTransitions(source: string, score: model.Score, position: TiePosition): NoteTransition[] {
  const { record, lane } = transitionLane(parseDocument(source), score, position);
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

// An in-memory copy of whole measures. It carries its own timing and
// tuning so it can be pasted into another open song during the session.
export type MeasureClipboard = {
  title: string; measures: string[]; meters: string[]; staves: number[]; tabStaff: number; tuning: number[]; excluded: string[];
};
export type PasteMode = 'insert' | 'replace';

function staffNumbers(measures: Element[]) {
  return [...new Set(measures.flatMap(measure => children(measure).filter(item => item.localName === 'note')
    .map(note => Number(text(child(note, 'staff')) || '1'))))].sort((left, right) => left - right);
}

function effectiveTabTuning(measures: Element[], throughIndex: number, tabStaff: number, fallback: number[]) {
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

function crossingSpans(originals: Element[], copies: Element[]) {
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
  const part = descendants(document.documentElement, 'part')[0];
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
    tuning: effectiveTabTuning(measures, first, tabStaff, [...(score.tracks?.[0]?.staves?.[0]?.tuning ?? [])]),
    excluded: [...excluded],
  };
}

function attributeValues(attributes: Element | undefined) {
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
  if (mode !== 'insert') throw new Error('Replacing measures is not available yet.');
  if (pitchMode !== 'frets' && pitchMode !== 'pitches') throw new Error('Choose Keep frets or Keep pitches.');
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
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
  const destinationTuning = effectiveTabTuning(measures, Math.max(0, measureIndex - 1), tabStaff, [...(score.tracks?.[0]?.staves?.[0]?.tuning ?? [])]);
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
  const pastedSet = new Set(pasted);
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
  return new XMLSerializer().serializeToString(document);
}

function parseMeasure(xml: string) {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.getElementsByTagName('parsererror').length || parsed.documentElement.localName !== 'measure') throw new Error('The clipboard content is not a measure.');
  return parsed.documentElement;
}
