import { describe, it, expect, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { midi, Settings } from '@coderline/alphatab';
import fs from 'node:fs';
import { readMusicXml } from '../../app/frontend/music/musicxml';
vi.stubGlobal('DOMParser', DOMParser);
vi.stubGlobal('XMLSerializer', XMLSerializer);
const fixture = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8');
const plain = fixture.replace(/<(hammer-on|pull-off)\b[^>]*(?:\/>|>[^<]*<\/\1>)/g, '');
function events(xml: string) {
  const { score } = readMusicXml(xml, 'test.xml');
  const file = new midi.MidiFile();
  new midi.MidiFileGenerator(score, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
  return file.events;
}
describe('technique playback contract', () => {
  it('plays H/PO pairs as held-note pitch steps without destination reattacks', () => {
    const played = events(fixture).filter((e): e is midi.NoteOnEvent => e instanceof midi.NoteOnEvent);
    const picked = events(plain).filter((e): e is midi.NoteOnEvent => e instanceof midi.NoteOnEvent);
    expect(played).toHaveLength(2);
    expect(picked).toHaveLength(4);
    expect(played.map(n => n.noteKey)).toEqual([picked[0].noteKey, picked[2].noteKey]);

    const bends = events(fixture).filter((e): e is midi.NoteBendEvent => e instanceof midi.NoteBendEvent);
    expect(bends.filter(b => b.value !== 2_147_483_648).map(b => [b.tick, b.noteKey])).toEqual([
      [960, picked[0].noteKey], [2880, picked[2].noteKey],
    ]);
    const transitions = bends.filter(b => b.value !== 2_147_483_648);
    expect(transitions.map(b => (b as midi.NoteBendEvent & { isHammerPull?: boolean }).isHammerPull)).toEqual([true, true]);
    expect(transitions.map(b => (b as midi.NoteBendEvent & { hammerPullDestinationKey?: number }).hammerPullDestinationKey)).toEqual([
      picked[1].noteKey, picked[3].noteKey,
    ]);
    expect(transitions[0].value).toBeGreaterThan(2_147_483_648);
    expect(transitions[1].value).toBeLessThan(2_147_483_648);
  });
  it('emits changing pitch events for imported bends', () => {
    const bent = plain.replace('</technical>', '<bend><bend-alter>1</bend-alter></bend></technical>');
    const pitch = events(bent).filter((e): e is midi.NoteBendEvent => e instanceof midi.NoteBendEvent);
    expect(new Set(pitch.map(e => e.value)).size).toBeGreaterThan(2);
  });
  it('emits changing pitch events for imported slides', () => {
    let index = 0;
    const slide = plain.replace(/<\/notations>/g, end => ++index === 1 ? '<slide type="start" number="1"/>' + end : index === 2 ? '<slide type="stop" number="1"/>' + end : end);
    const pitch = events(slide).filter((e): e is midi.NoteBendEvent => e instanceof midi.NoteBendEvent);
    expect(new Set(pitch.map(e => e.value)).size).toBeGreaterThan(2);
    expect(pitch.some(e => (e as midi.NoteBendEvent & { isHammerPull?: boolean }).isHammerPull)).toBe(false);
  });
});
