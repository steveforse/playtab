import { describe, expect, it } from 'vitest';
import { demo, pitch, validateScore } from '../../app/frontend/music/score';
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
  });
  it('does not silently discard techniques, tuning, or missing rhythm', () => {
    const text = exportAscii(demo);
    expect(() => parseAscii(text.replace('0--', '0h2'), 'Test', 8)).toThrow('Techniques');
    expect(() => parseAscii(text.replace('D|', 'B|'), 'Test', 8)).toThrow('expected D');
    expect(() => parseAscii(text, 'Test', 4)).toThrow('needs 4');
    expect(() => parseAscii('', 'Test', 8)).toThrow('five');
  });
  it('reports lossy rest export instead of deleting rests', () => {
    const score = structuredClone(demo);
    score.measures[0].beats[0].notes = [];
    expect(() => exportAscii(score)).toThrow('rests');
  });
});
