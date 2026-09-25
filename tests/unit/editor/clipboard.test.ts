import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { midi, Settings } from '@coderline/alphatab';
import { linearAuditionMidi, writtenPlaybackRange } from '../../../app/frontend/editor/audition';
import { selectionFromBeat } from '../../../app/frontend/Player';
import { createBlankMusicXml, OPEN_G_TUNING, readMusicXml } from '../../../app/frontend/music/musicxml';
import { addMusicXmlEndings, addMusicXmlGraceGroup, addMusicXmlRepeat, applyMusicXmlEdits, applyMusicXmlGraceGroup, inspectMusicXmlGraceGroup, removeMusicXmlGrace, removeMusicXmlGraceGroup, changeMusicXmlMeter, changeMusicXmlPickup, connectMusicXmlTie, deleteMusicXmlMeasure, duplicateMusicXmlMeasure, insertMusicXmlMeasure,
  inspectMusicXmlRepeatEndings, inspectMusicXmlRepeats, removeMusicXmlRepeat,
  inspectMusicXmlTie, removeMusicXmlTie,
  inspectMusicXmlMeterRange, musicXmlEditorState, addMusicXmlNote, inspectMusicXmlNoteTechniques, setMusicXmlBend, setMusicXmlHand, changeMusicXmlAnchor, inspectMusicXmlAnchor, removeMusicXmlNotes,
  inspectMusicXmlLyrics, setMusicXmlLyric, setMusicXmlStandaloneLyrics, applyMusicXmlScoreSettings, inspectMusicXmlScoreSettings,
  inspectMusicXmlTempo, setMusicXmlLocalTempo, connectMusicXmlTransition, inspectMusicXmlTransitions, removeMusicXmlTransition, copyMusicXmlMeasures, pasteMusicXmlMeasures, cutMusicXmlMeasures, changeMusicXmlDuration, insertMusicXmlEvent,
  type ChordSpelling } from '../../../app/frontend/music/musicxml-editor';

import './support';
import { rich } from './support';

