import { importer, model } from '@coderline/alphatab';
import { extractTechniques, applyTechniques } from './musicxml-techniques';
import type { ImportedScoreDocument } from './score';

export type MusicXmlSourceFormat = 'musicxml' | 'tef' | 'pdf';
export type TimedLyric = { measure: number; beat: number; text: string };
export type ChordDiagramPreview = { name: string; strings: number[]; firstFret: number; barreFrets: number[] };
export type MusicXmlPreview = {
  id: string;
  source: string;
  filename: string;
  sourceFormat: MusicXmlSourceFormat;
  score: model.Score;
  tuningLabel: string;
  lyricsSection: string | null;
  timedLyrics: TimedLyric[];
  chordDiagrams: ChordDiagramPreview[];
};

type ChordMetadata = { measure: number; position: number; name: string; strings: number[]; firstFret: number };

const elementChildren = (node: Element) => Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
const firstChild = (node: Element, name: string) => elementChildren(node).find(child => child.localName === name);
const childText = (node: Element, name: string) => firstChild(node, name)?.textContent ?? '';

function chordMetadata(source: string): ChordMetadata[] {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  const part = firstChild(doc.documentElement, 'part')!;
  const metadata: ChordMetadata[] = [];
  let divisions = 1;
  elementChildren(part).filter(node => node.localName === 'measure').forEach((measure, measureIndex) => {
    let position = 0;
    for (const item of elementChildren(measure)) {
      if (item.localName === 'attributes') divisions = Number(childText(item, 'divisions')) || divisions;
      if (item.localName === 'backup') {
        position -= Number(childText(item, 'duration')) * 960 / divisions;
        continue;
      }
      if (item.localName === 'forward') {
        position += Number(childText(item, 'duration')) * 960 / divisions;
        continue;
      }
      if (item.localName === 'harmony') {
        const strings = (item.getAttribute('data-playtab-strings') ?? '').split(',')
          .map(value => Number(value.trim())).filter(value => Number.isInteger(value));
        if (strings.length === 5) metadata.push({
          measure: measureIndex,
          position: position + Number(childText(item, 'offset')) * 960 / divisions,
          name: chordName(item),
          strings,
          firstFret: Number(item.getAttribute('data-playtab-first-fret')) || 1,
        });
        continue;
      }
      if (item.localName !== 'note' || firstChild(item, 'chord')) continue;
      position += Number(childText(item, 'duration')) * 960 / divisions;
    }
  });
  return metadata;
}

function chordName(harmony: Element): string {
  const root = firstChild(harmony, 'root');
  const step = childText(root ?? harmony, 'root-step').trim();
  const alter = Number(childText(root ?? harmony, 'root-alter'));
  const accidental = alter > 0 ? '#'.repeat(alter) : alter < 0 ? 'b'.repeat(-alter) : '';
  const suffixes: Record<string, string> = {
    major: '', minor: 'm', dominant: '7', 'major-seventh': 'maj7', 'minor-seventh': 'm7',
    diminished: 'dim', 'diminished-seventh': 'dim7', augmented: 'aug', 'augmented-seventh': 'aug7',
    'suspended-second': 'sus2', 'suspended-fourth': 'sus4',
  };
  const kind = childText(harmony, 'kind').trim().toLowerCase();
  return step ? `${step}${accidental}${suffixes[kind] ?? (kind === 'other' ? '' : kind)}` : '';
}

function applyChordMetadata(tab: model.Staff, metadata: ChordMetadata[]) {
  for (const entry of metadata) {
    const beats = (tab.bars[entry.measure]?.voices ?? []).flatMap(voice => voice.beats);
    const barStart = Math.min(...beats.map(beat => beat.playbackStart));
    const positioned: typeof beats = [];
    const named: typeof beats = [];
    for (const beat of beats) {
      if (beat.chord?.name === entry.name) named.push(beat);
      if (Math.abs(beat.playbackStart - barStart - entry.position) < 0.01 && beat.chord) positioned.push(beat);
    }
    const matches = positioned.length > 0 ? positioned : named;
    for (const beat of matches) {
      beat.chord!.strings = [...entry.strings];
      beat.chord!.firstFret = entry.firstFret;
    }
  }
}

function timedLyrics(tab: model.Staff): TimedLyric[] {
  const lyrics = new Map<string, TimedLyric>();
  for (const bar of tab.bars) {
    for (const beat of bar.voices.flatMap(voice => voice.beats)) {
      for (const value of (beat.lyrics ?? []).map(text => text.trim()).filter(Boolean)) {
        const key = `${beat.playbackStart}:${value}`;
        lyrics.set(key, { measure: bar.index + 1, beat: beat.index + 1, text: value });
      }
    }
  }
  return [...lyrics.values()];
}

