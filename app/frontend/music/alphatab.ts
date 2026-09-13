import { model, Settings } from '@coderline/alphatab';
import { validateScore, type Score } from './score';

export function toAlphaTab(document: Score): model.Score {
  validateScore(document);
  const score = new model.Score();
  score.title = document.title;
  const track = new model.Track();
  track.name = '5-string banjo';
  track.playbackInfo.program = 105; // Zero-based General MIDI banjo.
  score.addTrack(track);
  const staff = new model.Staff();
  staff.stringTuning = new model.Tuning('Open G', [...document.tuning], false);
  staff.showTablature = true;
  staff.showStandardNotation = false;
  track.addStaff(staff);
  document.measures.forEach((measure, index) => {
    const master = new model.MasterBar();
    master.timeSignatureNumerator = 4;
    master.timeSignatureDenominator = 4;
    if (index === 0) master.tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0, document.tempo, 2));
    score.addMasterBar(master);
    const bar = new model.Bar();
    staff.addBar(bar);
    const voice = new model.Voice();
    bar.addVoice(voice);
    for (const item of measure.beats) {
      const beat = new model.Beat();
      beat.duration = item.duration;
      voice.addBeat(beat);
      for (const itemNote of item.notes) {
        const note = new model.Note();
        // alphaTab counts strings bottom-up, our document uses musician numbering.
        note.string = 6 - itemNote.string;
        note.fret = itemNote.fret;
        beat.addNote(note);
      }
    }
  });
  score.finish(new Settings());
  return score;
}
