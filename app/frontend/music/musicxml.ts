import { importer, type model } from '@coderline/alphatab';
import { extractTechniques, applyTechniques } from './musicxml-techniques';

export type MusicXmlPreview = { id: string; source: string; score: model.Score; tuningLabel: string; lyricsSection: string | null };

// Preview keeps the imported model separate from the deliberately limited v1 document.
export function readMusicXml(source: string, filename: string): MusicXmlPreview {
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
  score.title = score.title.trim() || filename.replace(/\.(musicxml|xml)$/i, '');
  applyTechniques(score, tab, originalStaffIndex, techniques.markers);
  const names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const tuningLabel = [...tab.tuning].reverse().map((n, i) => i === 0 ? names[n % 12].toLowerCase() : names[n % 12]).join(' ');
  return { id: crypto.randomUUID(), source, score, tuningLabel, lyricsSection: techniques.lyricsSection };
}
