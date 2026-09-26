import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { midi, Settings } from '@coderline/alphatab';
import { linearAuditionMidi, writtenPlaybackRange } from '../../../app/frontend/editor/audition';
import { selectionFromBeat } from '../../../app/frontend/Player';
import { createBlankMusicXml, OPEN_G_TUNING, readMusicXml } from '../../../app/frontend/music/musicxml';
import { addMusicXmlEndings, addMusicXmlGraceGroup, graceBeatPlacement, addMusicXmlRepeat, applyMusicXmlEdits, applyMusicXmlGraceGroup, inspectMusicXmlGraceGroup, removeMusicXmlGrace, removeMusicXmlGraceGroup, changeMusicXmlMeter, changeMusicXmlPickup, connectMusicXmlTie, deleteMusicXmlMeasure, duplicateMusicXmlMeasure, insertMusicXmlMeasure,
  inspectMusicXmlRepeatEndings, inspectMusicXmlRepeats, removeMusicXmlRepeat,
  inspectMusicXmlTie, removeMusicXmlTie,
  inspectMusicXmlMeterRange, musicXmlEditorState, addMusicXmlNote, inspectMusicXmlNoteTechniques, setMusicXmlBend, setMusicXmlHand, changeMusicXmlAnchor, inspectMusicXmlAnchor, removeMusicXmlNotes,
  inspectMusicXmlLyrics, setMusicXmlLyric, setMusicXmlStandaloneLyrics, applyMusicXmlScoreSettings, inspectMusicXmlScoreSettings,
  inspectMusicXmlTempo, setMusicXmlLocalTempo, connectMusicXmlTransition, inspectMusicXmlTransitions, removeMusicXmlTransition, copyMusicXmlMeasures, pasteMusicXmlMeasures, cutMusicXmlMeasures, changeMusicXmlDuration, insertMusicXmlBeat,
  type ChordSpelling } from '../../../app/frontend/music/musicxml-editor';

import './support';
import { rich } from './support';

