export type TabNote = { string: number; fret: number };
export type Beat = { duration: 4 | 8 | 16; notes: TabNote[] };
export type Score = {
  version: 1;
  title: string;
  tempo: number;
  tuning: number[];
  fretConvention: 'relative-to-string-nut';
  measures: { beats: Beat[] }[];
};

export type ImportedScoreDocument = {
  version: 2;
  kind: 'musicxml';
  title: string;
  sourceName: string;
  sourceFormat: 'musicxml' | 'tef' | 'pdf';
  source: string;
  warnings: string[];
};

export type StoredScore = Score | ImportedScoreDocument;

// Top-to-bottom tablature order: first through fifth string. MIDI concert pitch.
export const OPEN_G = [62, 59, 55, 50, 67];

export function validateScore(value: unknown): asserts value is Score {
  const fail = (message: string): never => { throw new Error(message); };
  if (!value || typeof value !== 'object') fail('Score must be an object.');
  const score = value as Score;
  if (score.version !== 1) fail('Unsupported score version.');
  if (typeof score.title !== 'string' || !score.title.trim() || score.title.length > 160) fail('Title must contain 1–160 characters.');
  if (!Number.isInteger(score.tempo) || score.tempo < 30 || score.tempo > 240) fail('Tempo must be 30–240 BPM.');
  if (JSON.stringify(score.tuning) !== JSON.stringify(OPEN_G)) fail('This first version supports open G tuning only.');
  if (score.fretConvention !== 'relative-to-string-nut') fail('Frets must be relative to each string’s nut.');
  if (!Array.isArray(score.measures) || score.measures.length < 1 || score.measures.length > 256) fail('Use 1–256 measures.');
  for (const measure of score.measures) {
    if (!measure || !Array.isArray(measure.beats) || ![4, 8, 16].includes(measure.beats.length)) fail('Each 4/4 measure needs 4, 8, or 16 equal beats.');
    for (const beat of measure.beats) {
      if (!beat || beat.duration !== measure.beats.length) fail('Beat durations must fill a 4/4 measure.');
      if (!Array.isArray(beat.notes) || beat.notes.length > 5) fail('Invalid chord.');
      const strings = new Set<number>();
      for (const note of beat.notes) {
        if (!note || !Number.isInteger(note.string) || note.string < 1 || note.string > 5 || !Number.isInteger(note.fret) || note.fret < 0 || note.fret > 22) fail('Notes need a string from 1–5 and a fret from 0–22.');
        if (strings.has(note.string)) fail('A chord cannot play a string twice.');
        strings.add(note.string);
      }
    }
  }
}

export function validateImportedScore(value: unknown): asserts value is ImportedScoreDocument {
  const fail = (message: string): never => { throw new Error(message); };
  if (!value || typeof value !== 'object') fail('Score must be an object.');
  const document = value as ImportedScoreDocument;
  if (document.version !== 2 || document.kind !== 'musicxml') fail('Unsupported imported score document.');
  if (typeof document.title !== 'string' || !document.title.trim() || document.title.length > 160) fail('Title must contain 1–160 characters.');
  if (typeof document.sourceName !== 'string' || !document.sourceName.trim() || document.sourceName.length > 160) fail('Imported filename must contain 1–160 characters.');
  if (document.sourceFormat !== 'musicxml' && document.sourceFormat !== 'tef' && document.sourceFormat !== 'pdf') fail('Unsupported imported score format.');
  if (typeof document.source !== 'string' || new TextEncoder().encode(document.source).length > 2_000_000 || !/<score-partwise[\s>]/.test(document.source)) fail('Imported MusicXML is invalid or too large.');
  if (!Array.isArray(document.warnings) || document.warnings.length > 20 || document.warnings.some(warning => typeof warning !== 'string' || warning.length > 500)) fail('Invalid import warnings.');
}

export function validateStoredScore(value: unknown): asserts value is StoredScore {
  if (value && typeof value === 'object' && (value as { version?: unknown }).version === 2) validateImportedScore(value);
  else validateScore(value);
}

export function isImportedScoreDocument(value: unknown): value is ImportedScoreDocument {
  return Boolean(value && typeof value === 'object' && (value as { version?: unknown; kind?: unknown }).version === 2 && (value as { kind?: unknown }).kind === 'musicxml');
}

export function pitch(note: TabNote, score: Score): number {
  return score.tuning[note.string - 1] + note.fret;
}

export const demo: Score = {
  version: 1, title: 'An open-G kind of morning', tempo: 96,
  tuning: OPEN_G, fretConvention: 'relative-to-string-nut',
  measures: [
    [3, 2, 1, 5, 2, 1, 3, 1],
    [4, 2, 1, 5, 2, 1, 4, 1],
    [3, 2, 1, 5, 2, 1, 3, 1],
    [4, 2, 1, 5, 3, 2, 1, 5],
  ].map((strings, index) => ({ beats: strings.map(string => ({
    duration: 8, notes: [{ string, fret: index === 1 && string === 4 ? 2 : 0 }],
  })) })),
};