function chordDiagrams(tab: model.Staff): ChordDiagramPreview[] {
  return [...(tab.chords?.values() ?? [])].filter(chord => {
    if (chord.strings.length !== 5 || !chord.strings.some(fret => fret >= 0)) return false;
    return true;
  }).map(chord => ({ name: chord.name, strings: [...chord.strings], firstFret: chord.firstFret, barreFrets: [...chord.barreFrets] }));
}

export function configureChordDiagrams(score: model.Score, enabled: boolean) {
  if (!score.stylesheet) return;
  score.stylesheet.globalDisplayChordDiagramsInScore = false;
  score.stylesheet.globalDisplayChordDiagramsOnTop = enabled;
  for (const staff of score.tracks?.[0]?.staves ?? []) {
    for (const chord of staff.chords?.values() ?? []) chord.showDiagram = enabled && chord.strings.length === staff.tuning.length && chord.strings.some(fret => fret >= 0);
  }
}

function configureImportedPlayback(track: model.Track) {
  const program = 105;
  track.playbackInfo.program = program;
  track.playbackInfo.bank = 0;

  // alphaTab creates an initial instrument automation while importing the
  // MusicXML part. It uses the MusicXML one-based program value after
  // converting it to zero-based form, so changing playbackInfo alone does not
  // change the MIDI program emitted for the first beat.
  const firstBeat = track.staves[0]?.bars[0]?.voices[0]?.beats[0];
  if (firstBeat) {
    const instrument = firstBeat.getAutomation(model.AutomationType.Instrument);
    if (instrument) instrument.value = program;
    else firstBeat.automations.push(model.Automation.buildInstrumentAutomation(false, 0, program));
  }
}

function previewId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// Preview keeps the imported model separate from the deliberately limited v1 document.
export function readMusicXml(source: string, filename: string, sourceFormat: MusicXmlSourceFormat = 'musicxml'): MusicXmlPreview {
  if (new TextEncoder().encode(source).length > 2_000_000) throw new Error('MusicXML preview is limited to 2 MB.');
  if (/<!ENTITY/i.test(source)) throw new Error('XML entity declarations are not supported.');
  if (!/<score-partwise[\s>]/.test(source)) throw new Error('Choose an uncompressed partwise MusicXML file.');
  const techniques = extractTechniques(source);
  const score = importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(techniques.source));
  if (score.tracks.length !== 1) throw new Error('Preview currently supports one banjo part.');
  const track = score.tracks[0];
  const tab = track.staves.find(s => s.tuning.length === 5);
  if (!tab) throw new Error('This file does not contain five-string tablature with explicit tuning.');
  if (score.masterBars.length > 256) throw new Error('Preview is limited to 256 measures.');

  // TuxGuitar exports standard notation and TAB as separate, duplicated staves.
  // Verify the duplication before removing the redundant staff from playback.
  const signature = (staff: model.Staff) => staff.bars.flatMap(bar => bar.voices.flatMap(voice => voice.beats.flatMap(beat => beat.notes.map(note => `${bar.index}:${beat.absolutePlaybackStart}:${beat.playbackDuration}:${note.realValue}`)))).sort().join('|');
  for (const staff of track.staves) {
    if (staff !== tab && signature(staff) !== signature(tab)) throw new Error('This score contains independent staff music that this preview cannot combine safely.');
  }
  const originalStaffIndex = tab.index;
  track.staves = [tab];
  tab.index = 0;
  tab.showStandardNotation = false;
  tab.showTablature = true;
  // Playtab previews are banjo arrangements. Imported files often omit a
  // usable General MIDI instrument, while comparison banks may only contain
  // their banjo preset at program 105.
  configureImportedPlayback(track);
  score.title = (score.title.trim() || filename.replace(/\.(musicxml|xml)$/i, '')).slice(0, 160);
  applyTechniques(score, tab, originalStaffIndex, techniques.markers);
  applyChordMetadata(tab, chordMetadata(source));
  const timedLyricEntries = timedLyrics(tab);
  const diagramEntries = chordDiagrams(tab);
  configureChordDiagrams(score, false);
  const names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const tuningLabel = [...tab.tuning].reverse().map((n, i) => i === 0 ? names[n % 12].toLowerCase() : names[n % 12]).join(' ');
  return {
    id: previewId(), source, filename, sourceFormat, score, tuningLabel,
    lyricsSection: techniques.lyricsSection, timedLyrics: timedLyricEntries, chordDiagrams: diagramEntries,
  };
}

export function toImportedScoreDocument(preview: MusicXmlPreview, warnings: string[]): ImportedScoreDocument {
  return {
    version: 2,
    kind: 'musicxml',
    title: preview.score.title.slice(0, 160),
    sourceName: preview.filename.slice(0, 160),
    sourceFormat: preview.sourceFormat,
    source: preview.source,
    warnings,
  };
}
