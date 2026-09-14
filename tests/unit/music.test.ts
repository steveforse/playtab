import { describe, expect, it } from 'vitest';
import { demo, pitch, isImportedScoreDocument, validateImportedScore, validateScore, validateStoredScore } from '../../app/frontend/music/score';
import { parseAscii, exportAscii } from '../../app/frontend/music/ascii';
import { toAlphaTab } from '../../app/frontend/music/alphatab';

describe('five-string banjo contract', () => {
  it('maps musician string numbers to concert pitches and alphaTab positions', () => {
    const score = structuredClone(demo);
    score.measures[0].beats[0].notes = [1, 2, 3, 4, 5].map(string => ({ string, fret: 0 }));
    const converted = toAlphaTab(score);
    const notes = converted.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;
    expect(notes.map(n => n.realValue)).toEqual([62, 59, 55, 50, 67]);
    expect(notes.map(n => n.string)).toEqual([5, 4, 3, 2, 1]);
    expect(converted.tempo).toBe(96);
    expect(converted.tracks[0].playbackInfo.program).toBe(105);
    expect(pitch({ string: 5, fret: 2 }, score)).toBe(69);
  });
  it('rejects a duplicate string, malformed measures and unsupported tuning', () => {
    const duplicate = structuredClone(demo);
    duplicate.measures[0].beats[0].notes = [{ string: 1, fret: 0 }, { string: 1, fret: 2 }];
    expect(() => validateScore(duplicate)).toThrow('twice');
    expect(() => validateScore({ ...demo, measures: [null] })).toThrow();
    expect(() => validateScore({ ...demo, tuning: [64, 59, 55, 50, 67] })).toThrow('open G');
  });
});

describe('bounded ASCII importer', () => {
  it('round trips frets, chords and measures with explicit rhythm', () => {
    const original = structuredClone(demo);
    original.measures[0].beats[0].notes = [{ string: 1, fret: 12 }, { string: 5, fret: 10 }];
    const result = parseAscii(exportAscii(original), original.title, 8, original.tempo);
    expect(result.score).toEqual(original);
    expect(result.warnings).toHaveLength(2);

    const quarter = structuredClone(demo);
    quarter.measures = quarter.measures.map(measure => ({ beats: measure.beats.slice(0, 4).map(beat => ({ ...beat, duration: 4 as 4 })) }));
    expect(parseAscii(exportAscii(quarter), 'Quarter', 4).score.measures).toHaveLength(4);
    const sixteenth = structuredClone(demo);
    sixteenth.measures = sixteenth.measures.map(() => ({ beats: Array.from({ length: 16 }, (_, index) => ({ duration: 16 as 16, notes: [{ string: (index % 5) + 1, fret: 0 }] })) }));
    expect(parseAscii(exportAscii(sixteenth), 'Sixteenth', 16).score.measures).toHaveLength(4);
  });
  it('does not silently discard techniques, tuning, or missing rhythm', () => {
    const text = exportAscii(demo);
    expect(() => parseAscii(text.replace('0--', '0h2'), 'Test', 8)).toThrow('Techniques');
    expect(() => parseAscii(text.replace('D|', 'B|'), 'Test', 8)).toThrow('expected D');
    expect(() => parseAscii(text, 'Test', 4)).toThrow('needs 4');
    expect(() => parseAscii('', 'Test', 8)).toThrow('five');
    expect(() => parseAscii('x'.repeat(100_001), 'Test', 8)).toThrow('too large');
    expect(() => parseAscii(['D|0|', 'B|0|', 'G|0|', 'D|0|', 'g|0|0|'].join('\n'), 'Test', 1 as 4)).toThrow('Barlines');
    expect(() => parseAscii(['D|0|', 'B|0|', 'G|0|', 'D|0|', 'g|00|'].join('\n'), 'Test', 1 as 4)).toThrow('same width');
    expect(() => parseAscii(exportAscii(demo), 'Test', 4)).toThrow('needs 4');
  });
  it('reports lossy rest export instead of deleting rests', () => {
    const score = structuredClone(demo);
    score.measures[0].beats[0].notes = [];
    expect(() => exportAscii(score)).toThrow('rests');
  });

  it('rejects mixed-duration plaintext export', () => {
    const score = structuredClone(demo);
    score.measures[0].beats = Array.from({ length: 4 }, () => ({ duration: 4 as 4, notes: [{ string: 1, fret: 0 }] }));
    score.measures[1].beats = Array.from({ length: 8 }, () => ({ duration: 8 as 8, notes: [{ string: 1, fret: 0 }] }));
    expect(() => exportAscii(score)).toThrow('mixed note durations');
  });
  it('rejects overlapping two-digit fret columns', () => {
    const text = [
      'D|12 |', 'B| 3 |', 'G|   |', 'D|   |', 'g|   |',
    ].join('\n');
    expect(() => parseAscii(text, 'Overlap', 2 as 4)).toThrow('overlaps');
  });
});

