import { describe, expect, it } from 'vitest';
import { configureChordDiagrams, readMusicXml, toImportedScoreDocument } from '../../app/frontend/music/musicxml';
import { applyTechniques, extractTechniques } from '../../app/frontend/music/musicxml-techniques';
import { importer, model } from '@coderline/alphatab';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { vi } from 'vitest';
import fs from 'node:fs';
vi.stubGlobal('DOMParser', DOMParser);
vi.stubGlobal('XMLSerializer', XMLSerializer);

// Original synthetic fixture: the same C4 appears in notation and on string 2.
const fixture = (otherPitch = 'C') => `<score-partwise version="4.0">
<part-list><score-part id="P1"><part-name>Banjo</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>TAB</sign><line>5</line></clef>
<staff-details number="2"><staff-lines>5</staff-lines>
${[['G',4],['C',3],['G',3],['C',4],['D',4]].map(([step, octave], i) => `<staff-tuning line="${i + 1}"><tuning-step>${step}</tuning-step>${i === 4 ? '<tuning-alter>1</tuning-alter>' : ''}<tuning-octave>${octave}</tuning-octave></staff-tuning>`).join('')}
</staff-details></attributes>
<note><pitch><step>${otherPitch}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff><notations><technical><string>2</string><fret>0</fret></technical></notations></note>
</measure></part></score-partwise>`;

