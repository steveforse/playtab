import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { midi, Settings } from '@coderline/alphatab';
import { linearAuditionMidi, writtenPlaybackRange } from '../../app/frontend/editor/audition';
import { selectionFromBeat } from '../../app/frontend/Player';
import { readMusicXml } from '../../app/frontend/music/musicxml';
import { addMusicXmlEndings, addMusicXmlGraceGroup, addMusicXmlRepeat, applyMusicXmlEdits, applyMusicXmlGraceGroup, inspectMusicXmlGraceGroup, removeMusicXmlGrace, removeMusicXmlGraceGroup, changeMusicXmlMeter, changeMusicXmlPickup, connectMusicXmlTie, deleteMusicXmlMeasure, duplicateMusicXmlMeasure, insertMusicXmlMeasure,
  inspectMusicXmlRepeatEndings, inspectMusicXmlRepeats, removeMusicXmlRepeat,
  inspectMusicXmlTie, removeMusicXmlTie,
  inspectMusicXmlMeterRange, musicXmlEditorState, addMusicXmlNote, inspectMusicXmlNoteTechniques, setMusicXmlBend, setMusicXmlHand, changeMusicXmlAnchor, inspectMusicXmlAnchor, removeMusicXmlNotes,
  inspectMusicXmlLyrics, setMusicXmlLyric, setMusicXmlStandaloneLyrics, applyMusicXmlScoreSettings, inspectMusicXmlScoreSettings,
  inspectMusicXmlTempo, setMusicXmlLocalTempo, connectMusicXmlTransition, inspectMusicXmlTransitions, removeMusicXmlTransition, copyMusicXmlMeasures, pasteMusicXmlMeasures, cutMusicXmlMeasures,
  type ChordSpelling } from '../../app/frontend/music/musicxml-editor';

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

