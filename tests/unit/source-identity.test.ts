import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { readMusicXml } from '../../app/frontend/music/musicxml';
import { addMusicXmlNote, applyMusicXmlEdits, musicXmlEditorState, removeMusicXmlNotes, sourceTabNoteRecords } from '../../app/frontend/music/musicxml-editor';
import { createSourceIdentityMap, reconcileSourceIdentityMap } from '../../app/frontend/music/source-identity';

vi.stubGlobal('DOMParser', DOMParser);
vi.stubGlobal('XMLSerializer', XMLSerializer);

const addresses = (source: string) => sourceTabNoteRecords(new DOMParser().parseFromString(source, 'application/xml') as unknown as Document).map(record => record.id);
const idAt = (source: string, ids: string[], address: string) => ids[addresses(source).indexOf(address)];

describe('imported score session identities', () => {
  it('retains measure and event IDs across an inserted measure without reusing the new occupants IDs', () => {
    const note = (step: string, fret: number) => `<note><pitch><step>${step}</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff><notations><technical><string>4</string><fret>${fret}</fret></technical></notations></note>`;
    const measure = (number: number, body: string) => `<measure number="${number}">${body}</measure>`;
    const header = '<score-partwise><part id="P1">';
    const footer = '</part></score-partwise>';
    const source = `${header}${measure(1, note('C', 0))}${measure(2, note('D', 2))}${footer}`;
    const inserted = `${header}${measure(1, '<note><rest/><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>')}${measure(2, note('C', 0))}${measure(3, note('D', 2))}${footer}`;
    const original = createSourceIdentityMap(source);
    const shifted = reconcileSourceIdentityMap(source, original, inserted);
    expect(shifted.measureIds.slice(1)).toEqual(original.measureIds);
    expect(shifted.eventIds.slice(1)).toEqual(original.eventIds);
    expect(shifted.noteIds).toEqual(original.noteIds);
    expect(shifted.measureIds[0]).not.toBe(original.measureIds[0]);
    expect(shifted.eventIds[0]).not.toBe(original.eventIds[0]);
  });

  it('carries a rest event identity explicitly when it becomes a note', () => {
    const rest = '<note><rest/><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>';
    const note = '<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff><notations><technical><string>4</string><fret>0</fret></technical></notations></note>';
    const source = `<score-partwise><part id="P1"><measure number="1">${rest}</measure></part></score-partwise>`;
    const after = source.replace(rest, note);
    const before = createSourceIdentityMap(source);
    const withoutCarry = reconcileSourceIdentityMap(source, before, after);
    expect(withoutCarry.eventIds[0]).not.toBe(before.eventIds[0]);
    const carried = reconcileSourceIdentityMap(source, before, after, [
      { kind: 'measure', id: before.measureIds[0], address: '0' },
      { kind: 'event', id: before.eventIds[0], address: '0:1:0' },
    ]);
    expect(carried.measureIds[0]).toBe(before.measureIds[0]);
    expect(carried.eventIds[0]).toBe(before.eventIds[0]);
  });

  it('keeps the selected imported rest event ID when a note is added', () => {
    const source = fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8');
    const before = readMusicXml(source, 'paired.xml');
    const originalEventId = before.sourceEventIdByAddress?.get('0:2:2');
    expect(originalEventId).toBeTruthy();
    const added = addMusicXmlNote(source, before.score, { measure: 0, beat: 2, voice: 1, string: 4, fret: 0 });
    const after = readMusicXml(added, 'paired.xml', 'musicxml', { source, map: before.sourceIdentity!, carries: [
      { kind: 'measure', id: before.sourceIdentity!.measureIds[0], address: '0' },
      { kind: 'event', id: originalEventId!, address: '0:2:2' },
    ] });
    expect(after.sourceEventIdByAddress?.get('0:2:2')).toBe(originalEventId);
    expect(after.sourceIdentity?.measureIds[0]).toBe(before.sourceIdentity?.measureIds[0]);
  });

  it('keeps an event ID when removing its last note turns it into a rest', () => {
    const source = fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8');
    const before = readMusicXml(source, 'paired.xml');
    const originalEventId = before.sourceEventIdByAddress?.get('0:2:1');
    const removed = removeMusicXmlNotes(source, before.score, { measure: 0, beat: 1, voice: 1, string: 3 })!.source;
    const after = readMusicXml(removed, 'paired.xml', 'musicxml', { source, map: before.sourceIdentity!, carries: [
      { kind: 'measure', id: before.sourceIdentity!.measureIds[0], address: '0' },
      { kind: 'event', id: originalEventId!, address: '0:2:1' },
    ] });
    expect(after.sourceEventIdByAddress?.get('0:2:1')).toBe(originalEventId);
    expect(after.sourceIdentity?.measureIds[0]).toBe(before.sourceIdentity?.measureIds[0]);
  });

  it('retains existing note IDs through chord insertion and anchor deletion', () => {
    const source = fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8');
    const preview = readMusicXml(source, 'paired.xml');
    const original = createSourceIdentityMap(source);
    const address = '0:2:0:main:main:3';
    const originalId = idAt(source, original.noteIds, address);
    const inserted = addMusicXmlNote(source, preview.score, { measure: 0, beat: 0, voice: 1, string: 2, fret: 1 });
    const afterInsertion = reconcileSourceIdentityMap(source, original, inserted, [
      { kind: 'measure', id: original.measureIds[0], address: '0' },
      { kind: 'event', id: original.eventIds[0], address: '0:2:0' },
    ]);
    expect(idAt(inserted, afterInsertion.noteIds, address)).toBe(originalId);
    expect(new Set(afterInsertion.noteIds).size).toBe(afterInsertion.noteIds.length);
    const removed = removeMusicXmlNotes(source, preview.score, { measure: 0, beat: 0, voice: 1, string: 1 })!.source;
    const afterRemoval = reconcileSourceIdentityMap(source, original, removed, [
      { kind: 'measure', id: original.measureIds[0], address: '0' },
    ]);
    expect(idAt(removed, afterRemoval.noteIds, address)).toBe(originalId);
  });

  it('carries unique unchanged notes across event insertion and does not rebind indistinguishable repeats', () => {
    const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8');
    const original = createSourceIdentityMap(source);
    const inserted = source.replace('    <note><pitch><step>C</step><octave>3</octave></pitch>',
      '    <note><rest/><duration>1</duration><type>quarter</type></note>\n    <note><pitch><step>C</step><octave>3</octave></pitch>');
    const shifted = reconcileSourceIdentityMap(source, original, inserted);
    expect(shifted.noteIds).toEqual(original.noteIds);

    const note = '<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><notations><technical><string>4</string><fret>0</fret></technical></notations></note>';
    const repeated = `<score-partwise><part id="P1"><measure number="1"><attributes><staff-details><staff-lines>5</staff-lines></staff-details></attributes>${note}${note}</measure></part></score-partwise>`;
    const repeatedMap = createSourceIdentityMap(repeated);
    const afterRepeat = reconcileSourceIdentityMap(repeated, repeatedMap, repeated.replace(`${note}${note}`, `${note}${note}${note}`));
    expect(afterRepeat.noteIds.some(id => repeatedMap.noteIds.includes(id))).toBe(false);
  });

  it('uses an explicit command carry for a note moved to another string', () => {
    const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8');
    const original = createSourceIdentityMap(source);
    const moved = source.replace('<string>4</string><fret>0</fret>', '<string>3</string><fret>0</fret>');
    const withoutHint = reconcileSourceIdentityMap(source, original, moved);
    expect(withoutHint.noteIds[0]).not.toBe(original.noteIds[0]);
    const withHint = reconcileSourceIdentityMap(source, original, moved, [{ id: original.noteIds[0], address: '0:1:0:main:main:3' }]);
    expect(withHint.noteIds[0]).toBe(original.noteIds[0]);
  });

  it('does not give a replacement note the removed note ID at the same address', () => {
    const note = '<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><notations><technical><string>4</string><fret>0</fret></technical></notations></note>';
    const source = `<score-partwise><part id="P1"><measure number="1"><attributes><staff-details><staff-lines>5</staff-lines></staff-details></attributes>${note}</measure></part></score-partwise>`;
    const before = createSourceIdentityMap(source);
    const replaced = source.replace('<step>C</step>', '<step>D</step>').replace('<fret>0</fret>', '<fret>2</fret>');
    const after = reconcileSourceIdentityMap(source, before, replaced);
    expect(after.noteIds[0]).not.toBe(before.noteIds[0]);
    expect(after.eventIds[0]).not.toBe(before.eventIds[0]);
    expect(after.measureIds[0]).not.toBe(before.measureIds[0]);
    const carried = reconcileSourceIdentityMap(source, before, replaced, [{ id: before.noteIds[0], address: addresses(replaced)[0] }]);
    expect(carried.noteIds[0]).toBe(before.noteIds[0]);
  });

  it('threads IDs through imported previews and restores them on undo', () => {
    const source = fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8');
    const first = readMusicXml(source, 'paired.xml');
    const original = musicXmlEditorState(source, first.score, first.sourceIdentity).notes.find(note => note.beat === 0 && note.string === 3)!;
    expect(first.sourceIdByModelNoteId?.get(original.modelNoteId!)).toBe(original.sourceIdentity?.id);
    const added = addMusicXmlNote(source, first.score, { measure: 0, beat: 0, voice: 1, string: 2, fret: 1 });
    const second = readMusicXml(added, 'paired.xml', 'musicxml', { source, map: first.sourceIdentity!, carries: [
      { kind: 'measure', id: first.sourceIdentity!.measureIds[0], address: '0' },
      { kind: 'event', id: first.sourceEventIdByAddress!.get('0:2:0')!, address: '0:2:0' },
    ] });
    const survivor = musicXmlEditorState(added, second.score, second.sourceIdentity).notes.find(note => note.beat === 0 && note.string === 3)!;
    expect(survivor.sourceIdentity?.id).toBe(original.sourceIdentity?.id);
    expect(second.sourceLocationById?.get(original.sourceIdentity!.id)).toMatchObject({ measure: 1, event: 1, string: 3 });
    const restored = readMusicXml(source, 'paired.xml', 'musicxml', { source, map: first.sourceIdentity! });
    expect(musicXmlEditorState(source, restored.score, restored.sourceIdentity).notes.find(note => note.beat === 0 && note.string === 3)?.sourceIdentity?.id)
      .toBe(original.sourceIdentity?.id);
  });

  it('keeps the selected ID when its string changes and a second fret edit follows', () => {
    const source = fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8');
    const first = readMusicXml(source, 'paired.xml');
    const state = musicXmlEditorState(source, first.score, first.sourceIdentity);
    const selected = state.notes.find(note => note.beat === 0 && note.string === 3)!;
    selected.string = 2;
    const moved = applyMusicXmlEdits(source, state, [selected.index]);
    const address = `${selected.sourceIdentity!.address!.slice(0, selected.sourceIdentity!.address!.lastIndexOf(':') + 1)}2`;
    const second = readMusicXml(moved, 'paired.xml', 'musicxml', { source, map: first.sourceIdentity!, carries: [{ id: selected.sourceIdentity!.id, address }] });
    expect(second.sourceIdentity?.measureIds).toEqual(first.sourceIdentity?.measureIds);
    expect(second.sourceIdentity?.eventIds).toEqual(first.sourceIdentity?.eventIds);
    const nextState = musicXmlEditorState(moved, second.score, second.sourceIdentity);
    const relocated = nextState.notes.find(note => note.sourceIdentity?.id === selected.sourceIdentity?.id)!;
    expect(relocated.string).toBe(2);
    relocated.fret = 7;
    const corrected = readMusicXml(applyMusicXmlEdits(moved, nextState, [relocated.index]), 'paired.xml');
    expect(corrected.score.tracks[0].staves[0].bars[0].voices[1].beats[0].notes.some(note => 6 - note.string === 2 && note.fret === 7)).toBe(true);
  });

  it('targets the same note ID after a preceding event changes its ordinal position', () => {
    const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8');
    const first = readMusicXml(source, 'techniques.xml');
    const selected = musicXmlEditorState(source, first.score, first.sourceIdentity).notes.find(note => note.beat === 0)!;
    const grace = '<note><grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch><type>16th</type><notations><technical><string>4</string><fret>2</fret></technical></notations></note>';
    const inserted = source.replace('    <note><pitch><step>C</step><octave>3</octave></pitch>', `    ${grace}\n    <note><pitch><step>C</step><octave>3</octave></pitch>`);
    const second = readMusicXml(inserted, 'techniques.xml', 'musicxml', { source, map: first.sourceIdentity! });
    const state = musicXmlEditorState(inserted, second.score, second.sourceIdentity);
    const relocated = state.notes.find(note => note.sourceIdentity?.id === selected.sourceIdentity?.id)!;
    expect(relocated.beat).toBeGreaterThan(selected.beat);
    relocated.fret = 1;
    const corrected = applyMusicXmlEdits(inserted, state, [relocated.index]);
    expect(corrected).toContain('<grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch>');
    expect(readMusicXml(corrected, 'techniques.xml').score.tracks[0].staves[0].bars[0].voices[0].beats.some(beat => !beat.graceType && beat.notes.some(note => note.fret === 1))).toBe(true);
  });
});
