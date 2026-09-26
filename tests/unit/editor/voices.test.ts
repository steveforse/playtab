import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { midi, Settings } from '@coderline/alphatab';
import { readMusicXml } from '../../../app/frontend/music/musicxml';
import { addMusicXmlNote, addMusicXmlVoice, measureTabVoices, removeMusicXmlNotes, removeMusicXmlVoice } from '../../../app/frontend/music/musicxml-editor';
import './support';

const source = fs.readFileSync('tests/fixtures/paired-staff.musicxml', 'utf8');
const noteKeys = (xml: string) => {
  const file = new midi.MidiFile();
  new midi.MidiFileGenerator(readMusicXml(xml, 'voices.musicxml').score, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
  return file.events.filter((event): event is midi.NoteOnEvent => event instanceof midi.NoteOnEvent).map(event => event.noteKey);
};

describe('second voice in a measure', () => {
  it('adds a voice of rests, takes a note in it, and removes it once cleared', () => {
    const original = readMusicXml(source, 'voices.musicxml');
    expect(measureTabVoices(source, 0)).toEqual(['2']);
    const { source: added, voice } = addMusicXmlVoice(source, original.score, 0);
    expect(voice).toBe('3');
    expect(measureTabVoices(added, 0)).toEqual(['2', '3']);
    const withVoice = readMusicXml(added, 'voices.musicxml');
    const voices = withVoice.score.tracks[0].staves[0].bars[0].voices;
    expect(voices[2].beats.every(beat => beat.isRest)).toBe(true);
    expect(noteKeys(added)).toEqual(noteKeys(source));
    expect(() => addMusicXmlVoice(added, withVoice.score, 0)).toThrow('already has a second voice');

    const noted = addMusicXmlNote(added, withVoice.score, { measure: 0, beat: 0, voice: 2, string: 3, fret: 2 });
    const notedPreview = readMusicXml(noted, 'voices.musicxml');
    const second = notedPreview.score.tracks[0].staves[0].bars[0].voices[2].beats[0];
    expect(second.notes.map(note => note.fret)).toEqual([2]);
    expect(noteKeys(noted)).toContain(57);
    expect(noteKeys(noted).length).toBe(noteKeys(source).length + 1);
    expect(() => removeMusicXmlVoice(noted, notedPreview.score, 0)).toThrow('Clear the second voice to rests');

    const cleared = removeMusicXmlNotes(noted, notedPreview.score, { measure: 0, beat: 0, voice: 2 })!.source;
    const removed = removeMusicXmlVoice(cleared, readMusicXml(cleared, 'voices.musicxml').score, 0);
    expect(measureTabVoices(removed, 0)).toEqual(['2']);
    expect(removed.match(/<backup>/g)).toHaveLength(1);
    expect(noteKeys(removed)).toEqual(noteKeys(source));
    expect(() => removeMusicXmlVoice(removed, readMusicXml(removed, 'voices.musicxml').score, 0)).toThrow('has no second voice');
  });

  it('refuses measures it cannot identify or that use other voices', () => {
    const original = readMusicXml(source, 'voices.musicxml');
    expect(() => addMusicXmlVoice(source, original.score, 9)).toThrow('cannot be identified');
    const third = source.replace('<voice>1</voice>', '<voice>3</voice>');
    expect(() => addMusicXmlVoice(third, readMusicXml(third, 'voices.musicxml').score, 0)).toThrow('other voices');
    expect(measureTabVoices(source, 9)).toEqual([]);
  });
});