describe('ED-14 hammer-on, pull-off and slide authoring', () => {
  const tie = fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8');
  const crossBar = tie.replace(/(<measure number="2">[\s\S]*?<step>)D(<\/step>[\s\S]*?<fret>)0(<\/fret>)/, '$1E$2' + '2$3');
  const score = (source: string) => readMusicXml(source, 'transition.musicxml').score;
  const m1 = { measure: 0, beat: 0, voice: 1, string: 4, fret: 0 };
  const m2 = { measure: 1, beat: 0, voice: 1, string: 4, fret: 2 };

  it('writes a cross-bar hammer-on that renders, plays legato and reopens, and a slide between different frets', () => {
    expect(crossBar).toContain('<fret>2</fret>');
    const hammer = connectMusicXmlTransition(crossBar, score(crossBar), 'hammer-on', m1, m2);
    expect(hammer).toContain('<hammer-on type="start">H</hammer-on>');
    expect(hammer).toContain('<hammer-on type="stop"/>');
    const after = score(hammer);
    const origin = after.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
    expect(origin.isHammerPullOrigin).toBe(true);
    expect(origin.hammerPullDestination?.beat.voice.bar.index).toBe(1);
    const file = new midi.MidiFile();
    new midi.MidiFileGenerator(after, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
    expect(file.events.some(event => event instanceof midi.NoteBendEvent && (event as midi.NoteBendEvent & { isHammerPull?: boolean }).isHammerPull)).toBe(true);
    expect(inspectMusicXmlTransitions(hammer, after, m1)).toEqual([{ kind: 'hammer-on', direction: 'outgoing', other: { measure: 2, event: 1, fret: 2 } }]);
    expect(inspectMusicXmlTransitions(hammer, after, m2)).toEqual([{ kind: 'hammer-on', direction: 'incoming', other: { measure: 1, event: 1, fret: 0 } }]);
    expect(removeMusicXmlTransition(hammer, after, m2, 'hammer-on', 'incoming')).toBe(new XMLSerializer().serializeToString(new DOMParser().parseFromString(crossBar, 'application/xml')));
    const slide = connectMusicXmlTransition(crossBar, score(crossBar), 'slide', m1, m2);
    expect(slide.match(/<slide type="(start|stop)" number="1"\/>/g)).toHaveLength(2);
    expect(score(slide).tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].slideOutType).not.toBe(0);
    expect(removeMusicXmlTransition(slide, score(slide), m1, 'slide', 'outgoing')).not.toContain('<slide');
    const pull = crossBar.replace('<fret>0</fret>', '<fret>5</fret>').replace(/<step>D<\/step>/, '<step>G</step>');
    expect(connectMusicXmlTransition(pull, score(pull), 'pull-off', { ...m1, fret: 5 }, m2)).toContain('<pull-off type="start">PO</pull-off>');
  });

  it('writes and removes a pull-off on both paired staves, keeping fingering and other spans', () => {
    const rich2 = { measure: 1, beat: 0, voice: 2, string: 4, fret: 4 };
    const e2 = { measure: 1, beat: 1, voice: 2, string: 4, fret: 2 };
    const pulled = connectMusicXmlTransition(rich, readMusicXml(rich, 'rich.musicxml').score, 'pull-off', rich2, e2);
    expect(pulled.match(/<pull-off type="start">PO<\/pull-off>/g)).toHaveLength(2);
    expect(pulled.match(/<pull-off type="stop"\/>/g)).toHaveLength(2);
    const pulledScore = readMusicXml(pulled, 'rich.musicxml').score;
    expect(inspectMusicXmlTransitions(pulled, pulledScore, rich2).map(item => `${item.kind}:${item.direction}`)).toEqual(['tie:incoming', 'pull-off:outgoing']);
    expect(removeMusicXmlTransition(pulled, pulledScore, rich2, 'pull-off', 'outgoing')).toBe(new XMLSerializer().serializeToString(new DOMParser().parseFromString(rich, 'application/xml')));
    const e = { measure: 0, beat: 2, voice: 2, string: 4, fret: 2 };
    const noHammer = removeMusicXmlTransition(rich, readMusicXml(rich, 'rich.musicxml').score, e, 'hammer-on', 'incoming');
    expect(noHammer).not.toContain('hammer-on');
    expect(noHammer).toContain('<fingering enclosure="circle">1</fingering><other-technical>TEF fingering T</other-technical>');
    expect(noHammer.match(/<slide number="1" type="start"\/>/g)).toHaveLength(2);
    expect(() => removeMusicXmlTransition(rich, readMusicXml(rich, 'rich.musicxml').score, e, 'pull-off', 'outgoing')).toThrow('has no pull-off to remove');
    expect(removeMusicXmlTransition(rich, readMusicXml(rich, 'rich.musicxml').score, { ...rich2, measure: 0, beat: 4 }, 'tie', 'outgoing')).not.toContain('<tied type="start"/>');
  });

  it('leaves the document unchanged with a specific error for invalid endpoints', () => {
    const s = score(crossBar);
    expect(() => connectMusicXmlTransition(crossBar, s, 'hammer-on', m1, { ...m2, string: 3 })).toThrow('must stay on the same string');
    expect(() => connectMusicXmlTransition(crossBar, s, 'hammer-on', m1, { ...m2, voice: 2 })).toThrow('must stay in the same voice');
    expect(() => connectMusicXmlTransition(crossBar, s, 'hammer-on', m2, m1)).toThrow('must come after the origin');
    expect(() => connectMusicXmlTransition(crossBar, s, 'pull-off', m1, m2)).toThrow('A pull-off must go to a lower fret.');
    expect(() => connectMusicXmlTransition(crossBar, s, 'hammer-on', { ...m1, fret: 3 }, m2)).toThrow('cannot be uniquely identified');
    const same = score(tie);
    expect(() => connectMusicXmlTransition(tie, same, 'slide', m1, { ...m2, fret: 0 })).toThrow('A slide must go to a different fret.');
    expect(() => connectMusicXmlTransition(tie, same, 'hammer-on', m1, { ...m2, fret: 0 })).toThrow('A hammer-on must go to a higher fret.');
    const richScore = readMusicXml(rich, 'rich.musicxml').score;
    expect(() => connectMusicXmlTransition(rich, richScore, 'slide', { measure: 0, beat: 1, voice: 2, string: 4, fret: 0 }, { measure: 0, beat: 3, voice: 2, string: 4, fret: 4 }))
      .toThrow('Another note on string 4 comes first.');
    expect(() => connectMusicXmlTransition(rich, richScore, 'slide', { measure: 0, beat: 1, voice: 2, string: 4, fret: 0 }, { measure: 0, beat: 2, voice: 2, string: 4, fret: 2 }))
      .toThrow('The origin already starts a tie or transition.');
    const hammer = connectMusicXmlTransition(crossBar, s, 'hammer-on', m1, m2);
    expect(() => connectMusicXmlTransition(hammer, score(hammer), 'tie', m1, m2)).toThrow();
    expect(() => removeMusicXmlTransition(crossBar.replace('<fret>2</fret>', '<fret>2</fret><hammer-on type="stop"/>'), s, m2, 'hammer-on', 'incoming'))
      .toThrow('The other hammer-on endpoint cannot be identified safely.');
  });

  it('rejects a fret edit that would invalidate an existing span, while unrelated edits keep chains', () => {
    const richScore = readMusicXml(rich, 'rich.musicxml').score;
    const state = musicXmlEditorState(rich, richScore);
    const e = state.notes.find(note => note.measure === 0 && note.voice === 1 && note.beat === 2 && note.string === 4)!;
    e.fret = 0;
    expect(() => applyMusicXmlEdits(rich, state, [e.index])).toThrow('This change would make the existing hammer-on invalid. Remove that hammer-on first.');
    const slideState = musicXmlEditorState(rich, richScore);
    const f = slideState.notes.find(note => note.measure === 0 && note.voice === 1 && note.beat === 3 && note.string === 4)!;
    f.fret = 2;
    expect(() => applyMusicXmlEdits(rich, slideState, [f.index])).toThrow('existing slide invalid');
    const unrelated = musicXmlEditorState(rich, richScore);
    const later = unrelated.notes.find(note => note.measure === 1 && note.voice === 1 && note.beat === 1 && note.string === 4)!;
    later.fret = 3;
    const edited = applyMusicXmlEdits(rich, unrelated, [later.index]);
    expect(edited).toContain('<hammer-on type="start">H</hammer-on>');
    expect(edited.match(/<slide number="1" type="start"\/>/g)).toHaveLength(2);
  });
});

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
    expect(inspectMusicXmlScoreSettings(rich, score())).toEqual({ ...base, mode: undefined, tuningRange: { first: 1, last: 1 } });
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

  it('rejects invalid settings before any change', () => {
    for (const [change, message] of [[{ title: ' ' }, 'Title must be 1–160'], [{ title: 'x'.repeat(161) }, 'Title must be 1–160'],
      [{ tempo: 29 }, 'from 30 to 240 BPM'], [{ tempo: 120.5 }, 'from 30 to 240 BPM'], [{ tuning: [62, 59, 55, 50] }, 'MIDI pitch from 36 to 96'],
      [{ tuning: [62, 59, 55, 50, 97] }, 'MIDI pitch from 36 to 96'], [{ mode: 'strings' }, 'Keep frets or Keep pitches']] as const) {
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

describe('ED-18 timed and standalone lyrics', () => {
  const score = (source = rich) => readMusicXml(source, 'rich.musicxml').score;
  const m1e2 = { measure: 0, beat: 1, voice: 1 };
  const m1e3 = { measure: 0, beat: 2, voice: 1 };
  const lyricXml = (source: string) => Array.from(new DOMParser().parseFromString(source, 'application/xml').getElementsByTagName('lyric'))
    .map(lyric => `${lyric.getAttribute('number') || '-'}:${lyric.getElementsByTagName('syllabic')[0]?.textContent}:${lyric.getElementsByTagName('text')[0]?.textContent}`);

  it('edits one verse on the selected event in both staves and leaves other verses alone', () => {
    expect(inspectMusicXmlLyrics(rich, score(), m1e2)).toEqual([{ verse: 1, text: 'Low', syllabic: 'single' }]);
    const second = setMusicXmlLyric(rich, score(), m1e2, 2, { text: ' High ', syllabic: 'begin' });
    expect(lyricXml(second)).toEqual(['-:single:Low', '2:begin:High', '-:single:Low', '2:begin:High']);
    const changed = setMusicXmlLyric(second, score(second), m1e2, 1, { text: 'Lo', syllabic: 'end' });
    expect(lyricXml(changed)).toEqual(['1:end:Lo', '2:begin:High', '1:end:Lo', '2:begin:High']);
    expect(inspectMusicXmlLyrics(changed, score(changed), m1e2)).toEqual([{ verse: 1, text: 'Lo', syllabic: 'end' }, { verse: 2, text: 'High', syllabic: 'begin' }]);
    const beat = score(changed).tracks[0].staves[0].bars[0].voices[1].beats[1];
    expect(beat.lyrics).toEqual(['Lo', 'High']);
    const next = setMusicXmlLyric(changed, score(changed), m1e3, 1, { text: 'down', syllabic: 'single' });
    expect(inspectMusicXmlLyrics(next, score(next), m1e3)).toEqual([{ verse: 1, text: 'down', syllabic: 'single' }]);
    expect(inspectMusicXmlLyrics(next, score(next), m1e2)).toHaveLength(2);
    const removed = setMusicXmlLyric(next, score(next), m1e2, 2, null);
    expect(lyricXml(removed)).toEqual(['1:end:Lo', '1:single:down', '1:end:Lo', '1:single:down']);
    expect(setMusicXmlLyric(removed, score(removed), m1e2, 2, null)).toBe(removed);
    expect(removed).toContain('<hammer-on type="start">H</hammer-on>');
  });

  it('requires Remove lyric for empty text and enforces limits before mutation', () => {
    expect(() => setMusicXmlLyric(rich, score(), m1e2, 1, { text: '  ', syllabic: 'single' })).toThrow('Use Remove lyric to clear a verse.');
    expect(() => setMusicXmlLyric(rich, score(), m1e2, 1, { text: 'x'.repeat(161), syllabic: 'single' })).toThrow('1–160 characters');
    expect(() => setMusicXmlLyric(rich, score(), m1e2, 9, { text: 'x', syllabic: 'single' })).toThrow('verse from 1 to 8');
    expect(() => setMusicXmlLyric(rich, score(), m1e2, 1, { text: 'x', syllabic: 'both' as 'single' })).toThrow('Single, Begin, Middle, or End');
    expect(() => inspectMusicXmlLyrics(rich, score(), { measure: 0, beat: 0, voice: 1 })).toThrow('Select an ordinary event');
  });

  it('keeps unfamiliar lyric settings read-only', () => {
    const variants: [string, string][] = [
      ['<lyric><syllabic>single</syllabic><text>Low</text><extend/></lyric>', 'Verse 1 has an extension line; it is kept as written.'],
      ['<lyric><syllabic>single</syllabic><text>Low</text><elision/><text>er</text></lyric>', 'Verse 1 has a elision setting; it is kept as written.'],
      ['<lyric default-y="-80"><syllabic>single</syllabic><text>Low</text></lyric>', 'Verse 1 has lyric styling; it is kept as written.'],
      ['<lyric><syllabic>single</syllabic><text>Low</text></lyric><lyric number="1"><text>Again</text></lyric>', 'Verse 1 has more than one lyric on this event; it is kept as written.'],
      ['<lyric number="chorus"><syllabic>single</syllabic><text>Low</text></lyric>', 'The lyric verse “chorus” is kept as written.'],
    ];
    for (const [lyric, reason] of variants) {
      const source = rich.replaceAll('<lyric><syllabic>single</syllabic><text>Low</text></lyric>', lyric);
      const found = inspectMusicXmlLyrics(source, score(source), m1e2);
      expect(found.map(item => item.reason)).toContain(reason);
      if (!lyric.includes('chorus')) expect(() => setMusicXmlLyric(source, score(source), m1e2, 1, { text: 'x', syllabic: 'single' })).toThrow(reason);
    }
    const layout = rich.replaceAll('<syllabic>single</syllabic><text>Low</text>', '<syllabic>single</syllabic><text>Low</text><text>er</text>');
    expect(inspectMusicXmlLyrics(layout, score(layout), m1e2)[0].reason).toContain('lyric layout');
  });

  it('keeps an event lyric when its first chord note is removed', () => {
    const chord = addMusicXmlNote(rich, score(), { measure: 0, beat: 1, voice: 1, string: 5, fret: 0 });
    const removed = removeMusicXmlNotes(chord, score(chord), { measure: 0, beat: 1, voice: 1, string: 4 })!;
    expect(removed.source.match(/<text>Low<\/text>/g)).toHaveLength(2);
    expect(inspectMusicXmlLyrics(removed.source, score(removed.source), m1e2)).toEqual([{ verse: 1, text: 'Low', syllabic: 'single' }]);
    const rest = removeMusicXmlNotes(rich, score(), { measure: 0, beat: 1, voice: 1 })!;
    expect(rest.source.match(/<text>Low<\/text>/g)).toHaveLength(2);
    const graceLyric = rich.replace('<grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch><voice>2</voice><type>16th</type><staff>2</staff><notations><technical><string>4</string><fret>0</fret></technical></notations>',
      '<grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch><voice>2</voice><type>16th</type><staff>2</staff><notations><technical><string>4</string><fret>0</fret></technical></notations><lyric><text>ah</text></lyric>');
    expect(graceLyric).toContain('<text>ah</text>');
    const graceBeat = score(graceLyric).tracks[0].staves[0].bars[0].voices[1].beats.findIndex(beat => beat.graceType);
    expect(() => removeMusicXmlGrace(graceLyric, score(graceLyric), { measure: 0, beat: graceBeat, voice: 1, string: 4 })).toThrow('protected lyric attachment');
  });

  it('keeps standalone lyrics distinct, multiline, limited, and removable', () => {
    const text = 'VERSE 1\n  C        G\nOh the wind\n\nCHORUS\nLine two';
    const withText = setMusicXmlStandaloneLyrics(rich, text);
    const preview = readMusicXml(withText, 'rich.musicxml');
    expect(preview.lyricsSection).toBe(text);
    expect(inspectMusicXmlLyrics(withText, preview.score, m1e2)).toEqual([{ verse: 1, text: 'Low', syllabic: 'single' }]);
    const replaced = setMusicXmlStandaloneLyrics(withText, 'Just one line');
    expect(readMusicXml(replaced, 'rich.musicxml').lyricsSection).toBe('Just one line');
    const cleared = setMusicXmlStandaloneLyrics(replaced, '   ');
    expect(readMusicXml(cleared, 'rich.musicxml').lyricsSection).toBeNull();
    expect(cleared).not.toContain('playtab-lyrics');
    expect(() => setMusicXmlStandaloneLyrics(rich, 'x'.repeat(20_001))).toThrow('limited to 20,000 characters');
  });
});

describe('ED-18 anchored chords, sections and annotations', () => {
  const score = () => readMusicXml(rich, 'rich.musicxml').score;
  const m2e3 = { measure: 1, beat: 2, voice: 1 };
  const m1e2 = { measure: 0, beat: 1, voice: 1 };
  const cMinor: ChordSpelling = { step: 'C', alter: 0, quality: 'minor', bass: null };
  const tabBeats = (source: string, measure: number) => readMusicXml(source, 'rich.musicxml').score.tracks[0].staves[0].bars[measure].voices[1].beats;
  const measureXml = (source: string, index: number) => new DOMParser().parseFromString(source, 'application/xml').getElementsByTagName('measure')[index];

  it('anchors a chord at the selected onset and a section at its measure start, removing only the chosen item', () => {
    expect(inspectMusicXmlAnchor(rich, score(), m2e3)).toEqual({ chords: [], words: [], sections: [] });
    const chord = changeMusicXmlAnchor(rich, score(), m2e3, 'chord', null, cMinor);
    const harmonies = Array.from(measureXml(chord, 1).getElementsByTagName('harmony'));
    expect(harmonies.map(item => item.getElementsByTagName('staff')[0].textContent).sort()).toEqual(['1', '2']);
    expect(measureXml(chord, 0).getElementsByTagName('harmony')).toHaveLength(1);
    const beats = tabBeats(chord, 1);
    expect(beats[2].chord?.name).toBe('Cm');
    expect(beats[2].playbackStart - beats[0].playbackStart).toBe(1920);
    expect(beats.slice(0, 2).every(beat => !beat.chord)).toBe(true);
    const chordScore = readMusicXml(chord, 'rich.musicxml').score;
    expect(inspectMusicXmlAnchor(chord, chordScore, m2e3).chords).toEqual([{ text: 'Cm', chord: cMinor }]);
    const section = changeMusicXmlAnchor(chord, chordScore, m2e3, 'section', null, 'Chorus');
    const sectionScore = readMusicXml(section, 'rich.musicxml').score;
    expect(sectionScore.masterBars[1].section?.marker).toBe('Chorus');
    expect(sectionScore.masterBars[0].section).toBeFalsy();
    const first = Array.from(measureXml(section, 1).childNodes).filter(node => node.nodeType === 1).map(node => (node as unknown as Element).localName);
    expect(first.indexOf('direction')).toBeLessThan(first.indexOf('note'));
    expect(inspectMusicXmlAnchor(section, sectionScore, { measure: 1, beat: 0, voice: 1 }).sections).toEqual([{ text: 'Chorus' }]);
    const noChord = changeMusicXmlAnchor(section, sectionScore, m2e3, 'chord', 0, null);
    expect(measureXml(noChord, 1).getElementsByTagName('harmony')).toHaveLength(0);
    expect(measureXml(noChord, 0).getElementsByTagName('harmony')).toHaveLength(1);
    expect(noChord).toContain('<rehearsal>Chorus</rehearsal>');
    const noSection = changeMusicXmlAnchor(noChord, readMusicXml(noChord, 'rich.musicxml').score, m2e3, 'section', 0, null);
    expect(noSection).toBe(new XMLSerializer().serializeToString(new DOMParser().parseFromString(rich, 'application/xml')));
  });

  it('keeps multiple annotations individually editable without touching other words, lyrics or techniques', () => {
    expect(inspectMusicXmlAnchor(rich, score(), m1e2)).toEqual({ chords: [{ text: 'C/G', chord: { step: 'C', alter: 0, quality: 'major', bass: { step: 'G', alter: 0 } } }],
      words: [{ text: 'Section A' }], sections: [] });
    const added = changeMusicXmlAnchor(rich, score(), m1e2, 'words', null, '  Play softly ');
    const addedScore = readMusicXml(added, 'rich.musicxml').score;
    expect(inspectMusicXmlAnchor(added, addedScore, m1e2).words).toEqual([{ text: 'Section A' }, { text: 'Play softly' }]);
    expect(tabBeats(added, 0)[1].text).toContain('Play softly');
    const edited = changeMusicXmlAnchor(added, addedScore, m1e2, 'words', 1, 'Play loudly');
    expect(edited.match(/<words>Play loudly<\/words>/g)).toHaveLength(2);
    expect(edited).toContain('<words>Section A</words>');
    expect(edited).toContain('<words>Section B</words>');
    expect(edited.match(/<text>Low<\/text>/g)).toHaveLength(2);
    expect(edited).toContain('<hammer-on type="start">H</hammer-on>');
    const removed = changeMusicXmlAnchor(edited, readMusicXml(edited, 'rich.musicxml').score, m1e2, 'words', 0, null);
    expect(removed).not.toContain('Section A');
    expect(removed).toContain('<direction><direction-type><words/></direction-type><sound tempo="96"/></direction>');
    const removedScore = readMusicXml(removed, 'rich.musicxml').score;
    expect(removedScore.tempo).toBe(readMusicXml(rich, 'rich.musicxml').score.tempo);
    expect(inspectMusicXmlAnchor(removed, removedScore, m1e2).words).toEqual([{ text: 'Play loudly' }]);
    expect(removed).toContain('<words>Play loudly</words>');
  });

  it('writes accidental and bass spelling, and keeps an unknown imported quality until replaced', () => {
    const flat: ChordSpelling = { step: 'B', alter: -1, quality: 'minor-seventh', bass: { step: 'F', alter: 1 } };
    const spelled = changeMusicXmlAnchor(rich, score(), m2e3, 'chord', null, flat);
    expect(spelled).toContain('<root><root-step>B</root-step><root-alter>-1</root-alter></root><kind>minor-seventh</kind><bass><bass-step>F</bass-step><bass-alter>1</bass-alter></bass>');
    expect(inspectMusicXmlAnchor(spelled, readMusicXml(spelled, 'rich.musicxml').score, m2e3).chords).toEqual([{ text: 'B♭m7/F♯', chord: flat }]);
    const tef = rich.replace('<harmony><root><root-step>C</root-step></root><kind>major</kind><bass><bass-step>G</bass-step></bass></harmony>',
      '<harmony placement="above" data-playtab-strings="0,0,0,0,0"><root><root-step>C</root-step><root-alter>-1</root-alter></root><kind text="m7b5">major</kind></harmony>');
    expect(tef).toContain('m7b5');
    const info = inspectMusicXmlAnchor(tef, score(), m1e2).chords[0];
    expect(info.text).toBe('C♭m7b5');
    expect(info.reason).toContain('kept until you replace it');
    expect(info.chord).toBeUndefined();
    const other = changeMusicXmlAnchor(tef, score(), m1e2, 'words', 0, 'Section A2');
    expect(other).toContain('<kind text="m7b5">major</kind>');
    const replaced = changeMusicXmlAnchor(tef, score(), m1e2, 'chord', 0, cMinor);
    expect(replaced).toContain('<harmony placement="above"><root><root-step>C</root-step></root><kind>minor</kind></harmony>');
    for (const [from, to] of [['<root-alter>-1</root-alter>', '<root-alter>2</root-alter>'], ['<kind text="m7b5">major</kind>', '<kind>ninth</kind>'],
      ['<kind text="m7b5">major</kind>', '<kind>minor</kind><degree/>'], ['placement="above"', 'placement="above" font-size="9"']]) {
      expect(inspectMusicXmlAnchor(tef.replace(from, to), score(), m1e2).chords[0].reason).toBeTruthy();
    }
  });

  it('validates limits before mutation and keeps anchors when an event is emptied', () => {
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'words', null, 'x'.repeat(161))).toThrow('Text must be 1–160 characters.');
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'section', null, '   ')).toThrow('Text must be 1–160 characters.');
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'chord', null, { ...cMinor, step: 'H' as 'C' })).toThrow('Choose a chord root');
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'chord', null, { ...cMinor, bass: { step: 'C', alter: 2 as 1 } })).toThrow('Choose a chord root');
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'chord', null, 'Cm')).toThrow('matching value');
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'words', null, null)).toThrow('Choose an existing item');
    expect(() => changeMusicXmlAnchor(rich, score(), m2e3, 'words', 3, 'Late')).toThrow('no longer at this position');
    expect(() => inspectMusicXmlAnchor(rich, score(), { measure: 0, beat: 0, voice: 1 })).toThrow('Select an ordinary event');
    const chord = changeMusicXmlAnchor(rich, score(), { measure: 1, beat: 1, voice: 1 }, 'chord', null, cMinor);
    const emptied = removeMusicXmlNotes(chord, readMusicXml(chord, 'rich.musicxml').score, { measure: 1, beat: 1, voice: 1 })!;
    expect(measureXml(emptied.source, 1).getElementsByTagName('harmony')).toHaveLength(2);
    expect(inspectMusicXmlAnchor(emptied.source, readMusicXml(emptied.source, 'rich.musicxml').score, { measure: 1, beat: 1, voice: 1 }).chords)
      .toEqual([{ text: 'Cm', chord: cMinor }]);
  });
});

