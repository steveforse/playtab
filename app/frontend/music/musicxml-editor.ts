import type { model } from '@coderline/alphatab';

export type TechniqueChoice = 'keep' | 'none' | 'thumb' | 'finger-1' | 'finger-2' | 'finger-3' | 'finger-4' |
  'hammer-on-start' | 'hammer-on-stop' | 'pull-off-start' | 'pull-off-stop' | 'slide' | 'bend';

export type EditableMusicXmlNote = {
  index: number;
  measure: number;
  beat: number;
  string: number;
  fret: number;
  technique: TechniqueChoice;
  deleted?: boolean;
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
};

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

function sourceTabNotes(document: Document) {
  const staff = sourceTabStaff(document);
  const part = descendants(document.documentElement, 'part')[0];
  if (!part) return [];
  return directMeasures(part).flatMap(measure => children(measure).filter(note => note.localName === 'note')
    .filter(note => Number(text(child(note, 'staff')) || '1') === staff && child(child(note, 'notations') ?? note, 'technical') && child(child(child(note, 'notations') ?? note, 'technical')!, 'string')));
}

function modelNotes(score: model.Score) {
  const tab = score.tracks?.[0]?.staves?.[0];
  return tab?.bars.flatMap((bar, measure) => bar.voices.flatMap(voice => voice.beats.flatMap((beat, beatIndex) => beat.notes.map(note => ({ note, measure, beat: beatIndex })))) ) ?? [];
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

export function musicXmlEditorState(source: string, score: model.Score): MusicXmlEditorState {
  const document = parseDocument(source);
  const part = descendants(document.documentElement, 'part')[0];
  const tab = score.tracks?.[0]?.staves?.[0];
  const sourceNotes = sourceTabNotes(document);
  const renderedNotes = modelNotes(score);
  const fields = descendants(document.documentElement, 'miscellaneous-field');
  const lyrics = fields.find(field => field.getAttribute('name') === 'playtab-lyrics');
  const tempo = Number(descendants(document.documentElement, 'sound').find(sound => sound.getAttribute('tempo'))?.getAttribute('tempo') || score.tempo || 96);
  const annotations = descendants(document.documentElement, 'words').map(text).filter(Boolean);
  const chords = descendants(document.documentElement, 'harmony').map(chordName);
  const notes = renderedNotes.map(({ note, measure, beat }, index) => {
    const sourceNote = sourceNotes[index];
    return {
      index,
      measure,
      beat,
      string: sourceNote ? Number(text(child(child(child(sourceNote, 'notations') ?? sourceNote, 'technical') ?? sourceNote, 'string')) || String(6 - note.string)) : 6 - note.string,
      fret: note.fret,
      technique: sourceNote ? techniqueOf(sourceNote) : 'none',
    };
  });
  return {
    title: score.title.replaceAll('\u00a0', ' '),
    tempo: Number.isInteger(tempo) ? tempo : 96,
    tuning: [...(tab?.tuning ?? [])],
    measureCount: score.masterBars?.length ?? (part ? directMeasures(part).length : 1),
    lyricsSection: lyrics?.textContent?.replace(/^\s*(?:LYRICS\s*&\s*CHORDS|CHORDS\s*&\s*LYRICS)\s*\r?\n?/i, '').trimEnd() ?? '',
    annotations,
    chords,
    notes,
  };
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
  if (value.alter) setText(pitch, 'alter', String(value.alter));
  else removeChildren(pitch, 'alter');
  setText(pitch, 'octave', String(value.octave));
}

export function replaceTechnique(note: Element, choice: TechniqueChoice) {
  const notations = child(note, 'notations') ?? (() => { const created = note.ownerDocument!.createElement('notations'); note.appendChild(created); return created; })();
  const technical = child(notations, 'technical') ?? (() => { const created = note.ownerDocument!.createElement('technical'); notations.appendChild(created); return created; })();
  const replaceable = ['fingering', 'hammer-on', 'pull-off', 'slide', 'bend', 'other-technical'];
  children(technical).filter(item => replaceable.includes(item.localName)).forEach(item => technical.removeChild(item));
  if (choice === 'keep' || choice === 'none') return;
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

export function applyMusicXmlEdits(source: string, state: MusicXmlEditorState): string {
  const document = parseDocument(source);
  const root = document.documentElement;
  const work = descendants(root, 'work')[0] ?? (() => { const created = document.createElement('work'); root.insertBefore(created, root.firstChild); return created; })();
  setText(work, 'work-title', state.title.slice(0, 160));
  descendants(root, 'movement-title').forEach(title => { title.textContent = state.title.slice(0, 160); });

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

  const sourceNotes = sourceTabNotes(document);
  const tuning = state.tuning.length === 5 ? state.tuning : [62, 59, 55, 50, 67];
  const deletedNoteIndexes = new Set(state.notes.filter(edit => edit.deleted).map(edit => edit.index));
  state.notes.forEach(edit => {
    if (edit.deleted) return;
    const note = sourceNotes[edit.index];
    if (!note) return;
    const notations = child(note, 'notations') ?? (() => { const created = document.createElement('notations'); note.appendChild(created); return created; })();
    const technical = child(notations, 'technical') ?? (() => { const created = document.createElement('technical'); notations.appendChild(created); return created; })();
    setText(technical, 'string', String(edit.string));
    setText(technical, 'fret', String(edit.fret));
    setPitch(note, tuning[edit.string - 1] + edit.fret);
    replaceTechnique(note, edit.technique);
  });
  removeIncompatibleDirectionalTechniques(sourceNotes);
  sourceNotes.forEach((note, index) => {
    if (deletedNoteIndexes.has(index)) {
      removePairedTechniqueForDeletedNote(sourceNotes, index);
      note.parentNode?.removeChild(note);
    }
  });

  setLyrics(document, state.lyricsSection);
  setWords(document, state.annotations);
  setChords(document, state.chords);
  setMeasureCount(document, Math.max(1, Math.min(256, Math.round(state.measureCount))));
  return new XMLSerializer().serializeToString(document);
}
