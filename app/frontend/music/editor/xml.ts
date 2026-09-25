// DOM, pitch and parsing helpers shared by every editing command.
import { derived, readSourceDocument } from '../xml-cache';

export const children = (node: Element) => Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);

export const child = (node: Element, name: string) => children(node).find(candidate => candidate.localName === name);

export const descendants = (node: Element | Document, name: string) => Array.from(node.getElementsByTagName('*')).filter(candidate => candidate.localName === name);

export const directMeasures = (part: Element) => children(part).filter(candidate => candidate.localName === 'measure');

export const text = (node: Element | undefined) => node?.textContent?.trim() ?? '';

// A shared, cached parse for read-only inspection. Never mutate its result.
export function readDocument(source: string) {
  const document = readSourceDocument(source);
  if (document.getElementsByTagName('parsererror').length || document.documentElement.localName !== 'score-partwise') {
    throw new Error('Invalid MusicXML.');
  }
  return document;
}

export function parseDocument(source: string) {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length || document.documentElement.localName !== 'score-partwise') {
    throw new Error('Invalid MusicXML.');
  }
  return document;
}

// The part is a direct child of score-partwise; avoid walking every element.
export function scorePart(document: Document): Element | undefined {
  return children(document.documentElement).find(item => item.localName === 'part');
}

export const tabStaffCache = new WeakMap<Document, number>();

export function sourceTabStaff(document: Document): number {
  return derived(tabStaffCache, document, () => computeTabStaff(document));
}

export function computeTabStaff(document: Document): number {
  const details = descendants(document.documentElement, 'staff-details').find(item => text(child(item, 'staff-lines')) === '5');
  return Number(details?.getAttribute('number') || '1');
}

export function midiToPitch(midi: number) {
  const names: [string, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
  const [step, alter] = names[((midi % 12) + 12) % 12];
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

export function ensure(parent: Element, name: string) {
  const existing = child(parent, name);
  if (existing) return existing;
  const created = parent.ownerDocument!.createElement(name);
  parent.appendChild(created);
  return created;
}

export function setText(parent: Element, name: string, value: string) {
  ensure(parent, name).textContent = value;
}

export function removeChildren(parent: Element, name: string) {
  children(parent).filter(item => item.localName === name).forEach(item => parent.removeChild(item));
}

export function setPitch(note: Element, midi: number) {
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

export const noteTechnical = (note: Element) => child(child(note, 'notations') ?? note, 'technical');

export const tabStringOf = (note: Element) => Number(text(child(noteTechnical(note) ?? note, 'string')));

export const tabFretOf = (note: Element) => Number(text(child(noteTechnical(note) ?? note, 'fret')));

export function ensureNotations(note: Element) {
  const existing = child(note, 'notations');
  if (existing) return existing;
  const created = note.ownerDocument!.createElement('notations');
  note.insertBefore(created, children(note).find(item => ['lyric', 'play', 'listen'].includes(item.localName)) ?? null);
  return created;
}

export function placeLyric(note: Element, lyric: Element, verse: number) {
  const later = children(note).find(item => item.localName === 'lyric' && Number(item.getAttribute('number') ?? '1') > verse)
    ?? children(note).find(item => ['play', 'listen'].includes(item.localName));
  note.insertBefore(lyric, later ?? null);
}

export const pitchMidi = (pitch: Element | undefined) => {
  if (!pitch) return null;
  const step = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[text(child(pitch, 'step'))];
  const octave = Number(text(child(pitch, 'octave')));
  const alter = Number(text(child(pitch, 'alter')) || '0');
  return step === undefined || !Number.isInteger(octave) || !Number.isInteger(alter) ? null : (octave + 1) * 12 + step + alter;
};

export const tuningMidi = (tuning: Element) => {
  const step = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[text(child(tuning, 'tuning-step'))];
  const octave = Number(text(child(tuning, 'tuning-octave')));
  const alter = Number(text(child(tuning, 'tuning-alter')) || '0');
  return step === undefined || !Number.isInteger(octave) || !Number.isInteger(alter) ? null : (octave + 1) * 12 + step + alter;
};

export function parseMeasure(xml: string) {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.getElementsByTagName('parsererror').length || parsed.documentElement.localName !== 'measure') throw new Error('The clipboard content is not a measure.');
  return parsed.documentElement;
}
