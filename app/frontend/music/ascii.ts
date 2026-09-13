import { OPEN_G, validateScore, type Score, type Beat } from './score';

export type ImportResult = { score: Score; warnings: string[] };

// This is deliberately a small grammar. Never silently discard techniques or rhythm.
export function parseAscii(text: string, title: string, duration: 4 | 8 | 16, tempo = 96): ImportResult {
  if (text.length > 100_000) throw new Error('Text is too large (100 KB maximum).');
  const lines = text.replace(/\r/g, '').split('\n').filter(line => line.trim() && !line.startsWith('#'));
  if (lines.length === 0 || lines.length % 5 !== 0) throw new Error('Use groups of five tablature lines in D, B, G, D, g order. Put comments on lines beginning with #.');
  const measures: Score['measures'] = [];
  const expectedLabels = ['D', 'B', 'G', 'D', 'g'];
  for (let group = 0; group < lines.length; group += 5) {
    const rows = lines.slice(group, group + 5).map((line, index) => {
      const match = line.trim().match(/^([DBGdbg]?)\|([\d\- |]+)\|$/);
      if (!match) throw new Error(`Line ${group + index + 1}: use frets, dashes and barlines only. Techniques such as h, p and / are not supported yet.`);
      if (match[1] && match[1] !== expectedLabels[index]) throw new Error(`Line ${group + index + 1}: expected ${expectedLabels[index]} for open G tuning.`);
      return match[2].split('|');
    });
    if (!rows.every(row => row.length === rows[0].length)) throw new Error('Barlines must match on all five strings.');
    for (let bar = 0; bar < rows[0].length; bar++) {
      const cells = rows.map(row => row[bar]);
      if (!cells.every(cell => cell.length === cells[0].length)) throw new Error(`Measure ${measures.length + 1}: string lines must have the same width.`);
      const events = new Map<number, Beat['notes']>();
      cells.forEach((cell, stringIndex) => {
        for (const match of cell.matchAll(/\d+/g)) {
          const column = match.index!;
          const notes = events.get(column) ?? [];
          notes.push({ string: stringIndex + 1, fret: Number(match[0]) });
          events.set(column, notes);
        }
      });
      const columns = [...events.keys()].sort((a, b) => a - b);
      if (columns.some((column, i) => i > 0 && column < columns[i - 1] + Math.max(...events.get(columns[i - 1])!.map(n => String(n.fret).length)))) {
        throw new Error('A two-digit fret overlaps another event. Align simultaneous notes at their first digit.');
      }
      if (columns.length !== duration) throw new Error(`Measure ${measures.length + 1} has ${columns.length} note columns. A 4/4 measure with ${duration === 4 ? 'quarter' : duration === 8 ? 'eighth' : 'sixteenth'} notes needs ${duration}. Rest-only columns cannot be inferred.`);
      measures.push({ beats: columns.map(column => ({ duration, notes: events.get(column)! })) });
    }
  }
  const score: Score = { version: 1, title: title.trim(), tempo, tuning: [...OPEN_G], fretConvention: 'relative-to-string-nut', measures };
  validateScore(score);
  return { score, warnings: [
    `Rhythm assumed: every note column is a ${duration === 4 ? 'quarter' : duration === 8 ? 'eighth' : 'sixteenth'} note in 4/4. Spacing is not interpreted as time.`,
    'Open G tuning, no capo. Fifth-string frets are counted from its own nut (0 = G4, 2 = A4), not the full neck’s fret numbers.',
  ] };
}

export function exportAscii(score: Score): string {
  validateScore(score);
  if (new Set(score.measures.map(m => m.beats.length)).size > 1) throw new Error('Plaintext export does not yet support mixed note durations. Use Playtab JSON.');
  if (score.measures.some(m => m.beats.some(b => !b.notes.length))) throw new Error('Plaintext export does not yet encode rests. Use Playtab JSON for a lossless export.');
  const lines = ['D', 'B', 'G', 'D', 'g'].map((label, index) => {
    const bars = score.measures.map(m => m.beats.map(b => {
      const note = b.notes.find(n => n.string === index + 1);
      return (note ? String(note.fret) : '-').padEnd(3, '-');
    }).join(''));
    return `${label}|${bars.join('|')}|`;
  });
  return [`# ${score.title.replace(/[\r\n]/g, ' ')} · ${score.tempo} BPM · Open G · 4/4`,
    '# Frets are relative to each string’s nut. Fifth string: 0 = G4.',
    `# Notes per measure: ${score.measures.map(m => m.beats.length).join(', ')}. Choose matching duration when importing.`, ...lines].join('\n');
}