describe('stored score validation', () => {
  const imported = {
    version: 2 as const, kind: 'musicxml' as const, title: 'Imported', sourceName: 'song.musicxml',
    sourceFormat: 'musicxml' as const, source: '<score-partwise version="4.0"/>', warnings: [],
  };

  it('covers native score validation limits', () => {
    expect(() => validateScore(null)).toThrow('object');
    expect(() => validateScore({ ...demo, version: 9 })).toThrow('version');
    expect(() => validateScore({ ...demo, title: '' })).toThrow('Title');
    expect(() => validateScore({ ...demo, title: 'x'.repeat(161) })).toThrow('Title');
    expect(() => validateScore({ ...demo, tempo: 29 })).toThrow('Tempo');
    expect(() => validateScore({ ...demo, tempo: 96.5 })).toThrow('Tempo');
    expect(() => validateScore({ ...demo, tempo: 241 })).toThrow('Tempo');
    expect(() => validateScore({ ...demo, fretConvention: 'absolute' as never })).toThrow('Frets');
    expect(() => validateScore({ ...demo, measures: [] })).toThrow('1–256');
    expect(() => validateScore({ ...demo, measures: Array.from({ length: 257 }, () => demo.measures[0]) })).toThrow('1–256');
    expect(() => validateScore({ ...demo, measures: [{ beats: [] }] })).toThrow('4, 8, or 16');
    expect(() => validateScore({ ...demo, measures: [{ beats: Array.from({ length: 4 }, (_, index) => ({ duration: index === 0 ? 8 : 4, notes: [] })) }] })).toThrow('durations');
    expect(() => validateScore({ ...demo, measures: [{ beats: [{ duration: 8, notes: [] }, { duration: 8, notes: [] }, { duration: 8, notes: [] }, { duration: 8, notes: [] }] }] })).toThrow('durations');
    expect(() => validateScore({ ...demo, measures: [{ beats: Array.from({ length: 4 }, () => ({ duration: 4, notes: Array.from({ length: 6 }, () => ({ string: 1, fret: 0 })) })) }] })).toThrow('chord');
    expect(() => validateScore({ ...demo, measures: [{ beats: [{ duration: 4, notes: [{ string: 0, fret: 0 }] }, ...demo.measures[0].beats.slice(1, 4)] }] })).toThrow('string');
    expect(() => validateScore({ ...demo, measures: [{ beats: [{ duration: 4, notes: [{ string: 1, fret: 23 }] }, ...demo.measures[0].beats.slice(1, 4)] }] })).toThrow('string');
  });

  it('validates imported documents, stored dispatch and type guards', () => {
    expect(() => validateImportedScore(null)).toThrow('object');
    expect(() => validateImportedScore({ ...imported, version: 1 })).toThrow('Unsupported');
    expect(() => validateImportedScore({ ...imported, title: '' })).toThrow('Title');
    expect(() => validateImportedScore({ ...imported, sourceName: '' })).toThrow('filename');
    expect(() => validateImportedScore({ ...imported, sourceFormat: 'mid' as never })).toThrow('format');
    expect(() => validateImportedScore({ ...imported, source: '<html/>' })).toThrow('MusicXML');
    expect(() => validateImportedScore({ ...imported, source: '<!ENTITY unsafe "x"><score-partwise/>' })).toThrow('MusicXML');
    expect(() => validateImportedScore({ ...imported, warnings: Array.from({ length: 21 }, () => 'warning') })).toThrow('warnings');
    expect(() => validateImportedScore({ ...imported, warnings: [1 as never] })).toThrow('warnings');
    expect(() => validateImportedScore({ ...imported, warnings: ['x'.repeat(501)] })).toThrow('warnings');
    expect(() => validateImportedScore(imported)).not.toThrow();
    expect(() => validateStoredScore(imported)).not.toThrow();
    expect(() => validateStoredScore(demo)).not.toThrow();
    expect(isImportedScoreDocument(imported)).toBe(true);
    expect(isImportedScoreDocument(demo)).toBe(false);
    expect(isImportedScoreDocument(null)).toBe(false);
  });
});