describe('ED-20 cut and replace whole measures', () => {
  const score = (source: string) => readMusicXml(source, 'cut.musicxml').score;
  const withOpaque = rich.replace('<staff-details number="2"><staff-tuning line="1"><tuning-step>A</tuning-step><tuning-octave>4</tuning-octave></staff-tuning></staff-details>', '');
  const single = withOpaque.replace('<opaque:keep data="unchanged"><opaque:nested>source detail</opaque:nested></opaque:keep>', '');
  const tabNotes = (source: string, index: number) => Array.from(new DOMParser().parseFromString(source, 'application/xml')
    .getElementsByTagName('measure')[index].getElementsByTagName('note')).filter(note => note.getElementsByTagName('staff')[0]?.textContent === '2');
  const frets = (source: string, index: number) => tabNotes(source, index).filter(note => note.getElementsByTagName('fret').length).map(note => note.getElementsByTagName('fret')[0].textContent);

  it('cuts whole measures to rests at the same onsets after copying them', () => {
    expect(() => cutMusicXmlMeasures(single, score(single), 0, 0)).toThrow('Cutting these measures would split a tie that crosses the passage edge. Remove it first.');
    const cut = cutMusicXmlMeasures(single, score(single), 0, 1);
    expect(cut.clipboard.measures).toHaveLength(2);
    expect(cut).toMatchObject({ labels: 1, lyrics: 2 });
    expect(cut.notes).toBeGreaterThan(10);
    expect(cut.spans.sort()).toEqual(['hammer-on', 'slide', 'tie']);
    const before = score(single);
    const after = score(cut.source);
    expect(after.masterBars.map(bar => bar.calculateDuration())).toEqual(before.masterBars.map(bar => bar.calculateDuration()));
    expect(after.tracks[0].staves[0].bars.flatMap(bar => bar.voices.flatMap(voice => voice.beats)).every(beat => beat.isRest || beat.isEmpty)).toBe(true);
    const onsets = (value: typeof before) => value.tracks[0].staves[0].bars.flatMap(bar => bar.voices.flatMap(voice => voice.beats.filter(beat => !beat.graceType).map(beat => beat.playbackStart)));
    expect(onsets(after)).toEqual(onsets(before));
    expect(cut.source).not.toContain('<harmony');
    expect(cut.source).toContain('<sound tempo="96"/>');
    expect(cut.source).toContain('<sound tempo="108"/>');
    expect(cut.source).not.toContain('<lyric');
    expect(cut.source).not.toContain('<grace');
    expect(single).not.toContain('opaque:keep');
    expect(() => cutMusicXmlMeasures(withOpaque, score(withOpaque), 0, 1)).toThrow('Cutting these measures is blocked by a protected keep attachment that Playtab cannot remove safely.');
  });

  it('replaces the content of matching measures, keeping their tempo, barlines and bar count', () => {
    const cut = cutMusicXmlMeasures(single, score(single), 0, 1);
    const clip = copyMusicXmlMeasures(single, score(single), 0, 0);
    const replaced = pasteMusicXmlMeasures(cut.source, score(cut.source), clip, 0, 'replace', 'frets');
    expect(score(replaced).masterBars).toHaveLength(2);
    expect(frets(replaced, 0)).toEqual(frets(single, 0));
    expect(frets(replaced, 1)).toEqual([]);
    expect(replaced.match(/<sound tempo="96"\/>/g)).toHaveLength(1);
    expect(replaced).toContain('<repeat direction="forward"/>');
    expect(replaced).toContain('<harmony>');
    expect(() => pasteMusicXmlMeasures(cut.source, score(cut.source), clip, 1, 'replace', 'frets'))
      .toThrow('Copied measure 1 is in 4/4, but measure 2 is in 3/4. Replace needs matching meters.');
    expect(() => pasteMusicXmlMeasures(cut.source, score(cut.source), { ...clip, measures: [clip.measures[0], clip.measures[0]], meters: ['4/4', '4/4'] }, 1, 'replace', 'frets'))
      .toThrow('Replacing needs 2 measures from measure 2, but the score ends at measure 2.');
    expect(() => pasteMusicXmlMeasures(single, score(single), clip, 0, 'replace', 'frets')).toThrow('Replacing these measures would split a tie');
    expect(() => pasteMusicXmlMeasures(cut.source, score(cut.source), clip, 0, 'sideways' as 'insert', 'frets')).toThrow('Choose Insert measures before or Replace selected measures.');
    const doubled = { ...clip, measures: [clip.measures[0].replace('<divisions>1</divisions>', '<divisions>2</divisions>')
      .replace(/<duration>(\d+)<\/duration>/g, (_, value) => `<duration>${Number(value) * 2}</duration>`)] };
    const precise = pasteMusicXmlMeasures(cut.source, score(cut.source), doubled, 0, 'replace', 'frets');
    const measures = new DOMParser().parseFromString(precise, 'application/xml').getElementsByTagName('measure');
    expect(measures[0].getElementsByTagName('divisions')[0].textContent).toBe('2');
    expect(measures[1].getElementsByTagName('divisions')[0].textContent).toBe('1');
    expect(score(precise).masterBars.map(bar => bar.calculateDuration())).toEqual(score(cut.source).masterBars.map(bar => bar.calculateDuration()));
    const midBar = cut.source.replace(/(<measure number="1">[\s\S]*?<\/note>)/, '$1<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>70</per-minute></metronome></direction-type><sound tempo="70"/></direction>');
    expect(midBar).toContain('tempo="70"');
    expect(() => pasteMusicXmlMeasures(midBar, score(midBar), clip, 0, 'replace', 'frets')).toThrow('has a tempo or playback direction inside the bar');
    const dropped = applyMusicXmlScoreSettings(cut.source, score(cut.source), { title: 'Dropped', tempo: 96, tuning: [62, 59, 55, 48, 67], mode: 'pitches' }).source;
    expect(frets(pasteMusicXmlMeasures(dropped, score(dropped), clip, 0, 'replace', 'pitches'), 0)).toEqual(['2', '0', '2', '4', '6', '6', '0']);
  });
});

