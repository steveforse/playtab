import { describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { readMusicXml } from '../../app/frontend/music/musicxml';
import { changeMusicXmlMeter, changeMusicXmlPickup, deleteMusicXmlMeasure, duplicateMusicXmlMeasure, insertMusicXmlMeasure,
  inspectMusicXmlMeterRange } from '../../app/frontend/music/musicxml-editor';

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
