import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { promoteNativeScore, readMusicXml } from '../../app/frontend/music/musicxml';
import { OPEN_G, type Score } from '../../app/frontend/music/score';
import { addMusicXmlNote, applyMusicXmlEdits, musicXmlEditorState, removeMusicXmlNotes, replaceTechnique } from '../../app/frontend/music/musicxml-editor';

vi.stubGlobal('DOMParser', DOMParser);
vi.stubGlobal('XMLSerializer', XMLSerializer);

describe('MusicXML score editing', () => {
  it.skipIf(!process.env.PLAYTAB_STORED_WELLERMAN)('prepares a saved Wellerman chord removal without changing the stored source', () => {
    const saved = JSON.parse(execFileSync('docker', ['compose', '-f', 'compose.yml', 'exec', '-T', 'web', 'bin/rails', 'runner',
      'print Song.where("title ILIKE ?", "%Wellerman%").first.score.to_json'], { encoding: 'utf8' }));
    const source = saved.source as string;
    const preview = readMusicXml(source, 'wellerman.musicxml', 'tef');
    const candidate = preview.score.tracks[0].staves[0].bars.flatMap((bar, measure) => bar.voices.flatMap((voice, voiceIndex) => voice.beats
      .map((beat, event) => ({ beat, measure, voice: voiceIndex, event }))))
      .find(item => item.beat.notes.length >= 2 && !item.beat.graceType)!;
    expect(candidate).toBeTruthy();
    const string = 6 - candidate.beat.notes[0].string;
    const planned = removeMusicXmlNotes(source, preview.score, { measure: candidate.measure, beat: candidate.event, voice: candidate.voice, string })!;
    expect(planned).toBeTruthy();
    expect(source).toBe(saved.source);
    const after = readMusicXml(planned.source, 'wellerman.musicxml', 'tef');
    const next = after.score.tracks[0].staves[0].bars[candidate.measure].voices[candidate.voice].beats[candidate.event];
    expect(next.notes.length).toBe(candidate.beat.notes.length - 1);
    expect(next.playbackStart).toBe(candidate.beat.playbackStart);
  }, 60000);

  it('removes one paired chord member or makes the whole event a rest without shifting later music', () => {
    const source = fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8');
    const preview = readMusicXml(source, 'paired.musicxml', 'tef');
    const before = preview.score.tracks[0].staves[0].bars[0].voices[1].beats.map(beat => beat.playbackStart);
    const one = removeMusicXmlNotes(source, preview.score, { measure: 0, beat: 0, voice: 1, string: 3 })!;
    expect(one.dependencies).toEqual([]);
    const afterOne = readMusicXml(one.source, 'paired.musicxml', 'tef').score.tracks[0].staves[0].bars[0].voices[1].beats;
    expect(afterOne[0].notes.map(note => 6 - note.string)).toEqual([1]);
    expect(afterOne.map(beat => beat.playbackStart)).toEqual(before);

    const whole = removeMusicXmlNotes(source, preview.score, { measure: 0, beat: 0, voice: 1 })!;
    expect(whole.dependencies).toEqual([]);
    const afterWhole = readMusicXml(whole.source, 'paired.musicxml', 'tef').score.tracks[0].staves[0].bars[0].voices[1].beats;
    expect(afterWhole[0].isRest).toBe(true);
    expect(afterWhole.map(beat => beat.playbackStart)).toEqual(before);
    expect(removeMusicXmlNotes(whole.source, readMusicXml(whole.source, 'paired.musicxml', 'tef').score, { measure: 0, beat: 0, voice: 1 })).toBeNull();
  });

  it('reports linked techniques and removes their surviving endpoint only after the caller confirms', () => {
    const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8');
    const preview = readMusicXml(source, 'techniques.musicxml');
    const planned = removeMusicXmlNotes(source, preview.score, { measure: 0, beat: 0, voice: 0, string: 4 })!;
    expect(planned.dependencies).toContain('hammer-on');
    expect(planned.source).not.toContain('hammer-on');
    expect(source).toContain('hammer-on');
    const after = readMusicXml(planned.source, 'techniques.musicxml');
    expect(after.score.tracks[0].staves[0].bars[0].voices[0].beats[0].isRest).toBe(true);
  });

  it('disconnects known tie and slide endpoints when their source note is removed', () => {
    const source = fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8');
    const preview = readMusicXml(source, 'paired.musicxml', 'tef');
    const tab = '<string>3</string><fret>0</fret></technical></notations>';
    const tiedStart = '<string>3</string><fret>0</fret></technical><tied type="start"/></notations>';
    const tiedStop = '<string>3</string><fret>0</fret></technical><tied type="stop"/></notations>';
    const withTie = source.replace(tab, tiedStart).replace(tab, tiedStop);
    const plannedTie = removeMusicXmlNotes(withTie, preview.score, { measure: 0, beat: 0, voice: 1, string: 3 })!;
    expect(plannedTie.dependencies).toContain('tie');
    expect(plannedTie.source).not.toContain('<tied');

    const slideStart = '<string>3</string><fret>0</fret><slide number="1" type="start"/></technical></notations>';
    const slideStop = '<string>3</string><fret>0</fret><slide number="1" type="stop"/></technical></notations>';
    const withSlide = source.replace(tab, slideStart).replace(tab, slideStop);
    const plannedSlide = removeMusicXmlNotes(withSlide, preview.score, { measure: 0, beat: 0, voice: 1, string: 3 })!;
    expect(plannedSlide.dependencies).toContain('slide');
    expect(plannedSlide.source).not.toContain('<slide');
    expect(readMusicXml(plannedSlide.source, 'paired.musicxml', 'tef').score.tracks[0].staves[0].bars[0].voices[1].beats[0].notes).toHaveLength(1);

    const standard = '<note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>';
    const withStandardTie = source.replace(standard, standard.replace('<voice>', '<tie type="start"/><voice>'))
      .replace(standard, standard.replace('<voice>', '<tie type="stop"/><voice>'));
    const plannedStandardTie = removeMusicXmlNotes(withStandardTie, preview.score, { measure: 0, beat: 0, voice: 1, string: 3 })!;
    expect(plannedStandardTie.dependencies).toContain('tie');
    expect(plannedStandardTie.source).not.toContain('<tie');
  });

  it('removes a preceding grace group with its destination event and blocks unknown attachments', () => {
    const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8');
    const grace = '<note><grace slash="yes"/><pitch><step>C</step><octave>3</octave></pitch><type>16th</type><notations><technical><string>4</string><fret>0</fret></technical></notations></note>';
    const withGrace = source.replace('    <note><pitch><step>C</step><octave>3</octave></pitch>', `    ${grace}\n    <note><pitch><step>C</step><octave>3</octave></pitch>`);
    const preview = readMusicXml(withGrace, 'grace.musicxml');
    const planned = removeMusicXmlNotes(withGrace, preview.score, { measure: 0, beat: 1, voice: 0 })!;
    expect(planned.dependencies).toContain('1 grace note');
    expect(planned.source).not.toContain('<grace');
    expect(readMusicXml(planned.source, 'grace.musicxml').score.tracks[0].staves[0].bars[0].voices[0].beats[0].isRest).toBe(true);

    const protectedSource = source.replace('<hammer-on type="start">H</hammer-on>', '<tap/>').replace('<hammer-on type="stop"/>', '');
    const protectedPreview = readMusicXml(protectedSource, 'unknown.musicxml');
    expect(() => removeMusicXmlNotes(protectedSource, protectedPreview.score, { measure: 0, beat: 0, voice: 0 }))
      .toThrow('protected tap attachment');
  });

  it.skipIf(!process.env.PLAYTAB_STORED_WELLERMAN)('preserves every local Wellerman three-note chord through two-digit entry', () => {
    const saved = JSON.parse(execFileSync('docker', ['compose', '-f', 'compose.yml', 'exec', '-T', 'web', 'bin/rails', 'runner',
      'print Song.where("title ILIKE ?", "%Wellerman%").first.score.to_json'], { encoding: 'utf8' }));
    const source = saved.source as string;
    const preview = readMusicXml(source, 'wellerman.musicxml', 'tef');
    const targets = preview.score.tracks[0].staves[0].bars.flatMap((bar, measure) => bar.voices.flatMap((voice, voiceIndex) => voice.beats
      .map((beat, event) => ({ beat, measure, voice: voiceIndex, event }))))
      .filter(item => item.beat.notes.map(note => 6 - note.string).sort().join(',') === '1,2,3');
    expect(targets.length).toBeGreaterThan(0);
    targets.forEach(({ beat, measure, voice, event }) => {
      const withOne = addMusicXmlNote(source, preview.score, { measure, beat: event, voice, string: 4, fret: 1 });
      const parsed = readMusicXml(withOne, 'wellerman.musicxml', 'tef');
      const state = musicXmlEditorState(withOne, parsed.score);
      const added = state.notes.find(note => note.measure === measure && note.beat === event && note.string === 4);
      expect(added, `measure ${measure + 1}, event ${event + 1}`).toBeTruthy();
      added!.fret = 12;
      const withTwelve = applyMusicXmlEdits(withOne, state, [added!.index]);
      const result = readMusicXml(withTwelve, 'wellerman.musicxml', 'tef');
      const notes = result.score.tracks[0].staves[0].bars[measure].voices[voice].beats[event].notes;
      expect(notes.map(note => [6 - note.string, note.fret]).sort((a, b) => a[0] - b[0]), `measure ${measure + 1}, event ${event + 1}`)
        .toEqual([...beat.notes.map(note => [6 - note.string, note.fret]), [4, 12]].sort((a, b) => a[0] - b[0]));
    });
  }, 60000);
  it.skipIf(!process.env.PLAYTAB_EDITOR_XML)('adds to a private imported chord without publishing the score', () => {
    const source = fs.readFileSync(process.env.PLAYTAB_EDITOR_XML!, 'utf8');
    const preview = readMusicXml(source, 'private.musicxml', 'tef');
    const bars = preview.score.tracks[0].staves[0].bars;
    const target = bars.flatMap((bar, measure) => bar.voices.flatMap((voice, voiceIndex) => voice.beats.map((beat, event) => ({ beat, measure, voice: voiceIndex, event }))))
      .find(item => item.beat.notes.length > 1 && item.beat.notes.length < 5 && !item.beat.graceType)!;
    expect(target).toBeTruthy();
    const occupied = new Set(target.beat.notes.map(note => 6 - note.string));
    const string = [1, 2, 3, 4, 5].find(value => !occupied.has(value))!;
    const edited = addMusicXmlNote(source, preview.score, { measure: target.measure, beat: target.event, voice: target.voice, string, fret: 0 });
    const next = readMusicXml(edited, 'private.musicxml', 'tef');
    const notes = next.score.tracks[0].staves[0].bars[target.measure].voices[target.voice].beats[target.event].notes;
    expect(notes).toHaveLength(target.beat.notes.length + 1);
    expect(notes.some(note => 6 - note.string === string && note.fret === 0)).toBe(true);
  });
  it('adds a chord member and replaces a paired rest without moving later events', () => {
    const source = fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8');
    const preview = readMusicXml(source, 'paired.musicxml', 'tef');
    const original = preview.score.tracks[0].staves[0].bars[0].voices[1].beats;
    const chord = addMusicXmlNote(source, preview.score, { measure: 0, beat: 0, voice: 1, string: 2, fret: 1 });
    const afterChord = readMusicXml(chord, 'paired.musicxml', 'tef');
    const beats = afterChord.score.tracks[0].staves[0].bars[0].voices[1].beats;
    expect(beats[0].notes.map(note => [note.string, note.fret]).sort((a, b) => a[0] - b[0])).toEqual([[3, 0], [4, 1], [5, 0]]);
    expect(beats.map(beat => beat.playbackStart)).toEqual(original.map(beat => beat.playbackStart));
    expect(() => addMusicXmlNote(chord, afterChord.score, { measure: 0, beat: 0, voice: 1, string: 2, fret: 1 })).toThrow('already has a note');

    const filled = addMusicXmlNote(chord, afterChord.score, { measure: 0, beat: 2, voice: 1, string: 4, fret: 0 });
    const afterRest = readMusicXml(filled, 'paired.musicxml', 'tef');
    const filledBeats = afterRest.score.tracks[0].staves[0].bars[0].voices[1].beats;
    expect(filledBeats[2].notes.map(note => [note.string, note.fret])).toEqual([[2, 0]]);
    expect(filledBeats.map(beat => beat.playbackStart)).toEqual(original.map(beat => beat.playbackStart));
    expect(filled).not.toContain('<rest/>');
  });
  it('updates both representations by musical identity and preserves unrelated source notes', () => {
    const source = fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8');
    const preview = readMusicXml(source, 'paired.musicxml', 'tef');
    const state = musicXmlEditorState(source, preview.score);
    const target = state.notes.find(note => note.beat === 0 && note.string === 3)!;
    target.fret = 2;
    const edited = applyMusicXmlEdits(source, state, [target.index]);
    const next = readMusicXml(edited, 'paired.musicxml', 'tef');
    const beats = next.score.tracks[0].staves[0].bars[0].voices.find(voice => voice.beats.some(beat => beat.notes.length))!.beats;
    expect(beats[0].notes.map(note => [note.string, note.fret])).toEqual([[5, 0], [3, 2]]);
    expect(beats[1].notes[0].fret).toBe(0);
    const document = new DOMParser().parseFromString(edited, 'application/xml');
    const notes = Array.from(document.getElementsByTagName('note'));
    expect(notes[0].getElementsByTagName('step')[0].textContent).toBe('A');
    expect(notes[1].getElementsByTagName('step')[0].textContent).toBe('D');
    expect(notes[2].getElementsByTagName('step')[0].textContent).toBe('G');
    const deletion = musicXmlEditorState(edited, next.score);
    const deleted = deletion.notes.find(note => note.beat === 0 && note.string === 3)!;
    deleted.deleted = true;
    const afterDelete = readMusicXml(applyMusicXmlEdits(edited, deletion, [deleted.index]), 'paired.musicxml');
    const remaining = afterDelete.score.tracks[0].staves[0].bars[0].voices.find(voice => voice.beats.some(beat => beat.notes.length))!.beats;
    expect(remaining[0].notes).toHaveLength(1);
    expect(remaining[1].playbackStart).toBe(beats[1].playbackStart);
  });

  it('rejects ambiguous paired unisons instead of changing an arbitrary chord member', () => {
    const source = fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8')
      .replaceAll('<step>G</step><octave>3</octave>', '<step>D</step><octave>4</octave>')
      .replaceAll('<string>3</string><fret>0</fret>', '<string>3</string><fret>7</fret>');
    const preview = readMusicXml(source, 'unisons.musicxml');
    const state = musicXmlEditorState(source, preview.score);
    state.notes[0].fret = 1;
    expect(() => applyMusicXmlEdits(source, state, [0])).toThrow('cannot be uniquely matched');
  });

  it('preserves stacked techniques and later timing during a fret change and deletion', () => {
    const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8')
      .replace('<hammer-on type="start">', '<fingering>3</fingering><hammer-on type="start">');
    const preview = readMusicXml(source, 'stacked.xml');
    const state = musicXmlEditorState(source, preview.score);
    state.notes[0].fret = 1;
    const edited = applyMusicXmlEdits(source, state);
    expect(edited).toContain('<fingering>3</fingering><hammer-on type="start">');
    const next = readMusicXml(edited, 'stacked.xml');
    const originalBeats = preview.score.tracks[0].staves[0].bars[0].voices[0].beats;
    expect(next.score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].fret).toBe(1);
    const deletion = musicXmlEditorState(edited, next.score);
    deletion.notes[0].deleted = true;
    const afterDelete = readMusicXml(applyMusicXmlEdits(edited, deletion), 'stacked.xml');
    const beats = afterDelete.score.tracks[0].staves[0].bars[0].voices[0].beats;
    expect(beats[0].isRest).toBe(true);
    expect(beats.map(beat => beat.playbackStart)).toEqual(originalBeats.map(beat => beat.playbackStart));
  });

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
      ...state, origin: undefined,
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
    expect(applyMusicXmlEdits(noMeasures, { ...state, origin: undefined, tuning: [], notes: [], measureCount: 2 })).toContain('<part id="P1"/>');
    expect(() => applyMusicXmlEdits('<score-partwise/>', { ...state, origin: undefined, annotations: ['Extra section'], chords: ['C'], notes: [], measureCount: 1 })).not.toThrow();
    expect(applyMusicXmlEdits('<score-partwise><part id="P1"><measure number="1"/></part></score-partwise>', { ...state, origin: undefined, annotations: [], chords: [], notes: [], measureCount: 2 })).toContain('<duration>4</duration>');
    expect(applyMusicXmlEdits(source.replace('</work>', '</work><movement-title>Old title</movement-title>'), { ...state, origin: undefined })).toContain('<movement-title>Technique exercise</movement-title>');
  });

  it('preserves a no-op source byte for byte and rejects a stale editor draft', () => {
    const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8')
      .replace('</part-list>', '</part-list><credit><credit-words custom="opaque">Do not rewrite</credit-words></credit>');
    const preview = readMusicXml(source, 'source.xml');
    const state = musicXmlEditorState(source, preview.score);
    expect(applyMusicXmlEdits(source, state)).toBe(source);
    const changedSource = source.replace('Do not rewrite', 'Another revision');
    state.notes[0].fret = 1;
    expect(() => applyMusicXmlEdits(changedSource, state, [state.notes[0].index])).toThrow('changed since this edit began');
  });

  it('changes only the selected note and retains unrelated metadata and source spelling', () => {
    const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8')
      .replace('<work-title>Technique exercise</work-title>', '<work-title>Technique exercise</work-title><opaque xmlns="urn:playtab:test" attr="keep"><inner>value</inner></opaque>')
      .replace('<pitch><step>C</step><octave>3</octave></pitch>', '<pitch><step>C</step><alter>0</alter><octave>3</octave></pitch>');
    const preview = readMusicXml(source, 'source.xml');
    const state = musicXmlEditorState(source, preview.score);
    const originalSecond = '<pitch><step>E</step><alter>-1</alter><octave>3</octave></pitch>';
    state.notes[0].fret = 1;
    const edited = applyMusicXmlEdits(source, state, [state.notes[0].index]);
    expect(edited).toContain('<opaque xmlns="urn:playtab:test" attr="keep"><inner>value</inner></opaque>');
    expect(edited).toContain(originalSecond);
    expect(edited).toContain('<work-title>Technique exercise</work-title>');
    expect(readMusicXml(edited, 'source.xml').score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].fret).toBe(1);
  });

  it('maps a chord member by its source identity when XML order differs from rendered order', () => {
    const document = new DOMParser().parseFromString(fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8'), 'application/xml');
    const notes = Array.from(document.getElementsByTagName('note'));
    const firstTab = notes[4];
    const secondTab = notes[5];
    const chordMarker = secondTab.getElementsByTagName('chord')[0];
    secondTab.removeChild(chordMarker);
    firstTab.insertBefore(chordMarker, firstTab.firstChild);
    firstTab.parentNode!.insertBefore(secondTab, firstTab);
    const source = new XMLSerializer().serializeToString(document);
    const preview = readMusicXml(source, 'reordered.xml');
    const state = musicXmlEditorState(source, preview.score);
    const target = state.notes.find(note => note.measure === 0 && note.beat === 0 && note.string === 1)!;
    expect(target).toBeTruthy();
    target.fret = 2;
    const edited = applyMusicXmlEdits(source, state, [target.index]);
    const result = new DOMParser().parseFromString(edited, 'application/xml');
    const tabMembers = Array.from(result.getElementsByTagName('note')).filter(note => note.getElementsByTagName('string').length);
    expect(tabMembers.map(note => [note.getElementsByTagName('string')[0].textContent, note.getElementsByTagName('fret')[0].textContent]).slice(0, 2))
      .toEqual([['3', '0'], ['1', '2']]);
    expect(readMusicXml(edited, 'reordered.xml').score.tracks[0].staves[0].bars[0].voices[1].beats[0].notes.some(note => note.fret === 2 && 6 - note.string === 1)).toBe(true);
  });

  it('promotes a native score without changing fret convention, rhythm, rests or metadata', () => {
    const native: Score = { version: 1, title: 'A & B <banjo>', tempo: 112, tuning: OPEN_G,
      fretConvention: 'relative-to-string-nut', measures: [{ beats: [
        { duration: 4, notes: [{ string: 5, fret: 0 }, { string: 1, fret: 2 }] },
        { duration: 4, notes: [] },
        { duration: 4, notes: [{ string: 4, fret: 3 }] },
        { duration: 4, notes: [] },
      ] }] };
    const source = promoteNativeScore(native);
    expect(source).toContain('A &amp; B &lt;banjo&gt;');
    const preview = readMusicXml(source, 'promoted.musicxml');
    expect(preview.score.title.replaceAll('\u00a0', ' ')).toBe(native.title);
    expect(preview.score.tempo).toBe(112);
    expect(preview.score.tracks[0].staves[0].tuning).toEqual(OPEN_G);
    const beats = preview.score.tracks[0].staves[0].bars[0].voices[0].beats;
    expect(beats.map(beat => beat.playbackStart)).toEqual([0, 960, 1920, 2880]);
    expect(beats.map(beat => beat.isRest)).toEqual([false, true, false, true]);
    expect(beats[0].notes.map(note => [6 - note.string, note.fret, note.realValue]).sort((a, b) => a[0] - b[0]))
      .toEqual([[1, 2, OPEN_G[0] + 2], [5, 0, OPEN_G[4]]]);
    const state = musicXmlEditorState(source, preview.score);
    const highFret = state.notes.find(note => note.string === 1)!;
    highFret.fret = 28;
    const edited = readMusicXml(applyMusicXmlEdits(source, state, [highFret.index]), 'promoted.musicxml');
    expect(edited.score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes.find(note => 6 - note.string === 1)?.fret).toBe(28);
  });

  it('keeps an unsupported source subtree and overfull timing through an isolated fret correction', () => {
    const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8')
      .replace('<score-partwise version="4.0">', '<score-partwise version="4.0" xmlns:custom="urn:playtab:opaque">')
      .replace('<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><notations><technical><string>4</string><fret>0</fret><pull-off type="stop"/>',
        '<note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><type>half</type><notations><technical><string>4</string><fret>0</fret><pull-off type="stop"/>')
      .replace('<pull-off type="stop"/>', '<pull-off type="stop"/><custom:opaque data="retain"><custom:nested>yes</custom:nested></custom:opaque>');
    const preview = readMusicXml(source, 'imperfect.xml');
    const state = musicXmlEditorState(source, preview.score);
    const first = state.notes.find(note => note.beat === 0 && note.string === 4)!;
    first.fret = 1;
    const edited = applyMusicXmlEdits(source, state, [first.index]);
    expect(edited).toContain('<custom:opaque data="retain"><custom:nested>yes</custom:nested></custom:opaque>');
    expect(edited).toContain('<duration>2</duration><type>half</type>');
    expect(edited).not.toContain('<duration>1</duration><type>half</type>');
  });
});