describe('ED-20 copy and paste whole measures', () => {
  const score = (source: string) => readMusicXml(source, 'paste.musicxml').score;
  const single = rich.replace('<staff-details number="2"><staff-tuning line="1"><tuning-step>A</tuning-step><tuning-octave>4</tuning-octave></staff-tuning></staff-details>', '');
  const measureNotes = (source: string, index: number, staff = '2') => Array.from(new DOMParser().parseFromString(source, 'application/xml')
    .getElementsByTagName('measure')[index].getElementsByTagName('note')).filter(note => note.getElementsByTagName('staff')[0]?.textContent === staff);
  const frets = (source: string, index: number) => measureNotes(source, index).filter(note => note.getElementsByTagName('fret').length)
    .map(note => note.getElementsByTagName('fret')[0].textContent);

  it('copies whole measures with their timing and tuning, excluding edge-crossing spans and repeats', () => {
    const clip = copyMusicXmlMeasures(rich, score(rich), 0, 0);
    expect(clip).toMatchObject({ title: 'Rich editor exercise', meters: ['4/4'], staves: [1, 2], tabStaff: 2, tuning: [62, 59, 55, 50, 67] });
    expect(clip.excluded).toEqual(['a tie that crosses the passage edge', 'repeat barlines']);
    expect(clip.measures).toHaveLength(1);
    expect(clip.measures[0]).toContain('<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>');
    expect(clip.measures[0]).not.toContain('<tied type="start"/>');
    expect(clip.measures[0]).not.toContain('<repeat');
    expect(clip.measures[0]).toContain('<hammer-on type="start">H</hammer-on>');
    const both = copyMusicXmlMeasures(rich, score(rich), 0, 1);
    expect(both.meters).toEqual(['4/4', '3/4']);
    expect(both.excluded).toContain('tuning changes (the destination tuning is used)');
    expect(both.excluded).not.toContain('a tie that crosses the passage edge');
    expect(() => copyMusicXmlMeasures(rich, score(rich), 1, 0)).toThrow('Select whole measures to copy.');
  });

  it('pastes before a measure as new identities, restating the destination timing and keeping internal spans', () => {
    const clip = copyMusicXmlMeasures(rich, score(rich), 0, 0);
    expect(() => pasteMusicXmlMeasures(rich, score(rich), clip, 1, 'insert', 'frets'))
      .toThrow('Pasting before measure 2 would split a tie that continues into that measure. Remove it first or paste elsewhere.');
    const pasted = pasteMusicXmlMeasures(rich, score(rich), clip, 0, 'insert', 'frets');
    const after = score(pasted);
    expect(after.masterBars.map(bar => `${bar.timeSignatureNumerator}/${bar.timeSignatureDenominator}`)).toEqual(['4/4', '4/4', '3/4']);
    expect(frets(pasted, 0)).toEqual(frets(rich, 0));
    expect(frets(pasted, 1)).toEqual(frets(rich, 0));
    const first = new DOMParser().parseFromString(pasted, 'application/xml').getElementsByTagName('measure')[0];
    expect(first.getAttribute('number')).toBe('1');
    expect(first.getElementsByTagName('staff-details')).toHaveLength(1);
    expect(first.getElementsByTagName('repeat')).toHaveLength(0);
    expect(after.tracks[0].staves[0].bars[0].voices[1].beats.some(beat => beat.notes.some(note => note.isHammerPullOrigin))).toBe(true);
    expect(after.tracks[0].staves[0].bars[1].voices[1].beats.at(-1)!.notes[0].isTieOrigin).toBe(true);
    const threeFour = copyMusicXmlMeasures(rich, score(rich), 1, 1);
    const tie = fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8');
    expect(() => pasteMusicXmlMeasures(tie, score(tie), threeFour, 0, 'insert', 'frets'))
      .toThrow('The copied measures use staves 1, 2 with tablature on staff 2; this score uses staves 1 with tablature on staff 1.');
    const tieClip = copyMusicXmlMeasures(tie, score(tie), 0, 0);
    const waltz = pasteMusicXmlMeasures(pasted, after, { ...threeFour }, 1, 'insert', 'frets');
    expect(score(waltz).masterBars.map(bar => `${bar.timeSignatureNumerator}/${bar.timeSignatureDenominator}`)).toEqual(['4/4', '3/4', '4/4', '3/4']);
    expect(new DOMParser().parseFromString(waltz, 'application/xml').getElementsByTagName('measure')[2].getElementsByTagName('time')).toHaveLength(1);
    const again = pasteMusicXmlMeasures(tie, score(tie), tieClip, 1, 'insert', 'frets');
    expect(score(again).masterBars).toHaveLength(3);
    expect(() => pasteMusicXmlMeasures(tie, score(tie), { ...tieClip, measures: Array(255).fill(tieClip.measures[0]) }, 0, 'insert', 'frets')).toThrow('256-measure limit');
    expect(() => pasteMusicXmlMeasures(tie, score(tie), { ...tieClip, measures: [] }, 0, 'insert', 'frets')).toThrow('clipboard is empty');
  });

  it('keeps frets or pitches for a destination in another tuning, rejecting impossible frets before pasting', () => {
    const clip = copyMusicXmlMeasures(single, score(single), 0, 0);
    const dropped = applyMusicXmlScoreSettings(single, score(single), { title: 'Dropped', tempo: 96, tuning: [62, 59, 55, 48, 67], mode: 'pitches' }).source;
    const keepFrets = pasteMusicXmlMeasures(dropped, score(dropped), clip, 0, 'insert', 'frets');
    expect(frets(keepFrets, 0)).toEqual(frets(single, 0));
    expect(measureNotes(keepFrets, 0).filter(note => note.getElementsByTagName('fret').length).map(note => `${note.getElementsByTagName('step')[0].textContent}${note.getElementsByTagName('octave')[0].textContent}`))
      .toEqual(['C3', 'G3', 'C3', 'D3', 'E3', 'E3', 'G3']);
    expect(() => score(keepFrets)).not.toThrow();
    const keepPitches = pasteMusicXmlMeasures(dropped, score(dropped), clip, 0, 'insert', 'pitches');
    expect(frets(keepPitches, 0)).toEqual(['2', '0', '2', '4', '6', '6', '0']);
    expect(() => score(keepPitches)).not.toThrow();
    const raised = applyMusicXmlScoreSettings(single, score(single), { title: 'Raised', tempo: 96, tuning: [62, 59, 55, 52, 67], mode: 'frets' }).source;
    expect(() => pasteMusicXmlMeasures(raised, score(raised), clip, 0, 'insert', 'pitches'))
      .toThrow('Copied measure 1, event 1, string 4: keeping its pitch would need fret -2, outside 0–36. Nothing was pasted.');
  });
});