describe('ED-16 grace group foundation', () => {
  const source = fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8');

  it('adds a two-string grace chord before an ordinary beat without using bar time', () => {
    const original = readMusicXml(source, 'grace.musicxml');
    const before = original.score.tracks[0].staves[0].bars[0].voices[0].beats[0];
    const changed = addMusicXmlGraceGroup(source, original.score, { measure: 0, beat: 0, voice: 0 },
      [{ string: 4, fret: 2 }, { string: 3, fret: 0 }], 16);
    const after = readMusicXml(changed, 'grace.musicxml');
    const notes = Array.from(new DOMParser().parseFromString(changed, 'application/xml').getElementsByTagName('measure')[0]
      .getElementsByTagName('note'));
    expect(notes.slice(0, 2).every(note => note.getElementsByTagName('grace').length === 1)).toBe(true);
    expect(notes[1].getElementsByTagName('chord')).toHaveLength(1);
    expect(notes.slice(0, 2).every(note => note.getElementsByTagName('duration').length === 0)).toBe(true);
    expect(after.score.masterBars[0].calculateDuration()).toBe(original.score.masterBars[0].calculateDuration());
    const beats = after.score.tracks[0].staves[0].bars[0].voices[0].beats;
    expect(beats[0].graceType).toBeTruthy();
    expect(beats[0].notes.map(note => note.fret).sort()).toEqual([0, 2]);
    expect(beats.find(beat => !beat.graceType)?.playbackStart).toBe(before.playbackStart);
  });

  it('rejects duplicate strings, bad frets and a grace destination', () => {
    const original = readMusicXml(source, 'grace.musicxml');
    const position = { measure: 0, beat: 0, voice: 0 };
    expect(() => addMusicXmlGraceGroup(source, original.score, position, [{ string: 3, fret: 1 }, { string: 3, fret: 2 }], 16))
      .toThrow('distinct strings');
    expect(() => addMusicXmlGraceGroup(source, original.score, position, [{ string: 3, fret: 37 }], 16))
      .toThrow('frets from 0 to 36');
    expect(() => addMusicXmlGraceGroup(source, original.score, position, [{ string: 3, fret: 0 }], 4 as 8))
      .toThrow('duration must be 1/8 or 1/16');
    const missingTuning = readMusicXml(source, 'grace.musicxml').score;
    missingTuning.tracks[0].staves[0].tuning[2] = Number.NaN;
    expect(() => addMusicXmlGraceGroup(source, missingTuning, position, [{ string: 3, fret: 0 }], 16))
      .toThrow('no valid tuning');
    const changed = addMusicXmlGraceGroup(source, original.score, position, [{ string: 3, fret: 0 }], 16);
    const withGrace = readMusicXml(changed, 'grace.musicxml');
    expect(() => addMusicXmlGraceGroup(changed, withGrace.score, position, [{ string: 3, fret: 1 }], 16))
      .toThrow('ordinary sounding beat');
  });

  it('adds the same grace pitch to verified notation and TAB lanes only', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const voices = original.score.tracks[0].staves[0].bars[0].voices;
    const voice = voices.findIndex(candidate => candidate.beats.some(beat => !beat.graceType && beat.notes.some(note => note.fret === 4)));
    const hammerStop = voices[voice].beats.findIndex(candidate => !candidate.graceType && candidate.notes.some(note => note.fret === 2));
    expect(() => addMusicXmlGraceGroup(rich, original.score, { measure: 0, beat: hammerStop, voice }, [{ string: 4, fret: 1 }], 8))
      .toThrow('interrupt an existing technique endpoint');
    const beat = voices[voice].beats.map(candidate => !candidate.graceType && candidate.notes.some(note => note.fret === 4)).lastIndexOf(true);
    const changed = addMusicXmlGraceGroup(rich, original.score, { measure: 0, beat, voice }, [{ string: 4, fret: 1 }], 8);
    const parsed = new DOMParser().parseFromString(changed, 'application/xml');
    const sourceNotes = Array.from(parsed.getElementsByTagName('measure')[0].getElementsByTagName('note'));
    expect(sourceNotes.filter(note => note.getElementsByTagName('grace').length && note.getElementsByTagName('type')[0]?.textContent === 'eighth'))
      .toHaveLength(2);
    expect(sourceNotes.filter(note => note.getElementsByTagName('grace').length && note.getElementsByTagName('fret')[0]?.textContent === '1'))
      .toHaveLength(1);
    expect(changed).toContain('<opaque:keep data="unchanged">');
    expect(readMusicXml(changed, 'rich.musicxml').score.masterBars[0].calculateDuration())
      .toBe(original.score.masterBars[0].calculateDuration());
  });
});

