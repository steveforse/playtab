// Anchored chords, sections, annotations, timed lyrics and standalone text.
import type { model } from '@coderline/alphatab';
import { child, children, descendants, directMeasures, ensure, parseDocument, placeLyric, readDocument, scorePart, setText, sourceTabStaff, text } from './xml';
import { measureTimeline, rhythmLanes, sameTime, type Rational, type RhythmPosition } from './time';
import { setLyrics } from './state';

export type ChordQuality = 'major' | 'minor' | 'dominant' | 'major-seventh' | 'minor-seventh' | 'diminished' | 'augmented' | 'suspended-fourth';

export type ChordRoot = { step: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'; alter: -1 | 0 | 1 };

export type ChordSpelling = ChordRoot & { quality: ChordQuality; bass: ChordRoot | null };

export type AnchorKind = 'chord' | 'words' | 'section';

// An anchored item may be written once per staff (TEF imports duplicate
// chords and words on the notation and TAB staves); edits touch every copy.
export type AnchorItem = { text: string; chord?: ChordSpelling; reason?: string };

export type AnchorInfo = { chords: AnchorItem[]; words: AnchorItem[]; sections: AnchorItem[] };

export const ANCHOR_TEXT_LIMIT = 160;

export const CHORD_SUFFIX: Record<ChordQuality, string> = { major: '', minor: 'm', dominant: '7', 'major-seventh': 'maj7', 'minor-seventh': 'm7',
  diminished: 'dim', augmented: 'aug', 'suspended-fourth': 'sus4' };

export const rootName = (root: ChordRoot) => `${root.step}${root.alter === 1 ? '♯' : root.alter === -1 ? '♭' : ''}`;

export function chordSpellingName(chord: ChordSpelling) {
  return `${rootName(chord)}${CHORD_SUFFIX[chord.quality]}${chord.bass ? `/${rootName(chord.bass)}` : ''}`;
}

export function readChord(harmony: Element): { text: string; chord?: ChordSpelling; reason?: string } {
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

export function anchorGroups(part: Element, measureIndex: number, onset: Rational) {
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

export function anchorEvent(document: Document, score: model.Score, position: RhythmPosition) {
  const part = scorePart(document);
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
  const document = readDocument(source);
  const { part, onset } = anchorEvent(document, score, position);
  const groups = anchorGroups(part, position.measure, onset);
  return {
    chords: groups.chords.map(items => readChord(items[0].element)),
    words: groups.words.map(items => ({ text: items[0].key })),
    sections: groups.sections.map(items => ({ text: items[0].key })),
  };
}

export function validChordRoot(root: ChordRoot | null | undefined) {
  return Boolean(root && /^[A-G]$/.test(root.step) && [-1, 0, 1].includes(root.alter));
}

export function writeChord(harmony: Element, chord: ChordSpelling) {
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

export function removeAnchored(element: Element) {
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

export const SYLLABIC: LyricSyllabic[] = ['single', 'begin', 'middle', 'end'];

// Timed lyrics live on the first note of an event, once per staff lane.
export function lyricEvent(document: Document, score: model.Score, position: RhythmPosition) {
  const part = scorePart(document);
  const measure = part && directMeasures(part)[position.measure];
  const rendered = score.tracks?.[0]?.staves?.[0]?.bars?.[position.measure]?.voices?.[position.voice]?.beats?.[position.beat];
  if (!measure || !rendered || rendered.graceType) throw new Error('Select an ordinary event to edit its lyric.');
  const lanes = rhythmLanes(document, measure, sourceTabStaff(document), String(position.voice + 1), position.beat);
  return lanes.map(lane => lane.groups[position.beat]);
}

export function readLyrics(group: Element[]): EventLyric[] {
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
  return readLyrics(lyricEvent(readDocument(source), score, position)[0]);
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
