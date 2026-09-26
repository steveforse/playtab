import { TUNING_LIMITS } from '../music/musicxml-editor';
import { midiName } from './labels';

// Open strings 1–5 (1 is the highest-pitched long string, 5 the short drone).
export const TUNING_PRESETS: ReadonlyArray<{ name: string; tuning: readonly number[] }> = [
  { name: 'Open G', tuning: [62, 59, 55, 50, 67] },
  { name: 'Double C', tuning: [62, 60, 55, 48, 67] },
  { name: 'Sawmill (G modal)', tuning: [62, 60, 55, 50, 67] },
  { name: 'Standard C', tuning: [62, 59, 55, 48, 67] },
  { name: 'Open C', tuning: [64, 60, 55, 48, 67] },
  { name: 'Open D', tuning: [62, 57, 54, 50, 66] },
  { name: 'Double D', tuning: [64, 62, 57, 50, 69] },
  { name: 'Open A', tuning: [64, 61, 57, 52, 69] },
];

const LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// How players say a tuning: 5th string first, lower-case, e.g. "gDGBD".
export const tuningLetters = (tuning: readonly number[]) =>
  [4, 3, 2, 1, 0].map((string, at) => { const name = LETTERS[((tuning[string] % 12) + 12) % 12]; return at === 0 ? name.toLowerCase() : name; }).join('');
export const tuningPreset = (tuning: readonly number[]) => TUNING_PRESETS.find(preset => preset.tuning.every((value, index) => value === tuning[index]));
const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

// A preset menu plus one compact note menu per string (5th string first).
// Editing a string by hand turns the preset into "Custom".
export function TuningPicker({ tuning, onChange, label = '' }: { tuning: number[]; onChange: (tuning: number[]) => void; label?: string }) {
  const preset = tuningPreset(tuning);
  const prefix = label ? `${label} ` : '';
  return <>
    <label className="anchor-text">Preset<select aria-label={capital(`${prefix}tuning preset`)} value={preset?.name ?? ''}
      onChange={event => { const chosen = TUNING_PRESETS.find(item => item.name === event.target.value); if (chosen) onChange([...chosen.tuning]); }}>
      {!preset && <option value="">Custom — {tuning.length === 5 ? tuningLetters(tuning) : ''}</option>}
      {TUNING_PRESETS.map(item => <option key={item.name} value={item.name}>{item.name} — {tuningLetters(item.tuning)}</option>)}
    </select></label>
    <div className="settings-strings" role="group" aria-label={capital(`${prefix}open strings`)}>
      {[5, 4, 3, 2, 1].map(string => {
        const value = tuning[string - 1];
        // An octave either side of the current note; Up/Down step a semitone.
        const notes = Array.from({ length: 25 }, (_, index) => value - 12 + index).filter(note => note >= TUNING_LIMITS.min && note <= TUNING_LIMITS.max);
        return <label key={string} className="settings-string"><span>{string === 5 ? '5th' : string}</span>
          <select aria-label={capital(`${prefix}string ${string} note`)} value={value}
            onChange={event => onChange(tuning.map((item, index) => index === string - 1 ? Number(event.target.value) : item))}>
            {notes.map(note => <option key={note} value={note}>{midiName(note)}</option>)}
          </select></label>;
      })}
    </div>
  </>;
}
