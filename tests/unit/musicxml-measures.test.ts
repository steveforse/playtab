import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { midi, Settings } from '@coderline/alphatab';
import { linearAuditionMidi, writtenPlaybackRange } from '../../app/frontend/editor/audition';
import { selectionFromBeat } from '../../app/frontend/Player';
import { readMusicXml } from '../../app/frontend/music/musicxml';
import { addMusicXmlEndings, addMusicXmlGraceGroup, addMusicXmlRepeat, applyMusicXmlEdits, removeMusicXmlGrace, changeMusicXmlMeter, changeMusicXmlPickup, connectMusicXmlTie, deleteMusicXmlMeasure, duplicateMusicXmlMeasure, insertMusicXmlMeasure,
  inspectMusicXmlRepeatEndings, inspectMusicXmlRepeats, removeMusicXmlRepeat,
  inspectMusicXmlTie, removeMusicXmlTie,
  inspectMusicXmlMeterRange, musicXmlEditorState } from '../../app/frontend/music/musicxml-editor';

vi.stubGlobal('DOMParser', DOMParser);
vi.stubGlobal('XMLSerializer', XMLSerializer);

const rich = fs.readFileSync('tests/fixtures/editor-rich.musicxml', 'utf8');

describe('ED-12 measure insertion', () => {
  it('uses the inherited 4/4 before an explicit 3/4 bar and fills every paired voice', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const inserted = insertMusicXmlMeasure(rich, original.score, 1, 'before');
    const after = readMusicXml(inserted, 'rich.musicxml');
    expect(after.score.masterBars).toHaveLength(3);
    expect(after.score.masterBars[1].timeSignatureNumerator).toBe(4);
    expect(after.score.masterBars[2].timeSignatureNumerator).toBe(3);
    const voices = after.score.tracks[0].staves[0].bars[1].voices;
    expect(voices[1].beats.every(beat => beat.isRest)).toBe(true);
    expect(voices[3].beats.every(beat => beat.isRest)).toBe(true);
    expect(voices[1].beats.reduce((total, beat) => total + beat.playbackDuration, 0)).toBe(3840);
    expect(voices[3].beats.reduce((total, beat) => total + beat.playbackDuration, 0)).toBe(3840);
    expect(after.score.tracks[0].staves[0].bars[2].voices[1].beats[0].notes[0].fret)
      .toBe(original.score.tracks[0].staves[0].bars[1].voices[1].beats[0].notes[0].fret);
  });

  it('inherits 3/4 after the final bar without inventing a 4/4 measure', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const inserted = insertMusicXmlMeasure(rich, original.score, 1, 'after');
    const after = readMusicXml(inserted, 'rich.musicxml');
    expect(after.score.masterBars).toHaveLength(3);
    expect(after.score.masterBars[2].timeSignatureNumerator).toBe(3);
    const beats = after.score.tracks[0].staves[0].bars[2].voices[1].beats;
    expect(beats.every(beat => beat.isRest)).toBe(true);
    expect(beats.reduce((total, beat) => total + beat.playbackDuration, 0)).toBe(2880);
  });

  it('copies initial attributes when inserting before the first measure', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const inserted = insertMusicXmlMeasure(rich, original.score, 0, 'before');
    const after = readMusicXml(inserted, 'rich.musicxml');
    expect(after.score.masterBars).toHaveLength(3);
    expect(after.score.masterBars[0].timeSignatureNumerator).toBe(4);
    expect(after.score.tracks[0].staves[0].tuning).toEqual(original.score.tracks[0].staves[0].tuning);
    expect(after.score.tracks[0].staves[0].bars[0].voices[1].beats.every(beat => beat.isRest)).toBe(true);
  });

  it('uses exact fractional divisions and restores them for the following inherited bar', () => {
    const source = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Banjo</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>5</beats><beat-type>8</beat-type></time>
      <staff-details number="1"><staff-lines>5</staff-lines><staff-tuning line="1"><tuning-step>G</tuning-step><tuning-octave>4</tuning-octave></staff-tuning>
      <staff-tuning line="2"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
      <staff-tuning line="3"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
      <staff-tuning line="4"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
      <staff-tuning line="5"><tuning-step>D</tuning-step><tuning-octave>4</tuning-octave></staff-tuning></staff-details></attributes>
      <note><rest/><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note></measure>
      <measure number="2"><note><rest/><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note></measure></part></score-partwise>`;
    const original = readMusicXml(source, 'five-eight.musicxml');
    const inserted = insertMusicXmlMeasure(source, original.score, 0, 'after');
    const after = readMusicXml(inserted, 'five-eight.musicxml');
    expect(after.score.masterBars).toHaveLength(3);
    expect(after.score.tracks[0].staves[0].bars[1].voices[0].beats.reduce((sum, beat) => sum + beat.playbackDuration, 0)).toBe(2400);
    const xml = new DOMParser().parseFromString(inserted, 'application/xml');
    const measures = Array.from(xml.getElementsByTagName('measure'));
    expect(measures[1].getElementsByTagName('divisions')[0].textContent).toBe('2');
    expect(measures[2].getElementsByTagName('divisions')[0].textContent).toBe('1');
  });

  it('rejects insertion beyond the 256-measure limit', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const xml = new DOMParser().parseFromString(rich, 'application/xml');
    const part = xml.getElementsByTagName('part')[0];
    const template = xml.getElementsByTagName('measure')[1];
    for (let index = 2; index < 256; index++) part.appendChild(template.cloneNode(true));
    const full = new XMLSerializer().serializeToString(xml);
    const score = Object.assign(Object.create(Object.getPrototypeOf(original.score)), original.score,
      { masterBars: Array(256).fill(original.score.masterBars[1]) });
    expect(() => insertMusicXmlMeasure(full, score, 0, 'after')).toThrow('256 measures');
  });
});

describe('ED-16 grace group foundation', () => {
  const source = fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8');

  it('adds a two-string grace chord before an ordinary event without using bar time', () => {
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
      .toThrow('ordinary sounding event');
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

  it('removes the final grace event as a whole group without leaving a rest', () => {
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

  it('keeps the other event of a two-event grace group', () => {
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

describe('ED-12 measure duplication', () => {
  it('copies local music and labels, while excluding incoming ties and repeat endings', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const result = duplicateMusicXmlMeasure(rich, original.score, 1);
    expect(result.excluded).toEqual(expect.arrayContaining(['cross-measure tie', 'repeat marker', 'repeat ending']));
    const after = readMusicXml(result.source, 'rich.musicxml');
    expect(after.score.masterBars).toHaveLength(3);
    expect(after.score.masterBars[2].timeSignatureNumerator).toBe(3);
    expect(after.score.tracks[0].staves[0].bars[2].voices[1].beats[0].notes[0].fret)
      .toBe(original.score.tracks[0].staves[0].bars[1].voices[1].beats[0].notes[0].fret);
    const xml = new DOMParser().parseFromString(result.source, 'application/xml');
    const measures = Array.from(xml.getElementsByTagName('measure'));
    expect(measures[2].getElementsByTagName('words')[0].textContent).toBe('Section B');
    expect(measures[2].getElementsByTagName('tie')).toHaveLength(0);
    expect(measures[2].getElementsByTagName('repeat')).toHaveLength(0);
    expect(measures[1].getElementsByTagName('repeat')).toHaveLength(1);
  });

  it('blocks duplication that would split an outgoing cross-bar tie', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    expect(() => duplicateMusicXmlMeasure(rich, original.score, 0)).toThrow('split a cross-measure tie');
    expect(() => duplicateMusicXmlMeasure(rich, original.score, -1)).toThrow('cannot be identified safely');
  });

  it('retains contained hammer/slide technique pairs and local section words', () => {
    const untied = rich.replace(/<tie type="(?:start|stop)"\/>/g, '')
      .replace(/<tied type="(?:start|stop)"\/>/g, '');
    const original = readMusicXml(untied, 'rich.musicxml');
    const result = duplicateMusicXmlMeasure(untied, original.score, 0);
    const xml = new DOMParser().parseFromString(result.source, 'application/xml');
    const copy = Array.from(xml.getElementsByTagName('measure'))[1];
    expect(copy.getElementsByTagName('hammer-on')).toHaveLength(4);
    expect(copy.getElementsByTagName('slide')).toHaveLength(4);
    expect(copy.getElementsByTagName('words')[0].textContent).toBe('Section A');
    expect(result.excluded).toContain('repeat marker');
  });

  it('excludes a cross-measure direction marker from the copy', () => {
    const withWedge = rich.replace('<measure number="2">', '<measure number="2"><direction><direction-type><wedge number="1" type="crescendo"/></direction-type></direction>');
    const original = readMusicXml(withWedge, 'rich.musicxml');
    const result = duplicateMusicXmlMeasure(withWedge, original.score, 1);
    expect(result.excluded).toContain('cross-measure direction span');
    const xml = new DOMParser().parseFromString(result.source, 'application/xml');
    expect(Array.from(xml.getElementsByTagName('measure'))[2].getElementsByTagName('wedge')).toHaveLength(0);
  });
});

describe('ED-12 measure deletion', () => {
  it('removes a safe first bar and preserves the later bar’s effective attributes', () => {
    const source = rich.replace(/<(?:tie|tied|repeat|ending)[^>]*\/>/g, '');
    const original = readMusicXml(source, 'rich.musicxml');
    const result = deleteMusicXmlMeasure(source, original.score, 0);
    expect(result.noteCount).toBeGreaterThan(0);
    expect(result.labelCount).toBeGreaterThan(0);
    const after = readMusicXml(result.source, 'rich.musicxml');
    expect(after.score.masterBars).toHaveLength(1);
    expect(after.score.masterBars[0].timeSignatureNumerator).toBe(3);
    const xml = new DOMParser().parseFromString(result.source, 'application/xml');
    const remaining = xml.getElementsByTagName('measure')[0];
    expect(remaining.getAttribute('number')).toBe('1');
    expect(remaining.getElementsByTagName('staff-tuning')).toHaveLength(5);
  });

  it('can delete a safe final bar and rejects unsupported inherited attributes', () => {
    const source = rich.replace(/<(?:tie|tied|repeat|ending)[^>]*\/>/g, '');
    const original = readMusicXml(source, 'rich.musicxml');
    const result = deleteMusicXmlMeasure(source, original.score, 1);
    expect(readMusicXml(result.source, 'rich.musicxml').score.masterBars).toHaveLength(1);
    const unsupported = source.replace('<attributes><divisions>1</divisions>',
      '<attributes><transpose><diatonic>0</diatonic><chromatic>2</chromatic></transpose><divisions>1</divisions>');
    expect(() => deleteMusicXmlMeasure(unsupported, original.score, 0))
      .toThrow('unsupported transpose');
  });

  it('blocks the only bar and names repeat, ending, and cross-measure tie dependencies', () => {
    const single = fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8');
    expect(() => deleteMusicXmlMeasure(single, readMusicXml(single, 'single.musicxml').score, 0)).toThrow('last remaining measure');
    const original = readMusicXml(rich, 'rich.musicxml');
    expect(() => deleteMusicXmlMeasure(rich, original.score, 0)).toThrow('repeat endpoint');
    expect(() => deleteMusicXmlMeasure(rich, original.score, 1)).toThrow('ending endpoint');
    const withoutRepeat = rich.replace(/<repeat[^>]*\/>/g, '').replace(/<ending[^>]*\/>/g, '');
    expect(() => deleteMusicXmlMeasure(withoutRepeat, readMusicXml(withoutRepeat, 'rich.musicxml').score, 0))
      .toThrow('cross-measure tie');
  });

  it('materializes inherited 3/4 meter, tuning, and tempo on the next survivor', () => {
    const untied = rich.replace(/<(?:tie|tied|repeat|ending)[^>]*\/>/g, '');
    const third = `<measure number="3">
      <note><rest/><duration>3</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>
      <backup><duration>3</duration></backup><note><rest/><duration>3</duration><voice>3</voice><type>half</type><dot/><staff>1</staff></note>
      <backup><duration>3</duration></backup><note><rest/><duration>3</duration><voice>2</voice><type>half</type><dot/><staff>2</staff></note>
      <backup><duration>3</duration></backup><note><rest/><duration>3</duration><voice>4</voice><type>half</type><dot/><staff>2</staff></note>
    </measure>`;
    const source = untied.replace('</part>', `${third}</part>`);
    const original = readMusicXml(source, 'rich.musicxml');
    const beforeTuning = [...original.score.tracks[0].staves[0].tuning];
    const result = deleteMusicXmlMeasure(source, original.score, 1);
    expect(result).toMatchObject({ noteCount: expect.any(Number), restCount: expect.any(Number) });
    const after = readMusicXml(result.source, 'rich.musicxml');
    expect(after.score.masterBars).toHaveLength(2);
    expect(after.score.masterBars[1].timeSignatureNumerator).toBe(3);
    expect(after.score.tracks[0].staves[0].tuning).toEqual(beforeTuning);
    const xml = new DOMParser().parseFromString(result.source, 'application/xml');
    const next = Array.from(xml.getElementsByTagName('measure'))[1];
    expect(next.getElementsByTagName('time')[0].getElementsByTagName('beats')[0].textContent).toBe('3');
    expect(next.getElementsByTagName('sound')[0].getAttribute('tempo')).toBe('108');
    expect(next.getElementsByTagName('staff-tuning')).toHaveLength(5);
  });
});

describe('ED-13 meter changes', () => {
  const blank = fs.readFileSync('tests/fixtures/editor-pickup.musicxml', 'utf8');

  it('adds a quarter of trailing rest to every voice when 3/4 becomes 4/4', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const result = changeMusicXmlMeter(rich, original.score, 1, 4, 4, 'this');
    expect(result).toMatchObject({ firstMeasure: 2, lastMeasure: 2 });
    const after = readMusicXml(result.source, 'rich.musicxml');
    expect(after.score.masterBars[1].timeSignatureNumerator).toBe(4);
    const measure = Array.from(new DOMParser().parseFromString(result.source, 'application/xml').getElementsByTagName('measure'))[1];
    expect(Array.from(measure.getElementsByTagName('backup')).map(backup => backup.getElementsByTagName('duration')[0].textContent))
      .toEqual(['4', '4', '4']);
    expect(Array.from(measure.getElementsByTagName('note')).filter(note => note.getElementsByTagName('rest').length)).toHaveLength(4);
    expect(Array.from(measure.getElementsByTagName('note')).filter(note => note.getElementsByTagName('rest').length)
      .map(note => note.getElementsByTagName('duration')[0].textContent)).toEqual(['2', '2', '2', '2']);
  });

  it('shrinks removable trailing rest and blocks a voiced final quarter atomically', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const result = changeMusicXmlMeter(rich, original.score, 1, 2, 4, 'this');
    expect(readMusicXml(result.source, 'rich.musicxml').score.masterBars[1].timeSignatureNumerator).toBe(2);
    expect(() => changeMusicXmlMeter(rich, original.score, 0, 3, 4, 'this'))
      .toThrow('Measure 1, voice 1: final time is not removable rest');
  });

  it('reports the exact From here range through the next explicit signature', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const withRest = insertMusicXmlMeasure(rich, original.score, 1, 'after');
    const extended = readMusicXml(withRest, 'rich.musicxml');
    expect(inspectMusicXmlMeterRange(withRest, extended.score, 1, 'from'))
      .toEqual({ firstMeasure: 2, lastMeasure: 3 });
    expect(inspectMusicXmlMeterRange(withRest, extended.score, 1, 'this'))
      .toEqual({ firstMeasure: 2, lastMeasure: 2 });
    expect(() => inspectMusicXmlMeterRange(withRest, extended.score, 9, 'from'))
      .toThrow('selected source measure cannot be identified');
    const result = changeMusicXmlMeter(withRest, extended.score, 1, 4, 4, 'from');
    expect(result).toMatchObject({ firstMeasure: 2, lastMeasure: 3 });
    const changed = readMusicXml(result.source, 'rich.musicxml');
    expect(changed.score.masterBars.map(bar => bar.timeSignatureNumerator)).toEqual([4, 4, 4]);
  });

  it('restores the prior signature at the next inherited bar for This measure', () => {
    const original = readMusicXml(blank, 'pickup.musicxml');
    const result = changeMusicXmlMeter(blank, original.score, 0, 5, 4, 'this');
    const after = readMusicXml(result.source, 'pickup.musicxml');
    expect(after.score.masterBars.map(bar => bar.timeSignatureNumerator)).toEqual([5, 4]);
    const measures = Array.from(new DOMParser().parseFromString(result.source, 'application/xml').getElementsByTagName('measure'));
    expect(measures[1].getElementsByTagName('time')[0].getElementsByTagName('beats')[0].textContent).toBe('4');
    expect(measures[0].getElementsByTagName('note')).toHaveLength(2);
  });

  it('does not resize a bar whose capacity already matches the chosen signature', () => {
    const original = readMusicXml(blank, 'pickup.musicxml');
    const unchanged = changeMusicXmlMeter(blank, original.score, 0, 4, 4, 'this');
    expect(readMusicXml(unchanged.source, 'pickup.musicxml').score.masterBars[0].timeSignatureNumerator).toBe(4);
    expect(new DOMParser().parseFromString(unchanged.source, 'application/xml').getElementsByTagName('measure')[0]
      .getElementsByTagName('note')[0].getElementsByTagName('duration')[0].textContent).toBe('4');
  });

  it('rescales divisions for a fractional meter and restores timing precision at the next bar', () => {
    const original = readMusicXml(blank, 'pickup.musicxml');
    const result = changeMusicXmlMeter(blank, original.score, 0, 7, 8, 'this');
    const xml = new DOMParser().parseFromString(result.source, 'application/xml');
    const measures = Array.from(xml.getElementsByTagName('measure'));
    expect(measures[0].getElementsByTagName('divisions')[0].textContent).toBe('2');
    expect(measures[1].getElementsByTagName('divisions')[0].textContent).toBe('1');
    expect(readMusicXml(result.source, 'pickup.musicxml').score.masterBars.map(bar => bar.timeSignatureNumerator))
      .toEqual([7, 4]);
  });

  it('rejects a later sounding bar in From here without changing any source bytes', () => {
    const original = readMusicXml(blank, 'pickup.musicxml');
    expect(() => changeMusicXmlMeter(blank, original.score, 0, 3, 4, 'from'))
      .toThrow('Measure 2, voice 1: final time is not removable rest');
    expect(blank).toContain('<measure number="2">');
  });

  it('rejects unsupported timing and invalid signatures with named errors', () => {
    const original = readMusicXml(blank, 'pickup.musicxml');
    expect(() => changeMusicXmlMeter(blank, original.score, 0, 13, 4, 'this')).toThrow('numerator from 1–12');
    expect(() => changeMusicXmlMeter(blank, original.score, 9, 3, 4, 'this'))
      .toThrow('selected source measure cannot be identified');
    const forwarded = blank.replace('<measure number="1">',
      '<measure number="1"><forward><duration>1</duration></forward>');
    expect(() => changeMusicXmlMeter(forwarded, original.score, 0, 3, 4, 'this'))
      .toThrow('Measure 1: forward timing');
    const brokenBackup = rich.replace('<backup><duration>3</duration></backup>', '<backup><duration>2</duration></backup>');
    expect(() => changeMusicXmlMeter(brokenBackup, readMusicXml(rich, 'rich.musicxml').score, 1, 4, 4, 'this'))
      .toThrow('Measure 2: voice timing');
  });

  it('retains an existing pickup’s actual length when its nominal signature changes', () => {
    const original = readMusicXml(blank, 'pickup.musicxml');
    const picked = changeMusicXmlPickup(blank, original.score, 1, 8);
    const score = readMusicXml(picked, 'pickup.musicxml').score;
    const changed = changeMusicXmlMeter(picked, score, 0, 3, 4, 'this');
    const first = new DOMParser().parseFromString(changed.source, 'application/xml').getElementsByTagName('measure')[0];
    expect(first.getAttribute('implicit')).toBe('yes');
    expect(first.getElementsByTagName('duration')[0].textContent).toBe('1');
    expect(readMusicXml(changed.source, 'pickup.musicxml').score.masterBars[0].timeSignatureNumerator).toBe(3);
    expect(() => changeMusicXmlMeter(picked, score, 0, 1, 8, 'this')).toThrow('pickup must remain shorter');
  });

  it('fails closed on malformed voice and signature source layouts', () => {
    const original = readMusicXml(blank, 'pickup.musicxml');
    const empty = blank.replace('<note><rest/><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>', '');
    expect(() => changeMusicXmlMeter(empty, original.score, 0, 3, 4, 'this')).toThrow('no source voices');
    const oddStaff = blank.replace('<staff>1</staff></note>', '<staff>0</staff></note>');
    expect(() => changeMusicXmlMeter(oddStaff, original.score, 0, 3, 4, 'this')).toThrow('unsupported staff number');
    const orphan = blank.replace('<note><rest/>', '<note><chord/><rest/>');
    expect(() => changeMusicXmlMeter(orphan, original.score, 0, 3, 4, 'this')).toThrow('orphaned chord');
    const short = blank.replace('<duration>4</duration><voice>1</voice><type>whole', '<duration>3</duration><voice>1</voice><type>whole');
    expect(() => changeMusicXmlMeter(short, original.score, 0, 3, 4, 'this')).toThrow('source timing does not match');
    const repeated = blank.replace('<time><beats>4</beats><beat-type>4</beat-type></time>',
      '<time><beats>4</beats><beat-type>4</beat-type></time><time><beats>4</beats><beat-type>4</beat-type></time>');
    expect(() => changeMusicXmlMeter(repeated, original.score, 0, 3, 4, 'this')).toThrow('Multiple source signatures');
  });
});

describe('ED-13 pickup length', () => {
  it('resizes a first rest bar to one eighth without leading silence and can resize it again', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const withRest = insertMusicXmlMeasure(rich, original.score, 0, 'before');
    const score = readMusicXml(withRest, 'rich.musicxml').score;
    const eighth = changeMusicXmlPickup(withRest, score, 1, 8);
    const xml = new DOMParser().parseFromString(eighth, 'application/xml');
    const first = xml.getElementsByTagName('measure')[0];
    expect(first.getAttribute('implicit')).toBe('yes');
    expect(Array.from(first.getElementsByTagName('backup')).map(item => item.getElementsByTagName('duration')[0].textContent))
      .toEqual(['1', '1', '1']);
    expect(Array.from(first.getElementsByTagName('note')).map(item => item.getElementsByTagName('duration')[0].textContent))
      .toEqual(['1', '1', '1', '1']);
    const imported = readMusicXml(eighth, 'pickup.musicxml');
    expect(imported.score.masterBars[0].isAnacrusis).toBe(true);
    expect(imported.score.masterBars[0].calculateDuration()).toBe(480);
    expect(imported.score.tracks[0].staves[0].bars[0].voices.filter(voice => !voice.isEmpty)
      .every(voice => voice.beats[0].playbackStart === 0)).toBe(true);
    const quarter = changeMusicXmlPickup(eighth, imported.score, 1, 4);
    expect(readMusicXml(quarter, 'pickup.musicxml').score.masterBars[0].isAnacrusis).toBe(true);
  });

  it('rejects an invalid or sounding-note pickup without mutation', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    expect(() => changeMusicXmlPickup(rich, original.score, 4, 4)).toThrow('shorter');
    expect(() => changeMusicXmlPickup(rich, original.score, 1, 8)).toThrow('Measure 1, voice 1');
  });

  it('rejects nonpositive pickup values and a source without a first measure', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    expect(() => changeMusicXmlPickup(rich, original.score, 0, 8)).toThrow('positive pickup length');
    expect(() => changeMusicXmlPickup('<score-partwise/>', original.score, 1, 8)).toThrow('first source measure');
  });
});

describe('ED-14 tie endpoint foundation', () => {
  const untied = rich.replace(/<(?:tie|tied) type="(?:start|stop)"\/>/g, '');
  const origin = { measure: 0, beat: 4, voice: 2, string: 4, fret: 4 };
  const destination = { measure: 1, beat: 0, voice: 2, string: 4, fret: 4 };

  it('writes both endpoints to TAB and paired notation, then removes only the named tie', () => {
    const score = readMusicXml(untied, 'rich.musicxml').score;
    const tied = connectMusicXmlTie(untied, score, origin, destination);
    const xml = new DOMParser().parseFromString(tied, 'application/xml');
    const measures = Array.from(xml.getElementsByTagName('measure'));
    expect(measures[0].getElementsByTagName('tie')).toHaveLength(2);
    expect(measures[1].getElementsByTagName('tie')).toHaveLength(2);
    expect(measures[0].getElementsByTagName('tied')).toHaveLength(2);
    expect(measures[1].getElementsByTagName('tied')).toHaveLength(2);
    expect(inspectMusicXmlTie(tied, readMusicXml(tied, 'rich.musicxml').score, origin).canRemove).toBe(true);
    const removed = removeMusicXmlTie(tied, readMusicXml(tied, 'rich.musicxml').score, destination);
    expect(new DOMParser().parseFromString(removed, 'application/xml').getElementsByTagName('tie')).toHaveLength(0);
    expect(removed).toContain('<hammer-on');
    expect(removed).toContain('<slide');
  });

  it('rejects wrong string, voice, direction, skipped same-string note, changed pitch, and competing marks', () => {
    const score = readMusicXml(untied, 'rich.musicxml').score;
    expect(() => connectMusicXmlTie(untied, score, origin, { ...destination, string: 3 })).toThrow('same string');
    expect(() => connectMusicXmlTie(untied, score, origin, { ...destination, voice: 1 })).toThrow('same voice');
    expect(() => connectMusicXmlTie(untied, score, destination, origin)).toThrow('must follow');
    expect(() => connectMusicXmlTie(untied, score, { measure: 0, beat: 1, voice: 2, string: 4, fret: 0 }, destination))
      .toThrow('Another event or rest');
    expect(() => connectMusicXmlTie(untied, score, { measure: 0, beat: 2, voice: 2, string: 4, fret: 2 },
      { measure: 0, beat: 3, voice: 2, string: 4, fret: 4 })).toThrow('same pitch');
    const withTie = connectMusicXmlTie(untied, score, origin, destination);
    expect(() => connectMusicXmlTie(withTie, readMusicXml(withTie, 'rich.musicxml').score, origin, destination))
      .toThrow('competing transition');
  });

  it('does not connect notes separated by an ordinary rest across a barline', () => {
    const fixture = fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8');
    const withGap = fixture.replace('<duration>4</duration><voice>1</voice><type>whole</type>',
      '<duration>1</duration><voice>1</voice><type>quarter</type>')
      .replace('</notations></note>', '</notations></note><note><rest/><duration>3</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>');
    const score = readMusicXml(withGap, 'gap.musicxml').score;
    expect(() => connectMusicXmlTie(withGap, score,
      { measure: 0, beat: 0, voice: 1, string: 4, fret: 0 },
      { measure: 1, beat: 0, voice: 1, string: 4, fret: 0 })).toThrow('Another event or rest');
  });

  it('removes an imported outgoing tie without disturbing other effects and blocks tied pitch correction', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    expect(inspectMusicXmlTie(untied, readMusicXml(untied, 'rich.musicxml').score, origin).canRemove).toBe(false);
    expect(() => removeMusicXmlTie(untied, original.score, origin)).toThrow('no tie to remove');
    const removed = removeMusicXmlTie(rich, original.score, origin);
    expect(new DOMParser().parseFromString(removed, 'application/xml').getElementsByTagName('tie')).toHaveLength(0);
    expect(removed).toContain('<hammer-on');
    expect(removed).toContain('<slide');
    const state = musicXmlEditorState(rich, original.score);
    const note = state.notes.find(item => item.measure === 0 && item.beat === 4 && item.string === 4 && item.fret === 4)!;
    note.fret = 5;
    expect(() => applyMusicXmlEdits(rich, state, [note.index])).toThrow('This note is tied');
  });

  it('retains both tie endpoints through an unrelated isolated fret correction', () => {
    const original = readMusicXml(rich, 'rich.musicxml');
    const state = musicXmlEditorState(rich, original.score);
    const unrelated = state.notes.find(item => item.measure === 1 && item.beat === 1 && item.string === 4 && item.fret === 2)!;
    unrelated.fret = 3;
    const changed = applyMusicXmlEdits(rich, state, [unrelated.index]);
    const xml = new DOMParser().parseFromString(changed, 'application/xml');
    expect(xml.getElementsByTagName('tie')).toHaveLength(4);
    expect(xml.getElementsByTagName('tied')).toHaveLength(4);
  });
});

describe('ED-15 repeat authoring foundation', () => {
  const source = (() => {
    const document = new DOMParser().parseFromString(fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8'), 'application/xml');
    const part = document.getElementsByTagName('part')[0];
    const first = document.getElementsByTagName('measure')[0];
    part.removeChild(document.getElementsByTagName('measure')[1]);
    const pitches = [
      ['D', '', '3'], ['D', '1', '3'], ['E', '', '3'], ['F', '', '3'], ['F', '1', '3'],
    ];
    for (let index = 0; index < 5; index++) {
      const measure = index === 0 ? first : first.cloneNode(true) as typeof first;
      measure.setAttribute('number', String(index + 1));
      const pitch = measure.getElementsByTagName('pitch')[0];
      pitch.getElementsByTagName('step')[0].textContent = pitches[index][0];
      pitch.getElementsByTagName('octave')[0].textContent = pitches[index][2];
      if (pitches[index][1]) {
        const alter = document.createElement('alter'); alter.textContent = pitches[index][1];
        pitch.insertBefore(alter, pitch.getElementsByTagName('octave')[0]);
      }
      measure.getElementsByTagName('fret')[0].textContent = String(index);
      if (index) part.appendChild(measure);
    }
    return new XMLSerializer().serializeToString(document);
  })();

  it('plays a 2–4 repeat twice in written order', () => {
    const original = readMusicXml(source, 'repeat.musicxml');
    const repeated = addMusicXmlRepeat(source, original.score, 1, 3, 2);
    const after = readMusicXml(repeated, 'repeat.musicxml');
    expect(after.score.masterBars[1].isRepeatStart).toBe(true);
    expect(after.score.masterBars[3].repeatCount).toBe(2);
    const file = new midi.MidiFile();
    new midi.MidiFileGenerator(after.score, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
    expect(file.events.filter((event): event is midi.NoteOnEvent => event instanceof midi.NoteOnEvent)
      .map(event => event.noteKey)).toEqual([50, 51, 52, 53, 51, 52, 53, 54]);
  });

  it('rejects overlapping and nested repeats while allowing disjoint regions', () => {
    const original = readMusicXml(source, 'repeat.musicxml');
    const first = addMusicXmlRepeat(source, original.score, 0, 1, 2);
    expect(() => addMusicXmlRepeat(first, readMusicXml(first, 'repeat.musicxml').score, 1, 3, 2))
      .toThrow('overlapping repeat regions');
    const separate = addMusicXmlRepeat(first, readMusicXml(first, 'repeat.musicxml').score, 2, 4, 2);
    expect(readMusicXml(separate, 'repeat.musicxml').score.masterBars[2].isRepeatStart).toBe(true);
    expect(() => addMusicXmlRepeat(source, original.score, 3, 1, 2)).toThrow('start before its end');
    expect(() => addMusicXmlRepeat(source, original.score, 1, 3, 9)).toThrow('from 2 to 8');
  });

  it('reports existing regions and refuses imported endings or unsafe repeat maps', () => {
    const original = readMusicXml(source, 'repeat.musicxml');
    expect(() => inspectMusicXmlRepeats('<score-partwise version="4.0"/>')).toThrow('no music part');
    expect(() => addMusicXmlRepeat('<score-partwise version="4.0"/>', original.score, 0, 1, 2))
      .toThrow('do not match the rendered score');
    expect(() => addMusicXmlRepeat(source, readMusicXml(fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8'), 'tie.musicxml').score, 0, 1, 2))
      .toThrow('do not match the rendered score');
    const repeated = addMusicXmlRepeat(source, original.score, 0, 1, 2);
    expect(inspectMusicXmlRepeats(repeated)).toEqual([{ start: 0, end: 1, count: 2 }]);
    const withMarker = (input: string, measureIndex: number, direction: string, times?: string) => {
      const document = new DOMParser().parseFromString(input, 'application/xml');
      const measure = document.getElementsByTagName('measure')[measureIndex];
      const barline = document.createElement('barline');
      const repeat = document.createElement('repeat');
      repeat.setAttribute('direction', direction);
      if (times) repeat.setAttribute('times', times);
      barline.appendChild(repeat); measure.appendChild(barline);
      return new XMLSerializer().serializeToString(document);
    };
    expect(() => inspectMusicXmlRepeats(withMarker(source, 2, 'backward'))).toThrow('no explicit start');
    expect(() => inspectMusicXmlRepeats(withMarker(source, 0, 'forward'))).toThrow('has no end');
    expect(() => inspectMusicXmlRepeats(withMarker(repeated, 0, 'forward'))).toThrow('Nested or overlapping');
    expect(() => inspectMusicXmlRepeats(withMarker(source, 0, 'sideways'))).toThrow('unsupported direction');
    expect(() => inspectMusicXmlRepeats(withMarker(withMarker(source, 0, 'forward'), 2, 'backward', '1')))
      .toThrow('unsupported play count');
    const huge = withMarker(withMarker(source, 0, 'forward'), 1, 'backward', '5000');
    expect(() => addMusicXmlRepeat(huge, original.score, 2, 4, 2)).toThrow('exceed 4096');
    const document = new DOMParser().parseFromString(source, 'application/xml');
    document.getElementsByTagName('measure')[0].appendChild(document.createElement('ending'));
    expect(() => addMusicXmlRepeat(new XMLSerializer().serializeToString(document), original.score, 1, 3, 2))
      .toThrow('Existing repeat endings');
  });

  it('plays first and second endings in their assigned passes', () => {
    const document = new DOMParser().parseFromString(source, 'application/xml');
    const last = document.getElementsByTagName('measure')[4];
    const sixth = last.cloneNode(true) as typeof last;
    sixth.setAttribute('number', '6');
    sixth.getElementsByTagName('step')[0].textContent = 'G';
    sixth.getElementsByTagName('alter')[0]?.parentNode?.removeChild(sixth.getElementsByTagName('alter')[0]);
    sixth.getElementsByTagName('fret')[0].textContent = '5';
    last.parentNode!.appendChild(sixth);
    const sixBars = new XMLSerializer().serializeToString(document);
    const original = readMusicXml(sixBars, 'ending.musicxml');
    const repeated = addMusicXmlRepeat(sixBars, original.score, 1, 3, 2);
    const withEndings = addMusicXmlEndings(repeated, readMusicXml(repeated, 'ending.musicxml').score, 1, 3, 3, 4);
    expect(inspectMusicXmlRepeatEndings(withEndings, 1, 3))
      .toEqual({ firstStart: 3, firstEnd: 3, secondStart: 4, secondEnd: 4 });
    const after = readMusicXml(withEndings, 'ending.musicxml');
    const file = new midi.MidiFile();
    new midi.MidiFileGenerator(after.score, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
    expect(file.events.filter((event): event is midi.NoteOnEvent => event instanceof midi.NoteOnEvent)
      .map(event => event.noteKey)).toEqual([50, 51, 52, 53, 51, 52, 54, 55]);
    expect(linearAuditionMidi(after.score).events.filter((event): event is midi.NoteOnEvent => event instanceof midi.NoteOnEvent)
      .map(event => event.noteKey)).toEqual([50, 51, 52, 53, 54, 55]);
    const firstBeat = after.score.tracks[0].staves[0].bars[1].voices[0].beats[0];
    const lastBeat = after.score.tracks[0].staves[0].bars[3].voices[0].beats[0];
    expect(writtenPlaybackRange(after.score, { start: selectionFromBeat(firstBeat), end: selectionFromBeat(lastBeat) }))
      .toEqual({ startTick: after.score.masterBars[1].start,
        endTick: after.score.masterBars[3].start + lastBeat.playbackDuration });
    const cleared = removeMusicXmlRepeat(withEndings, after.score, 1, 3);
    expect(inspectMusicXmlRepeats(cleared)).toEqual([]);
    expect(new DOMParser().parseFromString(cleared, 'application/xml').getElementsByTagName('ending')).toHaveLength(0);
    expect(readMusicXml(cleared, 'ending.musicxml').score.masterBars).toHaveLength(6);
    expect(() => addMusicXmlEndings(repeated, readMusicXml(repeated, 'ending.musicxml').score, 1, 3, 1, 4))
      .not.toThrow();
    expect(() => addMusicXmlEndings(repeated, readMusicXml(repeated, 'ending.musicxml').score, 1, 3, 0, 4))
      .toThrow('inside its repeat');
    expect(() => addMusicXmlEndings(repeated, readMusicXml(repeated, 'ending.musicxml').score, 1, 3, 3, 3))
      .toThrow('immediately after');
  });

  it('rejects unsafe ending and removal targets without changing source', () => {
    const original = readMusicXml(source, 'repeat.musicxml');
    const repeated = addMusicXmlRepeat(source, original.score, 1, 3, 2);
    const repeatedScore = readMusicXml(repeated, 'repeat.musicxml').score;
    expect(() => addMusicXmlEndings(source, original.score, 1, 3, 3, 4)).toThrow('known repeat region');
    expect(() => addMusicXmlEndings(repeated, original.score, 0, 3, 3, 4)).toThrow('known repeat region');
    const three = addMusicXmlRepeat(source, original.score, 1, 3, 3);
    expect(() => addMusicXmlEndings(three, readMusicXml(three, 'repeat.musicxml').score, 1, 3, 3, 4))
      .toThrow('count of 2');
    const separate = addMusicXmlRepeat(addMusicXmlRepeat(source, original.score, 0, 1, 2), original.score, 2, 3, 2);
    expect(() => addMusicXmlEndings(separate, readMusicXml(separate, 'repeat.musicxml').score, 0, 1, 1, 2))
      .toThrow('overlap another repeat');
    const withEndings = addMusicXmlEndings(repeated, repeatedScore, 1, 3, 3, 4);
    expect(() => addMusicXmlEndings(withEndings, readMusicXml(withEndings, 'repeat.musicxml').score, 1, 3, 3, 4))
      .toThrow('Imported endings');
    expect(() => inspectMusicXmlRepeatEndings(repeated, 0, 3)).toThrow('cannot be identified');
    expect(() => removeMusicXmlRepeat(repeated, repeatedScore, 0, 3)).toThrow('cannot be identified');
    const malformed = new DOMParser().parseFromString(withEndings, 'application/xml');
    const endingStops = Array.from(malformed.getElementsByTagName('ending')).filter(item => item.getAttribute('type') === 'stop');
    endingStops[1].parentNode!.removeChild(endingStops[1]);
    const incomplete = new XMLSerializer().serializeToString(malformed);
    expect(() => inspectMusicXmlRepeatEndings(incomplete, 1, 3)).toThrow('preserved but cannot be edited safely');
    expect(() => removeMusicXmlRepeat(incomplete, repeatedScore, 1, 3)).toThrow('preserved but cannot be edited safely');
    expect(incomplete).toContain('ending');
    expect(() => inspectMusicXmlRepeatEndings('<score-partwise version="4.0"/>', 1, 3)).toThrow('no music part');
    expect(() => removeMusicXmlRepeat('<score-partwise version="4.0"/>', repeatedScore, 1, 3))
      .toThrow('do not match');
    expect(() => addMusicXmlEndings('<score-partwise version="4.0"/>', repeatedScore, 1, 3, 3, 4))
      .toThrow('do not match');
    const relocated = new DOMParser().parseFromString(repeated, 'application/xml');
    const backward = relocated.getElementsByTagName('repeat')[1];
    (backward.parentNode as typeof backward).setAttribute('location', 'left');
    expect(() => removeMusicXmlRepeat(new XMLSerializer().serializeToString(relocated), repeatedScore, 1, 3))
      .toThrow('endpoint changed');
  });

  it('allows a separate repeat after a completed ending pair but not across it', () => {
    const original = readMusicXml(source, 'repeat.musicxml');
    const first = addMusicXmlRepeat(source, original.score, 0, 1, 2);
    const endings = addMusicXmlEndings(first, readMusicXml(first, 'repeat.musicxml').score, 0, 1, 1, 2);
    const score = readMusicXml(endings, 'repeat.musicxml').score;
    expect(() => addMusicXmlRepeat(endings, score, 2, 3, 2)).toThrow('overlap existing first or second endings');
    const separate = addMusicXmlRepeat(endings, score, 3, 4, 2);
    expect(inspectMusicXmlRepeats(separate)).toEqual([{ start: 0, end: 1, count: 2 }, { start: 3, end: 4, count: 2 }]);
    expect(inspectMusicXmlRepeatEndings(separate, 0, 1))
      .toEqual({ firstStart: 1, firstEnd: 1, secondStart: 2, secondEnd: 2 });
  });
});
