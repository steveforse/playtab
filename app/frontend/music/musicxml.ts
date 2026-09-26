import { importer, model } from '@coderline/alphatab';
import { extractTechniques, applyTechniques } from './musicxml-techniques';
import type { ImportedScoreDocument, Score } from './score';
import { createSourceIdentityMap, reconcileSourceIdentityMap, sourceBeatIdsByAddress, type IdentityCarry, type SourceIdentityMap } from './source-identity';
import { musicXmlEditorState } from './musicxml-editor';
import { durationTime, fillRestTime, rationalTime } from '../editor/rhythm';
import { readSourceDocument } from './xml-cache';
import { applyFifthStringCapo } from './editor/tuning';
export { openTabTuning } from './editor/tuning';

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
  sourceIdentity?: SourceIdentityMap;
  sourceIdByModelNoteId?: Map<number, string>;
  sourceLocationById?: Map<string, { measure: number; beat: number; voice: number; string: number; fret: number }>;
  sourceIdByLocation?: Map<string, string>;
  sourceBeatIdByAddress?: Map<string, string>;
};

type ChordMetadata = { measure: number; position: number; name: string; strings: number[]; firstFret: number };

const elementChildren = (node: Element) => Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
const firstChild = (node: Element, name: string) => elementChildren(node).find(child => child.localName === name);
const childText = (node: Element, name: string) => firstChild(node, name)?.textContent ?? '';

