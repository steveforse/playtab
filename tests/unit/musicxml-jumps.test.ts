import { describe, expect, it } from 'vitest';
import { midi, model, Settings } from '@coderline/alphatab';
import { readMusicXml } from '../../app/frontend/music/musicxml';
import './editor/support';

const PITCHES = [['G', 0, 3], ['G', 1, 3], ['A', 0, 3], ['A', 1, 3], ['B', 0, 3], ['C', 0, 4], ['C', 1, 4], ['D', 0, 4]] as const;

// One whole note per measure on the 3rd string, fret = measure index, with
// the marks the TEF3 importer writes for a reading list.
function score(marks: Record<number, { left?: string; right?: string; after?: string }>) {
  const measures = PITCHES.slice(0, Object.keys(marks).length).map(([step, alter, octave], index) => {
    const mark = marks[index + 1] ?? {};
    const attributes = index === 0 ? `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
      <clef><sign>TAB</sign><line>5</line></clef><staff-details><staff-lines>5</staff-lines>
      <staff-tuning line="1"><tuning-step>G</tuning-step><tuning-octave>4</tuning-octave></staff-tuning>
      <staff-tuning line="2"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
      <staff-tuning line="3"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
      <staff-tuning line="4"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
      <staff-tuning line="5"><tuning-step>D</tuning-step><tuning-octave>4</tuning-octave></staff-tuning></staff-details></attributes>` : '';
    return `<measure number="${index + 1}">${attributes}${mark.left ?? ''}<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>
      <duration>4</duration><voice>1</voice><type>whole</type><notations><technical><string>3</string><fret>${index}</fret></technical></notations></note>${mark.after ?? ''}${mark.right ?? ''}</measure>`;
  });
  return `<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Banjo</part-name></score-part></part-list><part id="P1">${measures.join('')}</part></score-partwise>`;
}

function playedFrets(source: string) {
  const preview = readMusicXml(source, 'jumps.musicxml');
  const file = new midi.MidiFile();
  new midi.MidiFileGenerator(preview.score, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate();
  return { preview, frets: file.events.filter((event): event is midi.NoteOnEvent => event instanceof midi.NoteOnEvent).map(event => event.noteKey - 55) };
}

const segno = '<direction placement="above"><direction-type><segno/></direction-type><sound segno="segno"/></direction>';
const coda = '<direction placement="above"><direction-type><coda/></direction-type><sound coda="coda"/></direction>';

describe('TEF3 reading-list jumps', () => {
  it('plays a D.S. al Coda: back to the segno, then from To Coda to the coda', () => {
    const { preview, frets } = playedFrets(score({ 1: {}, 2: { left: segno }, 3: { after: '<sound tocoda="coda"/>' }, 4: { after: '<sound dalsegno="segno"/>' }, 5: { left: coda } }));
    expect(frets).toEqual([0, 1, 2, 3, 1, 2, 4]);
    expect(preview.score.masterBars[3].directions?.has(model.Direction.JumpDalSegnoAlCoda)).toBe(true);
  });

  it('plays a D.C. al Fine and leaves a plain D.C. alone', () => {
    const fine = playedFrets(score({ 1: {}, 2: { after: '<sound fine="yes"/>' }, 3: {}, 4: { after: '<sound dacapo="yes"/>' } }));
    expect(fine.frets).toEqual([0, 1, 2, 3, 0, 1]);
    const plain = playedFrets(score({ 1: {}, 2: {}, 3: { after: '<sound dacapo="yes"/>' } }));
    expect(plain.frets).toEqual([0, 1, 2, 0, 1, 2]);
    expect(plain.preview.score.masterBars[2].directions?.has(model.Direction.JumpDaCapo)).toBe(true);
  });

  it('plays repeats with first and second endings in reading-list order', () => {
    const { frets } = playedFrets(score({
      1: { left: '<barline location="left"><repeat direction="forward"/></barline>' },
      2: { left: '<barline location="left"><ending number="1" type="start"/></barline>',
        right: '<barline location="right"><bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward" times="2"/></barline>' },
      3: { left: '<barline location="left"><ending number="2" type="start"/></barline>', right: '<barline location="right"><ending number="2" type="stop"/></barline>' },
      4: {},
    }));
    expect(frets).toEqual([0, 1, 0, 2, 3]);
  });
});