describe('MusicXML preview', () => {
  const techniques = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8');
  it('creates preview IDs when randomUUID is unavailable on the serving origin', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
    try {
      expect(readMusicXml(techniques, 'insecure-origin.xml').id).toMatch(/^preview-/);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
      else delete (globalThis as { crypto?: Crypto }).crypto;
    }
  });
  it.skipIf(!process.env.PLAYTAB_CORRECTED_XML || !process.env.PLAYTAB_TEFSOURCE)('preserves base frets for every flagged annotation in the private TEF', () => {
    const preview = readMusicXml(fs.readFileSync(process.env.PLAYTAB_CORRECTED_XML!, 'utf8'), 'corrected.xml');
    const tab = preview.score.tracks[0].staves[0];
    expect(tab.bars[3].voices.flatMap(v => v.beats.flatMap(b => b.notes.map(n => n.fret)))).toEqual([1, 0, 5, 5, 0, 1, 0]);
    const bytes = fs.readFileSync(process.env.PLAYTAB_TEFSOURCE!);
    let checked = 0;
    for (let i = 0; i < bytes.readUInt16LE(256); i++) {
      const p = 258 + i * 6, fretCode = bytes[p + 2] & 31;
      if (!fretCode || fretCode > 25 || !(bytes[p + 2] & 32)) continue;
      const location = bytes.readUInt16LE(p);
      const bar = tab.bars[Math.floor(location / 1280)];
      const string = 5 - Math.floor(location / 256) % 5;
      const notes = bar.voices.flatMap(v => v.beats.filter(b => b.playbackStart === location % 256 * 15).flatMap(b => b.notes.filter(n => n.string === string)));
      expect(notes).toHaveLength(1);
      expect(notes[0].fret).toBe(fretCode - 1);
      expect(notes[0].isGhost).toBe(false);
      checked++;
    }
    expect(checked).toBe(12);
  });
  it('keeps fretting-hand finger 3 separate from fret and pitch', () => {
    const annotated = techniques.replace('<fret>3</fret>', '<fret>3</fret><fingering enclosure="circle">3</fingering>');
    const { score, source } = readMusicXml(annotated, 'finger.xml');
    const note = score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0];
    expect([note.fret, note.realValue, note.leftHandFinger]).toEqual([3, 51, 3]);
    expect(note.beat.text).toContain('③');
    expect(source).toBe(annotated);
  });
  it('shows TEF thumb fingering without changing the note', () => {
    const annotated = techniques.replace('<fret>3</fret>', '<fret>3</fret><other-technical>TEF fingering code 6</other-technical>');
    const { score } = readMusicXml(annotated, 'unknown-finger.xml');
    const note = score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0];
    const baseline = readMusicXml(techniques, 'baseline.xml').score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0];
    expect([note.fret, note.realValue, note.leftHandFinger]).toEqual([3, 51, 0]);
    expect(note.leftHandFinger).not.toBe(baseline.leftHandFinger);
    expect(note.beat.text).toBeNull();
  });
  it('shows a native TEF3 thumb fingering without changing the note', () => {
    const annotated = techniques.replace('<fret>3</fret>', '<fret>3</fret><other-technical>TEF fingering T</other-technical>');
    const { score } = readMusicXml(annotated, 'native-thumb.xml');
    const note = score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0];
    const baseline = readMusicXml(techniques, 'baseline-native-thumb.xml').score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0];
    expect([note.fret, note.realValue, note.leftHandFinger]).toEqual([3, 51, 0]);
    expect(note.leftHandFinger).not.toBe(baseline.leftHandFinger);
    expect(note.beat.text).toBeNull();
  });
  it('shows a PDF rake as an R annotation and arpeggio', () => {
    const annotated = techniques.replace(
      '<fret>3</fret>',
      '<fret>3</fret><other-technical>TEF rake</other-technical><arpeggiate direction="down" />',
    );
    const { score } = readMusicXml(annotated, 'rake.xml');
    const note = score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0];
    expect(note.beat.text).toBe('R');
    expect(note.beat.brushType).toBe(model.BrushType.ArpeggioDown);
  });
  it('preserves a PDF slide label beside the native slide notation', () => {
    const annotated = techniques.replace(
      '<notations><technical><string>4</string><fret>0</fret>',
      '<notations><slide type="start">Sl</slide><technical><string>4</string><fret>0</fret><other-technical>TEF slide Sl</other-technical>',
    );
    const { score } = readMusicXml(annotated, 'slide.xml');
    const note = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
    expect(note.beat.text).toBe('Sl');
  });
  it('maps the TEF code for finger 1 to a circled fingering', () => {
    const annotated = techniques.replace('<fret>3</fret>', '<fret>3</fret><fingering enclosure="circle">1</fingering>');
    const { score } = readMusicXml(annotated, 'finger-one.xml');
    const note = score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0];
    expect(note.leftHandFinger).toBe(1);
    expect(note.beat.text).toContain('①');
  });
  it('keeps positioned text and chord annotations on the retained tab staff', () => {
    const direction = '<direction><direction-type><words>Verse</words></direction-type><staff>1</staff></direction>';
    const harmony = '<harmony><root><root-step>C</root-step></root><kind>minor</kind></harmony>';
    const tabDirection = '<direction><direction-type><words>Verse</words></direction-type><staff>2</staff></direction>';
    const tabHarmony = '<harmony><root><root-step>C</root-step></root><kind>minor</kind><staff>2</staff></harmony>';
    const annotated = fixture()
      .replace('<note><pitch', `${direction}${harmony}<note><pitch`)
      .replace('<backup><duration>4</duration></backup>', `<backup><duration>4</duration></backup>${tabDirection}${tabHarmony}`);
    const { score, chordDiagrams } = readMusicXml(annotated, 'annotations.xml');
    const beats = score.tracks[0].staves[0].bars[0].voices.flatMap(voice => voice.beats);
    expect(beats.find(beat => beat.text)?.text).toBe('Verse');
    expect(beats.find(beat => beat.chord)?.chord?.name).toBe('Cm');
    expect(chordDiagrams).toEqual([]);
  });
  it('keeps timed lyrics aligned and imports TEF chord voicings without enabling diagrams', () => {
    const harmony = '<harmony data-playtab-strings="0,2,0,1,0" data-playtab-first-fret="1"><root><root-step>C</root-step></root><kind>minor</kind><staff>2</staff></harmony>';
    const annotated = fixture()
      .replace('<backup><duration>4</duration></backup>', `<forward><duration>0</duration></forward><backup><duration>4</duration></backup>${harmony}`)
      .replace('</notations></note>', '</notations><lyric number="1"><syllabic>single</syllabic><text>There</text></lyric></note>');
    const preview = readMusicXml(annotated, 'presentation.xml');
    const chord = preview.score.tracks[0].staves[0].bars[0].voices.flatMap(voice => voice.beats).find(beat => beat.chord)?.chord;
    expect(preview.timedLyrics).toEqual([{ measure: 1, beat: 1, text: 'There' }]);
    expect(chord?.strings).toEqual([0, 2, 0, 1, 0]);
    expect(preview.chordDiagrams).toEqual([{ name: 'Cm', strings: [0, 2, 0, 1, 0], firstFret: 1, barreFrets: [] }]);
    expect(preview.score.stylesheet.globalDisplayChordDiagramsInScore).toBe(false);
    configureChordDiagrams(preview.score, true);
    expect(preview.score.stylesheet.globalDisplayChordDiagramsInScore).toBe(false);
    expect(preview.score.stylesheet.globalDisplayChordDiagramsOnTop).toBe(true);
    expect(chord?.showDiagram).toBe(true);
  });
  it('applies voicings when alphaTab attaches an offset chord to the measure start', () => {
    const harmony = '<harmony offset="99" data-playtab-strings="4,0,0,0,-1" data-playtab-first-fret="1"><root><root-step>A</root-step></root><kind>major</kind></harmony>';
    const preview = readMusicXml(fixture().replace('</backup>', `</backup>${harmony}`), 'offset-chord.xml');
    expect(preview.chordDiagrams).toContainEqual({ name: 'A', strings: [4, 0, 0, 0, -1], firstFret: 1, barreFrets: [] });
  });
  it('imports MusicXML subtitle and arranger credits', () => {
    const annotated = fixture().replace(
      '<part-list>',
      '<credit page="1"><credit-type>subtitle</credit-type><credit-words>gCGCD# (capo 2), Brainjo level 3</credit-words></credit>' +
      '<credit page="1"><credit-type>arranger</credit-type><credit-words>arranged by Josh Turknett CLAWHAMMERBANJO.NET</credit-words></credit><part-list>'
    );
    const preview = readMusicXml(annotated, 'credits.xml');
    expect(preview.score.subTitle.replaceAll('\u00a0', ' ')).toBe('gCGCD# (capo 2), Brainjo level 3');
    expect(preview.score.artist.replaceAll('\u00a0', ' ')).toBe('arranged by Josh Turknett CLAWHAMMERBANJO.NET');
  });
  it('imports MusicXML lyrics onto the retained tab staff', () => {
    const annotated = fixture().replace(
      '</notations></note>',
      '</notations><lyric number="1"><syllabic>single</syllabic><text>There</text></lyric></note>'
    );
    const { score } = readMusicXml(annotated, 'lyrics.xml');
    const beats = score.tracks[0].staves[0].bars[0].voices.flatMap(voice => voice.beats);
    expect(beats.find(beat => beat.lyrics)?.lyrics).toEqual(['There']);
  });
  it('uses the banjo playback program for imported five-string scores', () => {
    const source = fixture().replace(
      '<part-name>Banjo</part-name>',
      '<part-name>Banjo</part-name><score-instrument id="P1-I1"><instrument-name>Banjo</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-program>1</midi-program></midi-instrument>'
    );
    const preview = readMusicXml(source, 'imported.xml');
    const firstBeat = preview.score.tracks[0].staves[0].bars[0].voices[0].beats[0];

    expect(preview.score.tracks[0].playbackInfo.program).toBe(105);
    expect(preview.score.tracks[0].playbackInfo.bank).toBe(0);
    expect(firstBeat.getAutomation(model.AutomationType.Instrument)?.value).toBe(105);
  });
  it('extracts a separate Playtab lyrics section without attaching words to beats', () => {
    const annotated = fixture().replace(
      '<part-list>',
      '<identification><miscellaneous><miscellaneous-field name="playtab-lyrics">LYRICS &amp; CHORDS\n\nVERSE\nThere once was a ship</miscellaneous-field></miscellaneous></identification><part-list>'
    );
    const { score, lyricsSection } = readMusicXml(annotated, 'lyrics-section.xml');
    const beats = score.tracks[0].staves[0].bars[0].voices.flatMap(voice => voice.beats);
    expect(lyricsSection).toBe('VERSE\nThere once was a ship');
    expect(beats.every(beat => beat.lyrics === null)).toBe(true);

    const reversedHeading = annotated.replace('LYRICS &amp; CHORDS', 'CHORDS &amp; LYRICS');
    expect(readMusicXml(reversedHeading, 'reversed-lyrics-heading.xml').lyricsSection).toBe('VERSE\nThere once was a ship');
  });
  it.skipIf(!process.env.PLAYTAB_REVIEWED_XML)('preserves reviewed measure-eight fret and separate third-finger annotation', () => {
    const preview = readMusicXml(fs.readFileSync(process.env.PLAYTAB_REVIEWED_XML!, 'utf8'), 'reviewed.xml');
    const notes = preview.score.tracks[0].staves[0].bars[7].voices.flatMap(v => v.beats.flatMap(b => b.notes));
    expect(notes.slice(0, 2).map(n => n.fret)).toEqual([0, 5]);
    expect(notes[1].realValue).toBe(53);
    expect(notes[1].isGhost).toBe(false);
    expect(notes[1].leftHandFinger).toBe(3);
    expect(notes[1].beat.text).toContain('③');
    const repeated = preview.score.tracks[0].staves[0].bars[15].voices.flatMap(v => v.beats.flatMap(b => b.notes));
    expect(repeated.slice(0, 2).map(n => n.fret)).toEqual([0, 5]);
    expect(repeated[1].leftHandFinger).toBe(3);
  });
  it.skipIf(!process.env.PLAYTAB_TEFPREVIEW_XML)('preserves the confirmed Wellerman measure-two techniques', () => {
    const preview = readMusicXml(fs.readFileSync(process.env.PLAYTAB_TEFPREVIEW_XML!, 'utf8'), 'wellerman.xml');
    const tab = preview.score.tracks[0].staves[0];
    const notes = tab.bars[1].voices.flatMap(v => v.beats.flatMap(b => b.notes));
    const origins = notes.filter(n => n.isHammerPullOrigin);
    expect(origins.map(n => [n.beat.playbackStart, 6 - n.string, n.fret, n.hammerPullDestination?.fret])).toEqual([
      [1920, 4, 0, 3], [2880, 4, 3, 0],
    ]);
    expect(tab.chords?.size).toBeGreaterThan(0);
    const textAt = (barIndex: number, label: string) => tab.bars[barIndex].voices
      .flatMap(voice => voice.beats).some(beat => beat.text?.includes(label));
    expect(textAt(0, 'Low solo')).toBe(true);
    expect(textAt(1, 'Verse')).toBe(true);
    expect(textAt(17, 'High solo')).toBe(true);

    const thumbBars = tab.bars
      .map((bar, index) => [index + 1, bar.voices.flatMap(voice => voice.beats).some(beat => beat.text?.includes('T'))] as const)
      .filter(([, found]) => found)
      .map(([index]) => index);
    expect(thumbBars).toContain(19);
    expect(thumbBars).toContain(23);
  });
  it('connects H and PO pairs without turning stops into extra origins', () => {
    const preview = readMusicXml(techniques, 'techniques.xml');
    const notes = preview.score.tracks[0].staves[0].bars[0].voices.flatMap(v => v.beats.flatMap(b => b.notes));
    expect(notes.map(n => n.isHammerPullOrigin)).toEqual([true, false, true, false]);
    expect(notes[0].hammerPullDestination).toBe(notes[1]);
    expect(notes[2].hammerPullDestination).toBe(notes[3]);
    expect(notes.every(n => n.slideOutType === model.SlideOutType.None)).toBe(true);
    expect(notes.every(n => n.slideTarget === null)).toBe(true);
    expect(notes.map(n => n.beat.playbackStart)).toEqual([0, 960, 1920, 2880]);
    expect(preview.source).toBe(techniques);
  });
  it('retains adjacent H and PO segments on one technique chain', () => {
    const preview = readMusicXml(fs.readFileSync('tests/fixtures/chained-techniques.musicxml', 'utf8'), 'chained-techniques.xml');
    const notes = preview.score.tracks[0].staves[0].bars[0].voices.flatMap(v => v.beats.flatMap(b => b.notes));

    expect(notes.map(note => note.isHammerPullOrigin)).toEqual([true, true, false]);
    const segments = (notes[0] as any).effectSlur.segments as Array<{ fromNote: (typeof notes)[number]; toNote: (typeof notes)[number]; text: string }>;
    expect(segments.map(segment => [segment.fromNote, segment.toNote, segment.text])).toEqual([
      [notes[0], notes[1], 'H'],
      [notes[1], notes[2], 'PO'],
    ]);
  });
  it('matches techniques to the normal note beside a same-onset ghost note', () => {
    const ghostDuplicate = '<note><chord/><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><notehead parentheses="yes">normal</notehead><notations><technical><string>4</string><fret>0</fret></technical></notations></note>';
    const annotated = techniques.replace(
      '    <note><pitch><step>E</step><alter>-1</alter><octave>3</octave></pitch><duration>1</duration><type>quarter</type><notations>',
      `${ghostDuplicate}\n$&`,
    );
    const preview = readMusicXml(annotated, 'ghost-technique.xml');
    const notes = preview.score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;
    const origin = notes.find(note => !note.isGhost);

    expect(notes).toHaveLength(2);
    expect(origin?.isHammerPullOrigin).toBe(true);
    expect(origin?.hammerPullDestination?.fret).toBe(3);
    expect(notes.find(note => note.isGhost)?.isHammerPullOrigin).not.toBe(true);
  });
  it('rejects unpaired and wrong-direction techniques', () => {
    expect(() => readMusicXml(techniques.replace('<pull-off type="stop"/>', ''), 'bad.xml')).toThrow('Unpaired');
    expect(() => readMusicXml(techniques.replaceAll('pull-off', 'hammer-on'), 'bad.xml')).toThrow('direction');
    expect(() => readMusicXml(techniques.replace('<hammer-on type="start">H</hammer-on>', ''), 'bad.xml')).toThrow('Unpaired');
    expect(() => readMusicXml(techniques.replace('<hammer-on type="stop"/>', '<hammer-on type="start"/>'), 'bad.xml')).toThrow('Overlapping');
    const delayedStop = techniques
      .replace('<hammer-on type="stop"/>', '')
      .replace('<pull-off type="stop"/>', '<hammer-on type="stop"/><pull-off type="stop"/>');
    expect(() => readMusicXml(delayedStop, 'bad.xml')).toThrow('next note');
  });

  it('checks technique connections and labels internal slur segments', () => {
    const marker = { bar: 0, tick: 0, staff: 0, voice: '1', string: 4, fret: 0, kind: 'hammer-on', type: 'start', number: '1' };
    const stop = { ...marker, tick: 960, fret: 3, type: 'stop' };
    const makeModel = (connect: boolean, skipIntermediate: boolean = false) => {
      const firstBeat: any = { playbackStart: 0, notes: [], nextBeat: null, noteStringLookup: new Map() };
      const secondBeat: any = { playbackStart: 960, notes: [], nextBeat: null, noteStringLookup: new Map() };
      const middleBeat: any = { playbackStart: 480, notes: [{ string: 3, fret: 0, isStringed: false, beat: null }], nextBeat: secondBeat, noteStringLookup: new Map() };
      const from: any = { string: 2, fret: 0, isStringed: true, beat: firstBeat };
      const to: any = { string: 2, fret: 3, isStringed: true, beat: secondBeat };
      firstBeat.notes = [from]; firstBeat.nextBeat = skipIntermediate ? middleBeat : secondBeat; secondBeat.notes = [to];
      const tab: any = { bars: [{ voices: [{ beats: skipIntermediate ? [firstBeat, middleBeat, secondBeat] : [firstBeat, secondBeat] }] }] };
      const score: any = { finish: () => {
        if (connect) {
          from.hammerPullDestination = to;
          from.effectSlur = { segments: [{ fromNote: from, toNote: to, text: null }] };
        }
      } };
      return { score, tab, from };
    };
    const disconnected = makeModel(false);
    expect(() => applyTechniques(disconnected.score, disconnected.tab, 0, [marker, stop] as any)).toThrow('connection could not');
    const connected = makeModel(true, true);
    applyTechniques(connected.score, connected.tab, 0, [marker, stop] as any);
    expect(connected.from.effectSlur.segments[0].text).toBe('H');
    const missing = makeModel(false);
    expect(() => applyTechniques(missing.score, missing.tab, 0, [{ ...marker, fret: 9 }] as any)).toThrow('uniquely');
    const invalidFinger = makeModel(false);
    expect(() => applyTechniques(invalidFinger.score, invalidFinger.tab, 0, [{ ...marker, kind: 'fingering', type: '', number: '5' }] as any)).toThrow('fingers 1–4');
    const tefFinger = makeModel(false);
    applyTechniques(tefFinger.score, tefFinger.tab, 0, [{ ...marker, kind: 'tef-fingering', type: '', number: '9' }] as any);
    expect(tefFinger.from.beat.text).toBe('TEF 9');
  });
  it('preserves alternate tuning and removes only verified duplicate staff music', () => {
    const preview = readMusicXml(fixture(), 'Minor tune.musicxml');
    expect(preview.score.title).toBe('Minor tune');
    expect(preview.score.tracks[0].staves).toHaveLength(1);
    const staff = preview.score.tracks[0].staves[0];
    expect(staff.tuning).toEqual([63, 60, 55, 48, 67]);
    const notes = staff.bars[0].voices.flatMap(voice => voice.beats.flatMap(beat => beat.notes));
    expect(notes.map(note => note.realValue)).toEqual([60]);
    expect(preview.source).toBe(fixture());
  });
  it('rejects independent music instead of silently discarding a staff', () => {
    expect(() => readMusicXml(fixture('D'), 'test.xml')).toThrow('independent');
  });
  it('rejects unsupported documents and entities', () => {
    expect(() => readMusicXml('<html/>', 'test.xml')).toThrow('partwise');
    expect(() => readMusicXml('<!ENTITY unsafe "abc">' + fixture(), 'test.xml')).toThrow('entity');
  });
  it('rejects malformed technique sources and ignores unsupported technical tags', () => {
    vi.stubGlobal('DOMParser', class { parseFromString() { return { getElementsByTagName: () => [{}] }; } });
    expect(() => extractTechniques('<score-partwise/>')).toThrow('Invalid MusicXML');
    vi.stubGlobal('DOMParser', DOMParser);
    expect(() => extractTechniques('<score-partwise/>')).toThrow('no part');
    const unknown = techniques.replace('<hammer-on type="start">H</hammer-on>', '<other-technical>unrelated marker</other-technical>');
    expect(extractTechniques(unknown).markers).toHaveLength(3);
    const forward = techniques.replace('<note>', '<forward><duration>1</duration></forward><note>');
    expect(extractTechniques(forward).markers.length).toBeGreaterThan(0);
    expect(() => extractTechniques(techniques.replace('<note>', '<note><grace/>'))).toThrow('Grace-note');
  });
  it('rejects oversized and structurally unsupported scores', () => {
    expect(() => readMusicXml('x'.repeat(2_000_001), 'big.xml')).toThrow('2 MB');
    const loader = vi.spyOn(importer.ScoreLoader, 'loadScoreFromBytes');
    loader.mockReturnValueOnce({ tracks: [], masterBars: [] } as any);
    expect(() => readMusicXml(fixture(), 'empty.xml')).toThrow('one banjo part');
    loader.mockReturnValueOnce({ tracks: [{ staves: [] }], masterBars: [] } as any);
    expect(() => readMusicXml(fixture(), 'no-tab.xml')).toThrow('five-string');
    loader.mockReturnValueOnce({ tracks: [{ staves: [{ tuning: [63, 60, 55, 48, 67] }] }], masterBars: Array.from({ length: 257 }) } as any);
    expect(() => readMusicXml(fixture(), 'too-many.xml')).toThrow('256 measures');
    loader.mockRestore();
  });
  it('uses the filename when the MusicXML title is blank', () => {
    const preview = readMusicXml(techniques.replace('<work-title>Technique exercise</work-title>', ''), 'fallback.musicxml');
    expect(preview.score.title).toBe('fallback');
  });
  it('stores the original imported document with bounded metadata', () => {
    const document = toImportedScoreDocument({ score: { title: 'A'.repeat(200) }, filename: 'B'.repeat(200), sourceFormat: 'tef', source: '<score-partwise/> ' } as any, ['warning']);
    expect(document).toMatchObject({ version: 2, kind: 'musicxml', title: 'A'.repeat(160), sourceName: 'B'.repeat(160), sourceFormat: 'tef', warnings: ['warning'] });
  });
  it('rejects technique markers with unsupported types', () => {
    expect(() => readMusicXml(techniques.replace('<hammer-on type="start">H</hammer-on>', '<hammer-on type="continue">H</hammer-on>'), 'bad-type.xml')).toThrow('Unsupported');
  });
});
