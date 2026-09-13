import fs from 'node:fs';
import { importer } from '@coderline/alphatab';

const [xml, report] = process.argv.slice(2);
const score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(fs.readFileSync(xml)));
const expected = fs.readFileSync(report, 'utf8').split('\n').filter(l => l.startsWith('note ')).map(line => {
  const f = Object.fromEntries([...line.matchAll(/(\w+)=(\d+)/g)].map(m => [m[1], Number(m[2])]));
  // TuxGuitar's timeline begins at one quarter-note (960 ticks).
  return [f.bar, f.tick - 960, f.duration, f.string, f.fret].join(':');
});
const staves = score.tracks.flatMap(t => t.staves).filter(s => s.tuning.length);
const actual = staves.flatMap(staff => staff.bars.flatMap(bar => bar.voices.flatMap(voice => voice.beats.flatMap(beat => beat.notes.map(note => [bar.index + 1, beat.absolutePlaybackStart, beat.playbackDuration, staff.tuning.length + 1 - note.string, note.fret].join(':'))))));
const count = rows => rows.reduce((m, row) => (m.set(row, (m.get(row) ?? 0) + 1), m), new Map());
const expectedCounts = count(expected), actualCounts = count(actual);
const mismatches = [...new Set([...expected, ...actual])].filter(k => expectedCounts.get(k) !== actualCounts.get(k));
console.log(JSON.stringify({
  measures: score.masterBars.length, tempo: score.tempo,
  tuning: staves.map(s => s.tuning),
  tuxguitarNotes: expected.length, alphaTabNotes: actual.length,
  noteTupleMismatches: mismatches.length,
  examples: mismatches.slice(0, 8),
  standardNotationStaves: score.tracks.flatMap(t => t.staves).filter(s => !s.tuning.length).length,
}, null, 2));
if (mismatches.length) process.exitCode = 1;
