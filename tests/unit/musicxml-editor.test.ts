import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { readMusicXml } from '../../app/frontend/music/musicxml';
import { applyMusicXmlEdits, musicXmlEditorState, replaceTechnique } from '../../app/frontend/music/musicxml-editor';

vi.stubGlobal('DOMParser', DOMParser);
vi.stubGlobal('XMLSerializer', XMLSerializer);

describe('MusicXML score editing', () => {
  it('extracts editable notes and rich source metadata, then writes edits back', () => {
    const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8')
      .replace('<part-list>', '<identification><miscellaneous><miscellaneous-field name="playtab-lyrics">LYRICS &amp; CHORDS\n\nVERSE\nThere once was a ship</miscellaneous-field></miscellaneous></identification><part-list>')
      .replace('</attributes>', '</attributes><direction><direction-type><words>Low solo</words></direction-type></direction><harmony><root><root-step>C</root-step></root><kind>minor</kind></harmony>');
    const preview = readMusicXml(source, 'edit.xml');
    const state = musicXmlEditorState(preview.source, preview.score);
    expect(state).toMatchObject({ title: 'Technique exercise', measureCount: 1, tempo: 120, lyricsSection: 'VERSE\nThere once was a ship', annotations: ['Low solo'], chords: ['Cm'] });
    expect(musicXmlEditorState(preview.source.replace('LYRICS &amp; CHORDS', 'CHORDS &amp; LYRICS'), preview.score).lyricsSection).toBe('VERSE\nThere once was a ship');
    expect(state.notes.map(note => [note.string, note.fret, note.technique])).toEqual([
      [4, 0, 'hammer-on-start'], [4, 3, 'hammer-on-stop'], [4, 3, 'pull-off-start'], [4, 0, 'pull-off-stop'],
    ]);

    const edited = applyMusicXmlEdits(preview.source, {
      ...state, title: 'Edited technique exercise', tempo: 120, tuning: [65, 60, 55, 50, 69],
      lyricsSection: 'VERSE\nEdited words', annotations: ['Edited section'], chords: ['Dm'],
      notes: state.notes.map((note, index) => index === 0 ? { ...note, fret: 2, technique: 'finger-3' as const } : index === 1 ? { ...note, technique: 'none' as const } : note),
    });
    expect(edited).toContain('Edited words');
    expect(edited).toContain('<tuning-step>A</tuning-step>');
    const next = readMusicXml(edited, 'edit.xml');
    expect(next.score.title.replaceAll('\u00a0', ' ')).toBe('Edited technique exercise');
    expect(next.score.tempo).toBe(120);
    expect(next.score.tracks[0].staves[0].tuning).toEqual([65, 60, 55, 50, 69]);
    expect(next.score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].fret).toBe(2);
    expect(next.score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].leftHandFinger).toBe(3);

    const thumbAndEffects = applyMusicXmlEdits(preview.source, {
      ...state,
      notes: [...state.notes.map((note, index) => index === 0 ? { ...note, technique: 'thumb' as const } : index === 1 ? { ...note, technique: 'none' as const } : index === 2 ? { ...note, technique: 'slide' as const } : { ...note, technique: 'bend' as const }), { index: 99, measure: 0, beat: 0, string: 1, fret: 0, technique: 'keep' as const }],
      annotations: [], chords: ['???', 'C7'],
    });
    expect(thumbAndEffects).toContain('TEF fingering T');
    expect(thumbAndEffects).toContain('<slide/>');
    expect(thumbAndEffects).toContain('<bend/>');
    const addedMetadata = applyMusicXmlEdits(preview.source, { ...state, annotations: ['First', 'Second'], chords: ['C', 'D'] });
    expect(addedMetadata).toContain('<words>Second</words>');
    expect(addedMetadata.match(/<harmony>/g)).toHaveLength(2);
    expect(applyMusicXmlEdits(preview.source, { ...state, annotations: [], chords: [] })).not.toContain('<harmony>');
    const emptyNoteDocument = new DOMParser().parseFromString('<note/>', 'application/xml');
    replaceTechnique(emptyNoteDocument.documentElement! as unknown as Element, 'thumb');
    replaceTechnique(emptyNoteDocument.documentElement! as unknown as Element, 'slide');
    expect(new XMLSerializer().serializeToString(emptyNoteDocument)).toContain('<technical>');
    expect(applyMusicXmlEdits(preview.source, { ...state, chords: ['C#7'] })).toContain('<root-alter>1</root-alter>');

    const noEffect = source.replace('<hammer-on type="start">H</hammer-on>', '');
    const unknownEffect = source.replace('<hammer-on type="start">H</hammer-on>', '<tap/>');
    const slideSource = source.replace('<hammer-on type="start">H</hammer-on>', '<slide/>');
    const bendSource = source.replace('<hammer-on type="start">H</hammer-on>', '<bend/>');
    expect(musicXmlEditorState(noEffect, preview.score).notes[0].technique).toBe('none');
    expect(musicXmlEditorState(unknownEffect, preview.score).notes[0].technique).toBe('keep');
    expect(musicXmlEditorState(slideSource, preview.score).notes[0].technique).toBe('slide');
    expect(musicXmlEditorState(bendSource, preview.score).notes[0].technique).toBe('bend');
    expect(musicXmlEditorState(source.replace('<hammer-on type="start">H</hammer-on>', '<fingering>3</fingering>'), preview.score).notes[0].technique).toBe('finger-3');
    expect(musicXmlEditorState(source.replace('<hammer-on type="start">H</hammer-on>', '<other-technical>TEF fingering Thumb</other-technical>'), preview.score).notes[0].technique).toBe('thumb');
    expect(() => musicXmlEditorState('<bad/>', preview.score)).toThrow('Invalid MusicXML');

    const directTechnical = source.replace('<notations><technical>', '<technical>').replace('</technical></notations>', '</technical>');
    const directState = musicXmlEditorState(directTechnical, preview.score);
    expect(directState.notes).toHaveLength(4);
    const directEdited = applyMusicXmlEdits(directTechnical, { ...directState, notes: directState.notes.map((note, index) => index === 0 ? { ...note, technique: 'keep' as const } : { ...note, technique: 'none' as const }) });
    expect(directEdited).toContain('<notations><technical>');

    const deleted = applyMusicXmlEdits(preview.source, { ...state, notes: state.notes.map((note, index) => index === 0 ? { ...note, deleted: true } : note) });
    const deletedPreview = readMusicXml(deleted, 'edit.xml');
    expect(deletedPreview.score.tracks[0].staves[0].bars[0].voices[0].beats.flatMap(beat => beat.notes)).toHaveLength(3);
  });

  it('can remove and add imported measures and lyrics metadata', () => {
    const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8');
    const preview = readMusicXml(source, 'edit.xml');
    const state = musicXmlEditorState(preview.source, preview.score);
    const expanded = applyMusicXmlEdits(source, { ...state, measureCount: 2, lyricsSection: 'A lyric' });
    expect(readMusicXml(expanded, 'edit.xml').score.masterBars).toHaveLength(2);
    const reduced = applyMusicXmlEdits(expanded, { ...musicXmlEditorState(expanded, readMusicXml(expanded, 'edit.xml').score), measureCount: 1, lyricsSection: '' });
    expect(readMusicXml(reduced, 'edit.xml').score.masterBars).toHaveLength(1);
    expect(reduced).not.toContain('playtab-lyrics');

    const noMeasures = '<score-partwise><part id="P1"/></score-partwise>';
    expect(applyMusicXmlEdits(noMeasures, { ...state, tuning: [], notes: [], measureCount: 2 })).toContain('<part id="P1"/>');
    expect(() => applyMusicXmlEdits('<score-partwise/>', { ...state, annotations: ['Extra section'], chords: ['C'], notes: [], measureCount: 1 })).not.toThrow();
    expect(applyMusicXmlEdits('<score-partwise><part id="P1"><measure number="1"/></part></score-partwise>', { ...state, annotations: [], chords: [], notes: [], measureCount: 2 })).toContain('<duration>4</duration>');
    expect(applyMusicXmlEdits(source.replace('</work>', '</work><movement-title>Old title</movement-title>'), state)).toContain('<movement-title>Technique exercise</movement-title>');
  });
});