function chordMetadata(source: string): ChordMetadata[] {
  const doc = readSourceDocument(source);
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
export function readMusicXml(source: string, filename: string, sourceFormat: MusicXmlSourceFormat = 'musicxml', previous?: { source: string; map: SourceIdentityMap; carries?: IdentityCarry[] }): MusicXmlPreview {
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
  const signature = (staff: model.Staff) => staff.bars.flatMap(bar => bar.voices.flatMap(voice => voice.beats.flatMap(beat => beat.notes.map(note => `${bar.index}:${beat.absolutePlaybackStart}:${beat.playbackDuration}:${note.realValue - staff.capo}`)))).sort().join('|');
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
  const sourceIdentity = previous
    ? reconcileSourceIdentityMap(previous.source, previous.map, source, previous.carries)
    : createSourceIdentityMap(source);
  const sourceBeatIdByAddress = sourceBeatIdsByAddress(source, sourceIdentity);
  const editorNotes = musicXmlEditorState(source, score, sourceIdentity).notes;
  const sourceIdByModelNoteId = new Map<number, string>();
  const sourceLocationById = new Map<string, { measure: number; beat: number; voice: number; string: number; fret: number }>();
  const sourceIdByLocation = new Map<string, string>();
  editorNotes.forEach(note => {
    if (!note.sourceIdentity || note.modelNoteId === undefined) return;
    sourceIdByModelNoteId.set(note.modelNoteId, note.sourceIdentity.id);
    const location = { measure: note.measure + 1, beat: note.beat + 1, voice: (note.voice ?? 0) + 1, string: note.string, fret: note.fret };
    sourceLocationById.set(note.sourceIdentity.id, location);
    sourceIdByLocation.set(`${location.measure}:${location.beat}:${location.voice}:${location.string}:${location.fret}`, note.sourceIdentity.id);
  });
  const names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const tuningLabel = [...tab.tuning].reverse().map((n, i) => i === 0 ? names[n % 12].toLowerCase() : names[n % 12]).join(' ');
  applyFifthStringCapo(score, tab, source);
  return {
    id: previewId(), source, filename, sourceFormat, score, tuningLabel,
    lyricsSection: techniques.lyricsSection, timedLyrics: timedLyricEntries, chordDiagrams: diagramEntries,
    sourceIdentity, sourceIdByModelNoteId, sourceLocationById, sourceIdByLocation, sourceBeatIdByAddress,
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

// Native v1 frets are relative to each string's nut. Materializing the same
// concert pitches in MusicXML lets a richer edit start without changing the
// stored v1 record until the caller explicitly saves the promoted document.
export function promoteNativeScore(score: Score): string {
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const pitch = (midi: number, prefix = '') => {
    const names: [string, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
    const [step, alter] = names[((midi % 12) + 12) % 12];
    return `<${prefix}step>${step}</${prefix}step>${alter ? `<${prefix}alter>${alter}</${prefix}alter>` : ''}<${prefix}octave>${Math.floor(midi / 12) - 1}</${prefix}octave>`;
  };
  const tuning = score.tuning.map((midi, index) => `<staff-tuning line="${5 - index}">${pitch(midi, 'tuning-')}</staff-tuning>`).reverse().join('');
  const measures = score.measures.map((measure, index) => {
    const attributes = index === 0 ? `<attributes><divisions>16</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>TAB</sign><line>5</line></clef><staff-details><staff-lines>5</staff-lines>${tuning}</staff-details></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute></metronome></direction-type><sound tempo="${score.tempo}"/></direction>` : '';
    const beatXml = measure.beats.map(beat => {
      const duration = 64 / beat.duration;
      const type = beat.duration === 4 ? 'quarter' : beat.duration === 8 ? 'eighth' : '16th';
      if (!beat.notes.length) return `<note><rest/><duration>${duration}</duration><voice>1</voice><type>${type}</type><staff>1</staff></note>`;
      return beat.notes.map((note, member) => `<note>${member ? '<chord/>' : ''}<pitch>${pitch(score.tuning[note.string - 1] + note.fret)}</pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type><staff>1</staff><notations><technical><string>${note.string}</string><fret>${note.fret}</fret></technical></notations></note>`).join('');
    }).join('');
    return `<measure number="${index + 1}">${attributes}${beatXml}</measure>`;
  }).join('');
  return `<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><work><work-title>${escape(score.title)}</work-title></work><part-list><score-part id="P1"><part-name>Banjo</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

export type BlankScoreOptions = { title: string; tempo: number; numerator: number; denominator: number; measures: number; tuning: number[] };
export const OPEN_G_TUNING = [62, 59, 55, 50, 67];

// A new score is an ordinary MusicXML document: one five-string TAB staff
// whose measures are filled with the exact rests of the chosen meter.
export function createBlankMusicXml(options: BlankScoreOptions): string {
  const title = options.title.trim();
  if (!title || title.length > 160) throw new Error('Title must be 1–160 characters.');
  if (!Number.isInteger(options.tempo) || options.tempo < 30 || options.tempo > 240) throw new Error('Tempo must be a whole number from 30 to 240 BPM.');
  if (!Number.isInteger(options.numerator) || options.numerator < 1 || options.numerator > 12 || ![2, 4, 8, 16].includes(options.denominator)) {
    throw new Error('Choose a time signature from 1 to 12 beats of 2, 4, 8, or 16.');
  }
  if (!Number.isInteger(options.measures) || options.measures < 1 || options.measures > 256) throw new Error('A score needs 1 to 256 measures.');
  if (options.tuning.length !== 5 || options.tuning.some(midi => !Number.isInteger(midi) || midi < 36 || midi > 96)) {
    throw new Error('Each open string must be a MIDI pitch from 36 to 96.');
  }
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const names: [string, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
  const tuningPitch = (midi: number) => {
    const [step, alter] = names[((midi % 12) + 12) % 12];
    return `<tuning-step>${step}</tuning-step>${alter ? `<tuning-alter>${alter}</tuning-alter>` : ''}<tuning-octave>${Math.floor(midi / 12) - 1}</tuning-octave>`;
  };
  const rests = fillRestTime(rationalTime(BigInt(options.numerator) * 4n, BigInt(options.denominator)));
  const gcd = (left: bigint, right: bigint): bigint => right === 0n ? left : gcd(right, left % right);
  const divisions = rests.reduce((value, rest) => { const unit = durationTime(rest)[1]; return value / gcd(value, unit) * unit; }, 1n);
  const types: Record<number, string> = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd', 64: '64th' };
  const restXml = rests.map(rest => {
    const [numerator, denominator] = durationTime(rest);
    return `<note><rest/><duration>${numerator * divisions / denominator}</duration><voice>1</voice><type>${types[rest]}</type><staff>1</staff></note>`;
  }).join('');
  const tuning = [...options.tuning].map((midi, index) => `<staff-tuning line="${5 - index}">${tuningPitch(midi)}</staff-tuning>`).reverse().join('');
  const measures = Array.from({ length: options.measures }, (_, index) => {
    const attributes = index === 0 ? `<attributes><divisions>${divisions}</divisions><key><fifths>0</fifths></key><time><beats>${options.numerator}</beats><beat-type>${options.denominator}</beat-type></time><clef><sign>TAB</sign><line>5</line></clef><staff-details><staff-lines>5</staff-lines>${tuning}</staff-details></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${options.tempo}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${options.tempo}"/></direction>` : '';
    return `<measure number="${index + 1}">${attributes}${restXml}</measure>`;
  }).join('');
  // Only work-title: alphaTab would also print a matching movement-title as a subtitle.
  return `<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><work><work-title>${escape(title)}</work-title></work><part-list><score-part id="P1"><part-name>Banjo</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}
