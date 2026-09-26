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
  inspectMusicXmlTempo, setMusicXmlLocalTempo, connectMusicXmlTransition, inspectMusicXmlTransitions, removeMusicXmlTransition, copyMusicXmlMeasures, pasteMusicXmlMeasures, cutMusicXmlMeasures, changeMusicXmlDuration, insertMusicXmlBeat,
  type ChordSpelling } from '../../../app/frontend/music/musicxml-editor';

import './support';
import { rich } from './support';

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
      .toThrow('Another beat or rest');
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
      { measure: 1, beat: 0, voice: 1, string: 4, fret: 0 })).toThrow('Another beat or rest');
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
    expect(inspectMusicXmlTransitions(hammer, after, m1)).toEqual([{ kind: 'hammer-on', direction: 'outgoing', other: { measure: 2, beat: 1, fret: 2 } }]);
    expect(inspectMusicXmlTransitions(hammer, after, m2)).toEqual([{ kind: 'hammer-on', direction: 'incoming', other: { measure: 1, beat: 1, fret: 0 } }]);
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

describe('ED-17 bends and independent hand annotations', () => {
  // Rich fixture TAB voice 2, beat 2 (after the grace chord): D on string 4,
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

  it('keeps a beat word under stacked picking fingerings', () => {
    const worded = rich.replace('<note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice>',
      '<direction><direction-type><words>Verse</words></direction-type><staff>2</staff></direction><note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice>');
    const chord = addMusicXmlNote(worded, readMusicXml(worded, 'rich.musicxml').score, { measure: 0, beat: 1, voice: 1, string: 5, fret: 0 });
    const both = setMusicXmlHand(chord, readMusicXml(chord, 'rich.musicxml').score, { ...low, string: 5 }, 'picking', 'M');
    expect(lowNote(both).text).toBe('T\nM\nVerse ①');
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