describe('ED-16 grace editing and removal', () => {
  const graceTarget = (source: string) => {
    const score = readMusicXml(source, 'rich.musicxml').score;
    const voices = score.tracks[0].staves[0].bars[0].voices;
    const voice = voices.findIndex(candidate => candidate.beats.some(beat => beat.graceType));
    const beat = voices[voice].beats.findIndex(candidate => candidate.graceType);
    return { score, voice, beat, main: voices[voice].beats.find(candidate => !candidate.graceType)! };
  };
  const firstMeasureNotes = (source: string) => Array.from(new DOMParser().parseFromString(source, 'application/xml')
    .getElementsByTagName('measure')[0].getElementsByTagName('note'));
  const graceNotes = (source: string) => firstMeasureNotes(source).filter(note => note.getElementsByTagName('grace').length);

  it('edits one grace fret on both staves without moving the destination', () => {
    const { score, voice, beat, main } = graceTarget(rich);
    const state = musicXmlEditorState(rich, score);
    const edit = state.notes.find(note => note.measure === 0 && note.voice === voice && note.beat === beat && note.string === 3)!;
    edit.fret = 2;
    const changed = applyMusicXmlEdits(rich, state, [edit.index]);
    const pitches = graceNotes(changed).map(note => `${note.getElementsByTagName('step')[0].textContent}${note.getElementsByTagName('octave')[0].textContent}`);
    expect(pitches.sort()).toEqual(['A3', 'A3', 'D3', 'D3']);
    expect(graceNotes(changed).filter(note => note.getElementsByTagName('fret')[0]?.textContent === '2')).toHaveLength(1);
    const after = graceTarget(changed);
    expect(after.main.playbackStart).toBe(main.playbackStart);
    expect(after.score.masterBars[0].calculateDuration()).toBe(score.masterBars[0].calculateDuration());
  });

  it('removes one grace string from both staves and keeps the rest of the grace chord', () => {
    const { score, voice, beat, main } = graceTarget(rich);
    const result = removeMusicXmlGrace(rich, score, { measure: 0, beat, voice, string: 3 });
    expect(result.dependencies).toEqual([]);
    expect(result.groupRemoved).toBe(false);
    const remaining = graceNotes(result.source);
    expect(remaining).toHaveLength(2);
    expect(remaining.every(note => note.getElementsByTagName('chord').length === 0)).toBe(true);
    expect(remaining.every(note => note.getElementsByTagName('step')[0].textContent === 'D')).toBe(true);
    expect(result.source).toContain('<opaque:keep data="unchanged">');
    const after = graceTarget(result.source);
    expect(after.main.playbackStart).toBe(main.playbackStart);
    expect(after.score.masterBars[0].calculateDuration()).toBe(score.masterBars[0].calculateDuration());
  });

  it('removes the final grace note as a whole group without leaving a rest', () => {
    const { score, voice, beat } = graceTarget(rich);
    const before = firstMeasureNotes(rich).length;
    const result = removeMusicXmlGrace(rich, score, { measure: 0, beat, voice });
    expect(result.groupRemoved).toBe(true);
    expect(graceNotes(result.source)).toHaveLength(0);
    expect(firstMeasureNotes(result.source)).toHaveLength(before - 4);
    expect(firstMeasureNotes(result.source).filter(note => note.getElementsByTagName('rest').length))
      .toHaveLength(firstMeasureNotes(rich).filter(note => note.getElementsByTagName('rest').length).length);
    expect(readMusicXml(result.source, 'rich.musicxml').score.tracks[0].staves[0].bars[0].voices[voice].beats.some(item => item.graceType)).toBe(false);
  });

  it('reports and repairs a grace-to-main span on the removed string only', () => {
    const spanned = rich
      .replace('<string>4</string><fret>0</fret></technical></notations></note>\n      <note><grace slash="yes"/><chord/>',
        '<string>4</string><fret>0</fret></technical><slide number="7" type="start"/></notations></note>\n      <note><grace slash="yes"/><chord/>')
      .replace('<hammer-on type="start">H</hammer-on></technical></notations></note>\n      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice>',
        '<hammer-on type="start">H</hammer-on></technical><slide number="7" type="stop"/></notations></note>\n      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice>');
    expect(spanned.match(/number="7"/g)).toHaveLength(2);
    const { score, voice, beat } = graceTarget(spanned);
    const result = removeMusicXmlGrace(spanned, score, { measure: 0, beat, voice, string: 4 });
    expect(result.dependencies).toEqual(['slide']);
    expect(result.source).not.toContain('number="7"');
    expect(result.source).toContain('<hammer-on type="start">H</hammer-on>');
  });

  it('keeps the other beat of a two-beat grace group', () => {
    const second = (voice: string, staff: string, technical: string) => `<note><grace slash="yes"/><pitch><step>A</step><octave>3</octave></pitch><voice>${voice}</voice><type>16th</type><staff>${staff}</staff>${technical}</note>`;
    const twoEvents = rich
      .replace('<note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice>',
        `${second('1', '1', '')}\n      <note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice>`)
      .replace('<note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice>',
        `${second('2', '2', '<notations><technical><string>3</string><fret>2</fret></technical></notations>')}\n      <note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice>`);
    expect(graceNotes(twoEvents)).toHaveLength(6);
    const { score, voice, beat, main } = graceTarget(twoEvents);
    const result = removeMusicXmlGrace(twoEvents, score, { measure: 0, beat, voice });
    expect(result.groupRemoved).toBe(false);
    expect(graceNotes(result.source).map(note => note.getElementsByTagName('step')[0].textContent)).toEqual(['A', 'A']);
    const after = graceTarget(result.source);
    expect(after.score.tracks[0].staves[0].bars[0].voices[voice].beats[beat].notes.map(note => note.fret)).toEqual([2]);
    expect(after.main.playbackStart).toBe(main.playbackStart);
  });

  it('rejects ordinary, mismatched and protected grace targets', () => {
    const { score, voice, beat } = graceTarget(rich);
    expect(() => removeMusicXmlGrace(rich, score, { measure: 0, beat: beat + 1, voice })).toThrow('Select a grace note');
    expect(() => removeMusicXmlGrace(rich, score, { measure: 0, beat, voice, string: 1 })).toThrow('cannot be matched safely');
    const stale = rich.replace('<string>3</string><fret>0</fret></technical></notations></note>\n      <note><pitch><step>D</step>',
      '<string>3</string><fret>1</fret></technical></notations></note>\n      <note><pitch><step>D</step>');
    expect(stale).not.toBe(rich);
    expect(() => removeMusicXmlGrace(stale, score, { measure: 0, beat, voice })).toThrow('does not match the selected grace note');
    const protectedGrace = rich.replace('<grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch><voice>2</voice><type>16th</type>',
      '<grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch><voice>2</voice><type>16th</type><notehead>x</notehead>');
    expect(protectedGrace).not.toBe(rich);
    expect(() => removeMusicXmlGrace(protectedGrace, graceTarget(protectedGrace).score, { measure: 0, beat, voice, string: 4 }))
      .toThrow('protected notehead attachment');
  });
});