describe('ED-17 bends and independent hand annotations', () => {
  // Rich fixture TAB voice 2, event 2 (after the grace chord): D on string 4,
  // fret 0 with fretting 1, picking T and a hammer-on start.
  const low = { measure: 0, beat: 1, voice: 2, string: 4, fret: 0 };
  const lowNote = (source: string) => readMusicXml(source, 'rich.musicxml').score.tracks[0].staves[0].bars[0].voices[1].beats[1];
  const technical = (source: string) => {
    const note = Array.from(new DOMParser().parseFromString(source, 'application/xml').getElementsByTagName('note'))
      .find(item => item.getElementsByTagName('staff')[0]?.textContent === '2' && !item.getElementsByTagName('grace').length)!;
    return Array.from(note.getElementsByTagName('technical')[0].childNodes).filter(item => item.nodeType === 1)
      .map(node => node as unknown as Element)
      .map(item => `${item.localName}${item.getAttribute('type') ? `:${item.getAttribute('type')}` : ''}=${item.textContent}`);
  };
  const normalized = (source: string) => new XMLSerializer().serializeToString(new DOMParser().parseFromString(source, 'application/xml'));

  it('changes one hand only, keeping the hammer-on and the other hand', () => {
    const score = readMusicXml(rich, 'rich.musicxml').score;
    expect(inspectMusicXmlNoteTechniques(rich, score, low)).toEqual({ picking: 'T', fretting: '1', bend: 'none' });
    const fretted = setMusicXmlHand(rich, score, low, 'fretting', '3');
    const picked = setMusicXmlHand(fretted, readMusicXml(fretted, 'rich.musicxml').score, low, 'picking', 'I');
    expect(technical(picked)).toEqual(['string=4', 'fret=0', 'hammer-on:start=H', 'fingering=3', 'other-technical=TEF fingering I']);
    const cleared = setMusicXmlHand(picked, readMusicXml(picked, 'rich.musicxml').score, low, 'picking', 'none');
    expect(technical(cleared)).toEqual(['string=4', 'fret=0', 'hammer-on:start=H', 'fingering=3']);
    expect(setMusicXmlHand(cleared, readMusicXml(cleared, 'rich.musicxml').score, low, 'picking', 'none')).toBe(cleared);
    const beat = lowNote(picked);
    expect(beat.notes[0].leftHandFinger).toBe(3);
    expect(beat.notes[0].isHammerPullOrigin).toBe(true);
    expect(beat.text).toContain('③');
    expect((beat as typeof beat & { playtabFingerings?: string[] }).playtabFingerings).toEqual(['I']);
    expect(inspectMusicXmlNoteTechniques(picked, readMusicXml(picked, 'rich.musicxml').score, low)).toEqual({ picking: 'I', fretting: '3', bend: 'none' });
  });

  it('renders a fretting thumb and keeps stacked picking labels free of duplicates', () => {
    const score = readMusicXml(rich, 'rich.musicxml').score;
    const thumb = setMusicXmlHand(rich, score, low, 'fretting', 'T');
    expect(technical(thumb)).toContain('fingering=t');
    expect(lowNote(thumb).notes[0].leftHandFinger).toBe(0);
    expect(lowNote(thumb).text).toContain('Ⓣ');
    expect(inspectMusicXmlNoteTechniques(thumb, readMusicXml(thumb, 'rich.musicxml').score, low).fretting).toBe('T');
    const chord = addMusicXmlNote(rich, score, { measure: 0, beat: 1, voice: 1, string: 5, fret: 0 });
    const member = { ...low, string: 5 };
    const both = setMusicXmlHand(chord, readMusicXml(chord, 'rich.musicxml').score, member, 'picking', 'T');
    const stacked = lowNote(both) as ReturnType<typeof lowNote> & { playtabFingerings?: string[] };
    expect(stacked.playtabFingerings).toEqual(['T']);
    const mixed = setMusicXmlHand(both, readMusicXml(both, 'rich.musicxml').score, member, 'picking', 'M');
    expect((lowNote(mixed) as typeof stacked).playtabFingerings).toEqual(['T', 'M']);
  });

  it('writes canonical bend curves whose MIDI reaches, holds and releases the declared offset', () => {
    const source = fs.readFileSync('tests/fixtures/editor-tie.musicxml', 'utf8');
    const score = readMusicXml(source, 'tie.musicxml').score;
    const note = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
    const position = { measure: 0, beat: 0, voice: 1, string: 6 - note.notes[0].string, fret: note.notes[0].fret };
    const semitone = 134_217_728;
    const center = 2_147_483_648;
    const curve = (amount: 1 | 2 | 3 | 4, shape: 'bend' | 'release') => {
      const written = setMusicXmlBend(source, score, position, { amount, shape });
      const after = readMusicXml(written, 'tie.musicxml').score;
      const bent = after.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
      const file = new midi.MidiFile();
      new midi.MidiFileGenerator(after, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
      const events = file.events.filter((event): event is midi.NoteBendEvent => event instanceof midi.NoteBendEvent)
        .filter(event => event.tick < note.playbackDuration);
      return { written, points: bent.bendPoints!.map(point => [point.offset, point.value]), events };
    };
    const whole = curve(2, 'bend');
    expect(whole.written).toContain('<bend><bend-alter>2</bend-alter></bend>');
    expect(whole.points).toEqual([[0, 0], [30, 4], [60, 4]]);
    const peak = whole.events.find(event => event.value === center + 2 * semitone)!;
    expect(peak.tick).toBeLessThanOrEqual(note.playbackDuration / 2);
    expect(whole.events.filter(event => event.tick >= peak.tick).every(event => event.value === center + 2 * semitone)).toBe(true);
    expect(Math.max(...curve(3, 'bend').events.map(event => event.value))).toBe(center + 3 * semitone);
    const release = curve(1, 'release');
    expect(release.written).toContain('<bend><bend-alter>1</bend-alter></bend><bend><bend-alter>1</bend-alter><release/></bend>');
    expect(release.points).toEqual([[0, 0], [30, 2], [30, 2], [60, 0]]);
    expect(Math.max(...release.events.map(event => event.value))).toBe(center + semitone);
    expect(release.events.find(event => event.value === center + semitone)!.tick).toBe(note.playbackDuration / 2);
    expect(release.events.at(-1)!.value).toBeLessThan(center + semitone / 4);
    expect(() => setMusicXmlBend(source, score, position, { amount: 5 as 4, shape: 'bend' })).toThrow('Choose a bend of 1/2, 1, 1½ or 2 steps');
    expect(() => setMusicXmlBend(source, score, { ...position, fret: 9 }, null)).toThrow('cannot be uniquely identified');
  });

  it('removes a bend without touching techniques, annotations or the notation partner', () => {
    const score = readMusicXml(rich, 'rich.musicxml').score;
    const bent = setMusicXmlBend(rich, score, low, { amount: 2, shape: 'release' });
    expect(bent.match(/<bend>/g)).toHaveLength(4);
    expect(inspectMusicXmlNoteTechniques(bent, readMusicXml(bent, 'rich.musicxml').score, low).bend).toEqual({ amount: 2, shape: 'release' });
    expect(setMusicXmlBend(bent, readMusicXml(bent, 'rich.musicxml').score, low, { amount: 2, shape: 'release' })).toBe(bent);
    const removed = setMusicXmlBend(bent, readMusicXml(bent, 'rich.musicxml').score, low, null);
    expect(removed).toBe(normalized(rich));
    expect(setMusicXmlBend(removed, readMusicXml(removed, 'rich.musicxml').score, low, null)).toBe(removed);
  });

  it('keeps unsupported imported markings read-only until explicitly replaced', () => {
    const tefBend = rich.replace('<hammer-on type="start">H</hammer-on></technical></notations></note>\n      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice>',
      '<hammer-on type="start">H</hammer-on><bend><bend-alter>2</bend-alter><release/></bend></technical></notations></note>\n      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice>');
    expect(tefBend).toContain('<release/>');
    const score = readMusicXml(tefBend, 'rich.musicxml').score;
    const info = inspectMusicXmlNoteTechniques(tefBend, score, low);
    expect(info).toMatchObject({ picking: 'T', fretting: '1', bend: null,
      bendReason: 'This imported bend (a release-only bend curve) is kept as written. Applying a bend here replaces it.' });
    const picked = setMusicXmlHand(tefBend, score, low, 'picking', 'M');
    expect(picked).toContain('<bend><bend-alter>2</bend-alter><release/></bend>');
    const replaced = setMusicXmlBend(tefBend, score, low, { amount: 1, shape: 'bend' });
    expect(replaced).not.toContain('<release/>');
    expect(inspectMusicXmlNoteTechniques(replaced, readMusicXml(replaced, 'rich.musicxml').score, low).bend).toEqual({ amount: 1, shape: 'bend' });
    const quarter = tefBend.replace('<bend-alter>2</bend-alter><release/>', '<bend-alter>0.5</bend-alter>');
    expect(inspectMusicXmlNoteTechniques(quarter, readMusicXml(quarter, 'rich.musicxml').score, low).bendReason).toContain('a 0.5-semitone bend');
    const reasons = (xml: string) => inspectMusicXmlNoteTechniques(xml, readMusicXml(xml, 'rich.musicxml').score, low);
    expect(reasons(tefBend.replace('<bend-alter>2</bend-alter><release/>', '<bend-alter>2</bend-alter><pre-bend/>')).bendReason).toContain('a pre-bend');
    expect(reasons(tefBend.replace('<bend><bend-alter>2</bend-alter><release/></bend>', '<bend><bend-alter>1</bend-alter></bend><bend><bend-alter>1</bend-alter></bend><bend><bend-alter>1</bend-alter><release/></bend>')).bendReason).toContain('a 3-part bend curve');
    expect(reasons(tefBend.replace('<bend><bend-alter>2</bend-alter><release/></bend>', '<bend shape="curved"><bend-alter>2</bend-alter></bend>')).bendReason).toContain('a styled bend');
    const fingered = rich.replace('<fingering enclosure="circle">1</fingering>', '<fingering enclosure="circle">5</fingering>');
    const fingeredInfo = inspectMusicXmlNoteTechniques(fingered, readMusicXml(rich, 'rich.musicxml').score, low);
    expect(fingeredInfo).toMatchObject({ fretting: null, frettingReason: 'The fretting-hand marking “5” is kept as written.' });
    expect(() => setMusicXmlHand(fingered, score, low, 'fretting', '2')).toThrow('“5” is kept as written');
    expect(setMusicXmlHand(fingered, score, low, 'picking', 'I')).toContain('<fingering enclosure="circle">5</fingering>');
    const doubled = rich.replace('<other-technical>TEF fingering T</other-technical>', '<other-technical>TEF fingering T</other-technical><other-technical>TEF right-hand fingering m</other-technical>')
      .replace('<fingering enclosure="circle">1</fingering>', '<fingering enclosure="circle">1</fingering><fingering>2</fingering>');
    expect(inspectMusicXmlNoteTechniques(doubled, score, low)).toMatchObject({ picking: null, fretting: null,
      pickingReason: 'This note has more than one picking-hand marking; it is kept as written.',
      frettingReason: 'This note has more than one fretting-hand marking; it is kept as written.' });
    expect(() => setMusicXmlHand(doubled, score, low, 'picking', 'I')).toThrow('more than one picking-hand marking');
    const pdfThumb = rich.replace('<other-technical>TEF fingering T</other-technical>', '<other-technical>TEF right-hand fingering p</other-technical>');
    expect(inspectMusicXmlNoteTechniques(pdfThumb, score, low).picking).toBe('T');
    const coded = rich.replace('<other-technical>TEF fingering T</other-technical>', '<other-technical>TEF fingering code 6</other-technical>');
    expect(inspectMusicXmlNoteTechniques(coded, score, low).picking).toBe('T');
    expect(() => setMusicXmlHand(rich, score, low, 'picking', 'X' as 'T')).toThrow('supported picking-hand value');
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
    const expected = { destination: beat + 1, readOnly: [], connections: [],
      events: [{ denominator: 16, notes: [{ string: 4, fret: 0, transition: 'none' }, { string: 3, fret: 0, transition: 'none' }] }] };
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
    expect(reopened).toMatchObject({ readOnly: [], events, connections: ['pull-off'] });
    expect(applyMusicXmlGraceGroup(changed, after.score, { measure: 0, beat: after.beat, voice }, events)).toBe(changed);
  });

  it('chains a slide between grace events and replaces the group without leaving stale endpoints', () => {
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
    expect(() => applyMusicXmlGraceGroup(rich, score, position, one(4, 2, 'hammer-on'))).toThrow('Grace event 1, string 4: a hammer-on needs a higher fret on its next note (fret 0).');
    expect(() => applyMusicXmlGraceGroup(rich, score, position, one(4, 0, 'pull-off'))).toThrow('a pull-off needs a lower fret');
    expect(() => applyMusicXmlGraceGroup(rich, score, position, one(4, 0, 'slide'))).toThrow('a slide needs a different fret');
    expect(() => applyMusicXmlGraceGroup(rich, score, position, one(2, 3, 'hammer-on'))).toThrow('needs a later note on string 2');
    expect(() => applyMusicXmlGraceGroup(rich, score, position, one(2, 3, 'bend' as 'none'))).toThrow('Choose None, Hammer-on, Pull-off, or Slide');
    expect(() => applyMusicXmlGraceGroup(rich, score, position, [])).toThrow('one to eight grace events');
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
    expect(info.readOnly).toContain('Grace event 1, string 4 has the marking “TEF grace effect 5”.');
    expect(info.readOnly).toContain('Grace event 1 mixes display durations.');
    expect(() => applyMusicXmlGraceGroup(tef, score, { measure: 0, beat, voice }, info.events))
      .toThrow('This grace group is read-only: Grace event 1 mixes display durations.');
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
    expect(untypedInfo.events[0].denominator).toBeNull();
    const kept = applyMusicXmlGraceGroup(untyped, plain.score, { measure: 0, beat, voice },
      [{ ...untypedInfo.events[0], notes: [{ string: 4, fret: 2, transition: 'none' }] }]);
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
      .toEqual(['Grace event 1, string 4 ends a hammer-on that starts outside the grace group.']);
    const styled = rich.replace('<note><grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch><voice>1</voice>',
      '<note default-x="12"><grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch><voice>1</voice>')
      .replace('<grace slash="yes"/><pitch><step>D</step><octave>3</octave></pitch><voice>2</voice>',
        '<grace slash="yes" steal-time-previous="10"/><pitch><step>D</step><octave>3</octave></pitch><voice>2</voice>')
      .replace('<grace slash="yes"/><chord/><pitch><step>G</step><octave>3</octave></pitch><voice>2</voice><type>16th</type><staff>2</staff>',
        '<grace/><chord/><pitch><step>G</step><octave>3</octave></pitch><voice>2</voice><type>16th</type><staff>2</staff><notehead>x</notehead>');
    const second = target(styled);
    expect(inspectMusicXmlGraceGroup(styled, second.score, { measure: 0, beat: second.beat, voice: second.voice }).readOnly).toEqual([
      'Grace event 1, string 4 has a grace steal-time-previous setting.',
      'Grace event 1, string 3 has an unslashed grace.',
      'Grace event 1 on the notation staff has a default-x note attribute.',
    ]);
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
