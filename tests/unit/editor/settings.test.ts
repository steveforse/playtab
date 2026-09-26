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

describe('ED-19 score settings and local tempo', () => {
  const score = (source = rich) => readMusicXml(source, 'rich.musicxml').score;
  const base = { title: 'Rich editor exercise', tempo: 96, tuning: [62, 59, 55, 50, 67], mode: 'frets' as const };
  const tabFrets = (source: string, measure = 0) => Array.from(new DOMParser().parseFromString(source, 'application/xml').getElementsByTagName('measure')[measure]
    .getElementsByTagName('note')).filter(note => note.getElementsByTagName('staff')[0]?.textContent === '2' && note.getElementsByTagName('fret').length)
    .map(note => `${note.getElementsByTagName('string')[0].textContent}:${note.getElementsByTagName('fret')[0].textContent}`);
  const pitches = (source: string, staff: string) => Array.from(new DOMParser().parseFromString(source, 'application/xml').getElementsByTagName('measure')[0]
    .getElementsByTagName('note')).filter(note => note.getElementsByTagName('staff')[0]?.textContent === staff && note.getElementsByTagName('pitch').length)
    .map(note => `${note.getElementsByTagName('step')[0].textContent}${note.getElementsByTagName('alter')[0]?.textContent === '1' ? '#' : ''}${note.getElementsByTagName('octave')[0].textContent}`);

  it('reads the current settings and changes only the title and opening tempo when asked', () => {
    expect(inspectMusicXmlScoreSettings(rich, score())).toEqual({ ...base, mode: undefined, tuningRange: { first: 1, last: 1 },
      capo: 0, fifthCapo: null, subtitle: '', composer: '', arranger: '', keyFifths: expect.any(Number), feel: 'straight' });
    expect(applyMusicXmlScoreSettings(rich, score(), base).source).toBe(new XMLSerializer().serializeToString(new DOMParser().parseFromString(rich, 'application/xml')));
    const titled = applyMusicXmlScoreSettings(rich, score(), { ...base, title: '  Wellerman practice ' }).source;
    expect(readMusicXml(titled, 'rich.musicxml').score.title.replaceAll('\u00a0', ' ')).toBe('Wellerman practice');
    expect(titled).toContain('<work-title>Wellerman practice</work-title>');
    const faster = applyMusicXmlScoreSettings(rich, score(), { ...base, tempo: 120 }).source;
    expect(faster).toContain('<sound tempo="120"/>');
    expect(faster).toContain('<sound tempo="108"/>');
    expect(readMusicXml(faster, 'rich.musicxml').score.tempo).toBe(120);
    const tie = fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8');
    const tieScore = readMusicXml(tie, 'tie.musicxml').score;
    const opened = applyMusicXmlScoreSettings(tie, tieScore, { ...inspectMusicXmlScoreSettings(tie, tieScore), tempo: 72, mode: 'frets' }).source;
    expect(opened).toContain('<per-minute>72</per-minute>');
    expect(readMusicXml(opened, 'tie.musicxml').score.tempo).toBe(72);
  });

  it('writes credits, key, feel and a capo with a linked or separate 5th-string capo', () => {
    const credited = applyMusicXmlScoreSettings(rich, score(), { ...base, subtitle: 'Sea shanty', composer: 'Traditional', arranger: ' Playtab ', keyFifths: 2, feel: 'swing' }).source;
    const info = inspectMusicXmlScoreSettings(credited, score(credited));
    expect(info).toMatchObject({ subtitle: 'Sea shanty', composer: 'Traditional', arranger: 'Playtab', keyFifths: 2, feel: 'swing' });
    const imported = readMusicXml(credited, 'rich.musicxml').score;
    expect(imported.subTitle.replaceAll('\u00a0', ' ')).toBe('Sea shanty');
    expect(imported.artist).toBe('Traditional');
    expect(imported.music).toBe('Playtab');
    expect(imported.masterBars.every(bar => bar.tripletFeel === 2)).toBe(true);
    expect(imported.masterBars[0].keySignature).toBe(2);
    const cleared = applyMusicXmlScoreSettings(credited, score(credited), { ...base, subtitle: '', composer: '', arranger: '', feel: 'straight' }).source;
    expect(inspectMusicXmlScoreSettings(cleared, score(cleared))).toMatchObject({ subtitle: '', composer: '', arranger: '', feel: 'straight' });
    expect(cleared).not.toContain('<creator');
    expect(cleared).not.toContain('<swing>');
    const dotted = applyMusicXmlScoreSettings(rich, score(), { ...base, feel: 'dotted' }).source;
    expect(inspectMusicXmlScoreSettings(dotted, score(dotted)).feel).toBe('dotted');

    const capoed = applyMusicXmlScoreSettings(rich, score(), { ...base, capo: 2 }).source;
    expect(capoed).toContain('<capo>2</capo>');
    expect(capoed).not.toContain('playtab-fifth-string-capo');
    expect(inspectMusicXmlScoreSettings(capoed, score(capoed))).toMatchObject({ capo: 2, fifthCapo: 7 });
    const capoScore = readMusicXml(capoed, 'rich.musicxml').score;
    const plain = score();
    const first = (model: typeof plain) => model.tracks[0].staves[0].bars[0].voices.flatMap(voice => voice.beats).find(beat => beat.notes.length)!.notes[0];
    expect(first(capoScore).realValue - first(plain).realValue).toBe(2);
    expect(tabFrets(capoed)).toEqual(tabFrets(rich));
    const spiked = applyMusicXmlScoreSettings(capoed, capoScore, { ...base, capo: 2, fifthCapo: 9 }).source;
    expect(spiked).toContain('<miscellaneous-field name="playtab-fifth-string-capo">9</miscellaneous-field>');
    const spikedScore = readMusicXml(spiked, 'rich.musicxml').score;
    expect(spikedScore.tracks[0].staves[0].tuning[4] - capoScore.tracks[0].staves[0].tuning[4]).toBe(2);
    expect(inspectMusicXmlScoreSettings(spiked, spikedScore)).toMatchObject({ capo: 2, fifthCapo: 9, tuning: [62, 59, 55, 50, 67] });
    const unspiked = applyMusicXmlScoreSettings(spiked, spikedScore, { ...base, capo: 2, fifthCapo: null }).source;
    expect(unspiked).toContain('>none</miscellaneous-field>');
    expect(readMusicXml(unspiked, 'rich.musicxml').score.tracks[0].staves[0].tuning[4] - capoScore.tracks[0].staves[0].tuning[4]).toBe(-2);
    // Moving the capo alone brings the spike back to capo + 5.
    const moved = applyMusicXmlScoreSettings(unspiked, readMusicXml(unspiked, 'rich.musicxml').score, { ...base, capo: 4 }).source;
    expect(inspectMusicXmlScoreSettings(moved, score(moved))).toMatchObject({ capo: 4, fifthCapo: 9 });
    expect(moved).not.toContain('playtab-fifth-string-capo');
    const removed = applyMusicXmlScoreSettings(moved, score(moved), { ...base, capo: 0 }).source;
    expect(removed).not.toContain('<capo>');
    expect(inspectMusicXmlScoreSettings(removed, score(removed))).toMatchObject({ capo: 0, fifthCapo: null });

    // A text-only "Capo 3" from an import reads as the capo and becomes a real one on apply.
    const legacy = rich.replace(/(<measure number="1"[^>]*>)/, '$1<direction placement="above"><direction-type><words>Capo 3</words></direction-type><staff>1</staff></direction>');
    expect(inspectMusicXmlScoreSettings(legacy, score(legacy))).toMatchObject({ capo: 3, fifthCapo: 8 });
    const converted = applyMusicXmlScoreSettings(legacy, score(legacy), { ...base, capo: 3 }).source;
    expect(converted).toContain('<capo>3</capo>');
    expect(converted).not.toContain('Capo 3');
  });

  it('rejects invalid capo, key and credit values', () => {
    for (const [change, message] of [[{ capo: 13 }, 'Capo must be a fret from 0 to 12'], [{ capo: 1.5 }, 'Capo must be a fret'],
      [{ fifthCapo: 5 }, '5th-string capo must be at a fret from 6 to 17'], [{ keyFifths: 8 }, 'Choose a key signature'],
      [{ composer: 'x'.repeat(161) }, 'Composer must be at most 160 characters']] as const) {
      expect(() => applyMusicXmlScoreSettings(rich, score(), { ...base, ...change } as typeof base)).toThrow(message);
    }
  });

  it('rejects invalid settings before any change', () => {
    for (const [change, message] of [[{ title: ' ' }, 'Title must be 1–160'], [{ title: 'x'.repeat(161) }, 'Title must be 1–160'],
      [{ tempo: 29 }, 'from 30 to 240 BPM'], [{ tempo: 120.5 }, 'from 30 to 240 BPM'], [{ tuning: [62, 59, 55, 50] }, 'a note from C2 to C7'],
      [{ tuning: [62, 59, 55, 50, 97] }, 'a note from C2 to C7'], [{ mode: 'strings' }, 'Keep frets or Keep pitches']] as const) {
      expect(() => applyMusicXmlScoreSettings(rich, score(), { ...base, ...change } as typeof base)).toThrow(message);
    }
  });

  it('keeps frets or keeps pitches across the tuning range as one transaction', () => {
    const single = rich.replace('<staff-details number="2"><staff-tuning line="1"><tuning-step>A</tuning-step><tuning-octave>4</tuning-octave></staff-tuning></staff-details>', '');
    expect(single).not.toBe(rich);
    const frets = applyMusicXmlScoreSettings(single, score(single), { ...base, tuning: [62, 59, 57, 48, 67] });
    expect(frets.tuningRange).toEqual({ first: 1, last: 2 });
    expect(tabFrets(frets.source)).toEqual(tabFrets(single));
    expect(pitches(frets.source, '2')).toEqual(['C3', 'A3', 'C3', 'D3', 'E3', 'E3', 'A3']);
    expect(pitches(frets.source, '1')).toEqual(['C3', 'A3', 'C3', 'D3', 'E3', 'E3', 'A3']);
    const fretScore = readMusicXml(frets.source, 'rich.musicxml').score;
    expect(fretScore.tracks[0].staves[0].tuning).toEqual([62, 59, 57, 48, 67]);
    expect(fretScore.tracks[0].staves[0].bars[1].voices[1].beats[0].notes[0].isTieDestination).toBe(true);
    const pitch = applyMusicXmlScoreSettings(single, score(single), { ...base, tuning: [62, 59, 55, 48, 67], mode: 'pitches' });
    expect(tabFrets(pitch.source)).toEqual(['4:2', '3:0', '4:2', '4:4', '4:6', '4:6', '3:0']);
    expect(tabFrets(pitch.source, 1)).toEqual(['4:6', '4:4', '3:0']);
    expect(pitches(pitch.source, '2')).toEqual(pitches(single, '2'));
    expect(readMusicXml(pitch.source, 'rich.musicxml').score.tracks[0].staves[0].tuning).toEqual([62, 59, 55, 48, 67]);
    expect(() => applyMusicXmlScoreSettings(single, score(single), { ...base, tuning: [62, 59, 55, 60, 67], mode: 'pitches' }))
      .toThrow('Measure 1, event 1, string 4: keeping its pitch would need fret -10, outside 0–36. No tuning change was applied.');
  });

  it('respects a later tuning change and rejects changes the one-tuning preview cannot play', () => {
    const fifth = applyMusicXmlScoreSettings(rich, score(), { ...base, tuning: [62, 59, 55, 50, 66] });
    expect(fifth.tuningRange).toEqual({ first: 1, last: 1 });
    const measures = new DOMParser().parseFromString(fifth.source, 'application/xml').getElementsByTagName('measure');
    const lines = (index: number) => Array.from(measures[index].getElementsByTagName('staff-tuning')).map(item => `${item.getAttribute('line')}:${item.getElementsByTagName('tuning-step')[0].textContent}${item.getElementsByTagName('tuning-alter')[0]?.textContent === '1' ? '#' : ''}${item.getElementsByTagName('tuning-octave')[0].textContent}`);
    expect(lines(0)).toEqual(['1:F#4', '2:D3', '3:G3', '4:B3', '5:D4']);
    expect(lines(1)).toEqual(['1:A4', '2:D3', '3:G3', '4:B3', '5:D4']);
    expect(() => readMusicXml(fifth.source, 'rich.musicxml')).not.toThrow();
    expect(() => applyMusicXmlScoreSettings(rich, score(), { ...base, tuning: [62, 59, 55, 48, 67] }))
      .toThrow('Measure 1, event 5, string 4: its tie continues past the tuning range');
    expect(() => applyMusicXmlScoreSettings(rich, score(), { ...base, tuning: [62, 59, 57, 50, 67] }))
      .toThrow('Measure 1, event 1, string 3: this score changes tuning again at measure 2, and the preview plays one tuning per staff');
  });

  it('sets and removes a local tempo at the selected event without touching other tempos', () => {
    const m2e2 = { measure: 1, beat: 1, voice: 1 };
    expect(inspectMusicXmlTempo(rich, score(), m2e2)).toEqual({ local: null, inherited: 108, opening: false });
    expect(inspectMusicXmlTempo(rich, score(), { measure: 1, beat: 0, voice: 1 })).toEqual({ local: 108, inherited: 96, opening: false });
    expect(inspectMusicXmlTempo(rich, score(), { measure: 0, beat: 1, voice: 1 })).toMatchObject({ local: 96, opening: true });
    const slower = setMusicXmlLocalTempo(rich, score(), m2e2, 80);
    const slowScore = readMusicXml(slower, 'rich.musicxml').score;
    expect(slowScore.masterBars[1].tempoAutomations.map(item => item.value)).toEqual([108, 80]);
    expect(inspectMusicXmlTempo(slower, slowScore, m2e2)).toEqual({ local: 80, inherited: 108, opening: false });
    const changed = setMusicXmlLocalTempo(slower, slowScore, m2e2, 90);
    expect(changed.match(/tempo="90"/g)).toHaveLength(1);
    expect(setMusicXmlLocalTempo(changed, score(changed), m2e2, null)).toBe(new XMLSerializer().serializeToString(new DOMParser().parseFromString(rich, 'application/xml')));
    const noSection = setMusicXmlLocalTempo(rich, score(), { measure: 1, beat: 0, voice: 1 }, null);
    expect(noSection).toContain('<words>Section B</words>');
    expect(noSection).not.toContain('108');
    expect(setMusicXmlLocalTempo(noSection, score(noSection), { measure: 1, beat: 0, voice: 1 }, null)).toBe(noSection);
    expect(() => setMusicXmlLocalTempo(rich, score(), { measure: 0, beat: 1, voice: 1 }, 100)).toThrow('Change it in Score settings');
    expect(() => setMusicXmlLocalTempo(rich, score(), m2e2, 241)).toThrow('from 30 to 240 BPM');
    const soundOnly = rich.replace('<direction><direction-type><words>Section B</words></direction-type><sound tempo="108"/></direction>',
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>108</per-minute></metronome></direction-type><sound tempo="108" dynamics="80"/></direction>');
    expect(soundOnly).toContain('dynamics="80"');
    expect(setMusicXmlLocalTempo(soundOnly, score(soundOnly), { measure: 1, beat: 0, voice: 1 }, null))
      .toContain('<direction><direction-type><words/></direction-type><sound dynamics="80"/></direction>');
  });
});