describe('ED-16 grace group dialog commands', () => {
  const target = (source: string) => {
    const score = readMusicXml(source, 'rich.musicxml').score;
    const voices = score.tracks[0].staves[0].bars[0].voices;
    const voice = voices.findIndex(candidate => candidate.beats.some(beat => beat.graceType));
    return { score, voice, beat: voices[voice].beats.findIndex(candidate => candidate.graceType), beats: voices[voice].beats };
  };
  const hammerPullBends = (source: string) => {
    const file = new midi.MidiFile();
    new midi.MidiFileGenerator(readMusicXml(source, 'rich.musicxml').score, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
    return file.events.filter((event): event is midi.NoteBendEvent => event instanceof midi.NoteBendEvent)
      .filter(event => (event as midi.NoteBendEvent & { isHammerPull?: boolean }).isHammerPull);
  };

  it('inspects the supported rich grace chord from either the grace or its destination', () => {
    const { score, voice, beat } = target(rich);
    const expected = { destination: beat + 1, first: beat, placement: 'before', readOnly: [], connections: [],
      graceBeats: [{ denominator: 16, notes: [{ string: 4, fret: 0, transition: 'none' }, { string: 3, fret: 0, transition: 'none' }] }] };
    expect(inspectMusicXmlGraceGroup(rich, score, { measure: 0, beat, voice })).toEqual(expected);
    expect(inspectMusicXmlGraceGroup(rich, score, { measure: 0, beat: beat + 1, voice })).toEqual(expected);
  });

  it('writes a grace-to-main pull-off that renders, plays legato, and reopens identically', () => {
    const { score, voice, beat } = target(rich);
    const events = [{ denominator: 8 as const, notes: [{ string: 4, fret: 2, transition: 'pull-off' as const }, { string: 3, fret: 0, transition: 'none' as const }] }];
    const changed = applyMusicXmlGraceGroup(rich, score, { measure: 0, beat, voice }, events);
    const after = target(changed);
    const grace = after.beats[after.beat].notes.find(note => 6 - note.string === 4)!;
    expect(grace.isHammerPullOrigin).toBe(true);
    expect(grace.hammerPullDestination?.beat.graceType).toBeFalsy();
    expect(grace.hammerPullDestination?.fret).toBe(0);
    expect(after.beats[after.beat + 1].notes[0].isHammerPullOrigin).toBe(true);
    expect(changed.match(/<pull-off type="start">PO<\/pull-off>/g)).toHaveLength(2);
    expect(changed.match(/<pull-off type="stop"\/>/g)).toHaveLength(2);
    expect(changed).toContain('<opaque:keep data="unchanged">');
    expect(after.score.masterBars[0].calculateDuration()).toBe(score.masterBars[0].calculateDuration());
    expect(hammerPullBends(changed).length).toBeGreaterThan(hammerPullBends(rich).length);
    const reopened = inspectMusicXmlGraceGroup(changed, after.score, { measure: 0, beat: after.beat, voice });
    expect(reopened).toMatchObject({ readOnly: [], graceBeats: events, connections: ['pull-off'] });
    expect(applyMusicXmlGraceGroup(changed, after.score, { measure: 0, beat: after.beat, voice }, events)).toBe(changed);
  });

  it('chains a slide between grace notes and replaces the group without leaving stale endpoints', () => {
    const { score, voice, beat } = target(rich);
    const changed = applyMusicXmlGraceGroup(rich, score, { measure: 0, beat, voice }, [
      { denominator: 16, notes: [{ string: 4, fret: 2, transition: 'slide' }] },
      { denominator: 16, notes: [{ string: 4, fret: 4, transition: 'pull-off' }] },
    ]);
    expect(changed.match(/<slide type="(start|stop)" number="2"\/>/g)).toHaveLength(4);
    const after = target(changed);
    expect(after.beats[after.beat].notes[0].slideOutType).not.toBe(0);
    expect(after.beats[after.beat + 1].notes[0].isHammerPullOrigin).toBe(true);
    const plain = applyMusicXmlGraceGroup(changed, after.score, { measure: 0, beat: after.beat, voice },
      [{ denominator: 16, notes: [{ string: 3, fret: 1, transition: 'none' }] }]);
    expect(plain).not.toMatch(/<slide [^>]*number="2"/);
    expect(plain).not.toContain('pull-off');
    expect(plain).toContain('<hammer-on type="start">H</hammer-on>');
  });

  it('rejects invalid transitions and grace settings atomically', () => {
    const { score, voice, beat } = target(rich);
    const position = { measure: 0, beat, voice };
    const one = (string: number, fret: number, transition: 'none' | 'hammer-on' | 'pull-off' | 'slide') => [{ denominator: 16 as const, notes: [{ string, fret, transition }] }];
    expect(() => applyMusicXmlGraceGroup(rich, score, position, one(4, 2, 'hammer-on'))).toThrow('Grace note 1, string 4: a hammer-on needs a higher fret on its next note (fret 0).');
    expect(() => applyMusicXmlGraceGroup(rich, score, position, one(4, 0, 'pull-off'))).toThrow('a pull-off needs a lower fret');
    expect(() => applyMusicXmlGraceGroup(rich, score, position, one(4, 0, 'slide'))).toThrow('a slide needs a different fret');
    expect(() => applyMusicXmlGraceGroup(rich, score, position, one(2, 3, 'hammer-on'))).toThrow('needs a later note on string 2');
    expect(() => applyMusicXmlGraceGroup(rich, score, position, one(2, 3, 'bend' as 'none'))).toThrow('Choose None, Hammer-on, Pull-off, or Slide');
    expect(() => applyMusicXmlGraceGroup(rich, score, position, [])).toThrow('one to eight grace notes');
    expect(() => applyMusicXmlGraceGroup(rich, score, position, [{ denominator: 4 as 8, notes: [{ string: 3, fret: 0, transition: 'none' }] }])).toThrow('1/8 or 1/16');
    const eOnString4 = target(rich).beats.findIndex(candidate => !candidate.graceType && candidate.notes.some(note => note.fret === 2));
    expect(() => applyMusicXmlGraceGroup(rich, score, { measure: 0, beat: eOnString4, voice }, one(4, 1, 'none'))).toThrow('interrupt an existing technique endpoint');
    expect(() => removeMusicXmlGraceGroup(rich, score, { measure: 0, beat: eOnString4, voice })).toThrow('no grace group to remove');
  });

  it('keeps unsupported imported grace settings read-only, preserved by unrelated edits, and removable as a group', () => {
    const tef = rich
      .replace('<voice>2</voice><type>16th</type><staff>2</staff><notations><technical><string>4</string><fret>0</fret></technical>',
        '<voice>2</voice><staff>2</staff><notations><technical><string>4</string><fret>0</fret><other-technical>TEF grace effect 5</other-technical></technical>');
    expect(tef).toContain('TEF grace effect 5');
    const { score, voice, beat } = target(tef);
    const info = inspectMusicXmlGraceGroup(tef, score, { measure: 0, beat, voice });
    expect(info.readOnly).toContain('Grace note 1, string 4 has the marking “TEF grace effect 5”.');
    expect(info.readOnly).toContain('Grace note 1 mixes display durations.');
    expect(() => applyMusicXmlGraceGroup(tef, score, { measure: 0, beat, voice }, info.graceBeats))
      .toThrow('This grace group is read-only: Grace note 1 mixes display durations.');
    const state = musicXmlEditorState(tef, score);
    const edit = state.notes.find(note => note.measure === 0 && note.voice === voice && note.beat === beat + 2)!;
    edit.fret = 3;
    const unrelated = applyMusicXmlEdits(tef, state, [edit.index]);
    expect(unrelated).toContain('<other-technical>TEF grace effect 5</other-technical>');
    expect(inspectMusicXmlGraceGroup(unrelated, readMusicXml(unrelated, 'rich.musicxml').score, { measure: 0, beat, voice }).readOnly).toEqual(info.readOnly);
    const removed = removeMusicXmlGraceGroup(tef, score, { measure: 0, beat, voice });
    expect(removed.source).not.toContain('TEF grace effect');
    expect(removed.source).not.toContain('<grace');
    const untyped = tef.replace('<other-technical>TEF grace effect 5</other-technical>', '')
      .replace(/(<grace slash="yes"\/>(?:<chord\/>)?<pitch>(?:(?!<\/note>).)*?)<type>16th<\/type>/g, '$1');
    const plain = target(untyped);
    const untypedInfo = inspectMusicXmlGraceGroup(untyped, plain.score, { measure: 0, beat, voice });
    expect(untypedInfo.readOnly).toEqual([]);
    expect(untypedInfo.graceBeats[0].denominator).toBeNull();
    const kept = applyMusicXmlGraceGroup(untyped, plain.score, { measure: 0, beat, voice },
      [{ ...untypedInfo.graceBeats[0], notes: [{ string: 4, fret: 2, transition: 'none' }] }]);
    expect(Array.from(new DOMParser().parseFromString(kept, 'application/xml').getElementsByTagName('note'))
      .filter(note => note.getElementsByTagName('grace').length).every(note => note.getElementsByTagName('type').length === 0)).toBe(true);
  });

  it('reports an incoming span and unfamiliar grace markup as read-only', () => {
    const graceE = (voice: string, staff: string, technical: string) => `<note><grace slash="yes"/><pitch><step>E</step><octave>3</octave></pitch><voice>${voice}</voice><type>16th</type><staff>${staff}</staff><notations><technical>${technical}<hammer-on type="stop"/></technical></notations></note>`;
    const incoming = rich
      .replace('<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff><notations><technical><hammer-on type="stop"/></technical>',
        `${graceE('1', '1', '')}<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff><notations><technical></technical>`)
      .replace('<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff><notations><technical><string>4</string><fret>2</fret><hammer-on type="stop"/></technical>',
        `${graceE('2', '2', '<string>4</string><fret>2</fret>')}<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff><notations><technical><string>4</string><fret>2</fret></technical>`);
    expect(incoming.match(/<hammer-on type="stop"\/>/g)).toHaveLength(2);
    const first = target(incoming);
    const incomingBeat = first.beats.findIndex(beat => beat.graceType && beat.notes[0].fret === 2);
    expect(inspectMusicXmlGraceGroup(incoming, first.score, { measure: 0, beat: incomingBeat, voice: first.voice }).readOnly)
      .toEqual(['Grace note 1, string 4 ends a hammer-on that starts outside the grace group.']);
    const styled = rich.replace('<note><grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch><voice>1</voice>',
      '<note default-x="12"><grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch><voice>1</voice>')
      .replace('<grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch><voice>2</voice>',
        '<grace slash="yes" steal-time-previous="10"/><pitch><step>D</step><octave>3</octave></pitch><voice>2</voice>')
      .replace('<grace slash="yes"/><chord/><pitch><step>G</step><octave>3</octave></pitch><voice>2</voice><type>16th</type><staff>2</staff>',
        '<grace/><chord/><pitch><step>G</step><octave>3</octave></pitch><voice>2</voice><type>16th</type><staff>2</staff><notehead>x</notehead>');
    const second = target(styled);
    expect(inspectMusicXmlGraceGroup(styled, second.score, { measure: 0, beat: second.beat, voice: second.voice }).readOnly).toEqual([
      'Grace note 1, string 4 has a grace steal-time-previous setting.',
      'Grace note 1, string 3 has an unslashed grace.',
      'Grace note 1 on the notation staff has a default-x note attribute.',
    ]);
  });
});

describe('after-graces', () => {
  const fixture = fs.readFileSync('tests/fixtures/editor-after-grace.musicxml', 'utf8');
  // The fixture without its grace chord or slides: a pick, then a two-string chord.
  const plain = fixture.replace(/\s*<note><grace[^]*?<\/note>/g, '').replace(/<slide type="start" number="\d"\/>/g, '');
  const load = (value: string) => readMusicXml(value, 'after.musicxml');
  const slideInto = [{ denominator: 16 as const, notes: [
    { string: 1, fret: 2, transition: 'slide' as const }, { string: 2, fret: 3, transition: 'slide' as const }] }];
  const noteOns = (value: string) => {
    const file = new midi.MidiFile();
    new midi.MidiFileGenerator(load(value).score, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
    return file.tracks.flatMap(track => track.events).filter(event => /NoteOn/.test(event.constructor.name)).map(event => event.tick);
  };

  it('adds a grace chord after the last beat of a measure that the chord slides into', () => {
    expect(plain).not.toContain('<grace');
    const added = applyMusicXmlGraceGroup(plain, load(plain).score, { measure: 0, beat: 1, voice: 0 }, slideInto, 'after');
    expect(added.match(/<grace slash="yes" steal-time-previous="25"\/>/g)).toHaveLength(2);
    expect(added.match(/<slide type="start" number="\d"\/>/g)).toHaveLength(2);
    expect(added.match(/<slide type="stop" number="\d"\/>/g)).toHaveLength(2);
    const beats = load(added).score.tracks[0].staves[0].bars[0].voices[0].beats;
    expect(beats).toHaveLength(3);
    expect(beats[2].graceType).toBeTruthy();
    expect(beats[1].notes.every(note => note.slideTarget)).toBe(true);
    expect(beats[2].playbackStart).toBe(1800);
    expect(noteOns(added)).toContain(1800);
    const info = inspectMusicXmlGraceGroup(added, load(added).score, { measure: 0, beat: 2, voice: 0 }, 'after');
    expect(info).toMatchObject({ destination: 1, first: 2, placement: 'after', readOnly: [] });
    expect(info.graceBeats).toEqual(slideInto);
    expect(graceBeatPlacement(added, load(added).score, { measure: 0, beat: 2, voice: 0 })).toBe('after');
    expect(graceBeatPlacement(added, load(added).score, { measure: 0, beat: 1, voice: 0 })).toBeNull();
    // Nothing is before the chord.
    expect(inspectMusicXmlGraceGroup(added, load(added).score, { measure: 0, beat: 1, voice: 0 }).graceBeats).toEqual([]);
  });

  it('edits and removes an after-grace group as one unit', () => {
    const added = applyMusicXmlGraceGroup(plain, load(plain).score, { measure: 0, beat: 1, voice: 0 }, slideInto, 'after');
    const edited = applyMusicXmlGraceGroup(added, load(added).score, { measure: 0, beat: 2, voice: 0 },
      [{ denominator: 8, notes: [{ string: 1, fret: 4, transition: 'hammer-on' }] }], 'after');
    expect(edited.match(/<grace /g)).toHaveLength(1);
    expect(edited).not.toContain('<slide');
    expect(edited.match(/<hammer-on type="start"/g)).toHaveLength(1);
    expect(inspectMusicXmlGraceGroup(edited, load(edited).score, { measure: 0, beat: 1, voice: 0 }, 'after').graceBeats)
      .toEqual([{ denominator: 8, notes: [{ string: 1, fret: 4, transition: 'hammer-on' }] }]);
    const removed = removeMusicXmlGraceGroup(edited, load(edited).score, { measure: 0, beat: 2, voice: 0 }, 'after');
    expect(removed.source).not.toContain('<grace');
    expect(removed.source).not.toContain('hammer-on');
    expect(() => removeMusicXmlGraceGroup(removed.source, load(removed.source).score, { measure: 0, beat: 1, voice: 0 }, 'after'))
      .toThrow('no grace group to remove');
  });

  it('checks transition direction and needs a note to come from', () => {
    const score = load(plain).score;
    const at = { measure: 0, beat: 1, voice: 0 };
    expect(() => applyMusicXmlGraceGroup(plain, score, at, [{ denominator: 16, notes: [{ string: 1, fret: 0, transition: 'hammer-on' }] }], 'after'))
      .toThrow('a hammer-on needs a higher fret than the note it comes from (fret 1)');
    expect(() => applyMusicXmlGraceGroup(plain, score, at, [{ denominator: 16, notes: [{ string: 1, fret: 1, transition: 'slide' }] }], 'after'))
      .toThrow('a slide needs a different fret from the note it comes from');
    expect(() => applyMusicXmlGraceGroup(plain, score, at, [{ denominator: 16, notes: [{ string: 3, fret: 2, transition: 'pull-off' }] }], 'after'))
      .toThrow('needs a note on string 3 in the main beat or an earlier grace note');
    // A second grace note can slide on from the first.
    const chained = applyMusicXmlGraceGroup(plain, score, at, [{ denominator: 16, notes: [{ string: 1, fret: 2, transition: 'none' }] },
      { denominator: 16, notes: [{ string: 1, fret: 4, transition: 'slide' }] }], 'after');
    expect(inspectMusicXmlGraceGroup(chained, load(chained).score, at, 'after').graceBeats.map(graceBeat => graceBeat.notes[0].transition)).toEqual(['none', 'slide']);
    expect(() => applyMusicXmlGraceGroup(plain, score, { measure: 1, beat: 5, voice: 0 }, slideInto, 'after')).toThrow();
  });

  it('keeps a mid-measure after-grace apart from the next beat’s own grace group', () => {
    const afterPick = applyMusicXmlGraceGroup(plain, load(plain).score, { measure: 0, beat: 0, voice: 0 },
      [{ denominator: 16, notes: [{ string: 4, fret: 2, transition: 'hammer-on' }] }], 'after');
    const both = applyMusicXmlGraceGroup(afterPick, load(afterPick).score, { measure: 0, beat: 2, voice: 0 },
      [{ denominator: 16, notes: [{ string: 1, fret: 3, transition: 'none' }] }]);
    const score = load(both).score;
    const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
    expect(beats.map(beat => Boolean(beat.graceType))).toEqual([false, true, true, false]);
    expect(graceBeatPlacement(both, score, { measure: 0, beat: 1, voice: 0 })).toBe('after');
    expect(graceBeatPlacement(both, score, { measure: 0, beat: 2, voice: 0 })).toBe('before');
    expect(inspectMusicXmlGraceGroup(both, score, { measure: 0, beat: 1, voice: 0 }, 'after').graceBeats[0].notes[0]).toEqual({ string: 4, fret: 2, transition: 'hammer-on' });
    expect(inspectMusicXmlGraceGroup(both, score, { measure: 0, beat: 2, voice: 0 }).graceBeats[0].notes[0]).toEqual({ string: 1, fret: 3, transition: 'none' });
    expect(inspectMusicXmlGraceGroup(both, score, { measure: 0, beat: 3, voice: 0 })).toMatchObject({ destination: 3, first: 2 });
  });
});
