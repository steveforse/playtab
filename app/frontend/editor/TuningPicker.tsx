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
const ordinal = (string: number) => ['1st', '2nd', '3rd', '4th', '5th'][string - 1];

// A preset menu plus a semitone stepper per string, shown by note name.
// Editing a string by hand turns the preset into "Custom".
export function TuningPicker({ tuning, onChange, label = '' }: { tuning: number[]; onChange: (tuning: number[]) => void; label?: string }) {
  const preset = tuningPreset(tuning);
  const prefix = label ? `${label} ` : '';
  const step = (string: number, delta: number) => onChange(tuning.map((value, index) => index === string - 1 ? value + delta : value));
  return <>
    <label className="anchor-text">Preset<select aria-label={capital(`${prefix}tuning preset`)} value={preset?.name ?? ''}
      onChange={event => { const chosen = TUNING_PRESETS.find(item => item.name === event.target.value); if (chosen) onChange([...chosen.tuning]); }}>
      {!preset && <option value="">Custom</option>}
      {TUNING_PRESETS.map(item => <option key={item.name} value={item.name}>{item.name} — {tuningLetters(item.tuning)}</option>)}
    </select></label>
    <p className="settings-tuning-summary" aria-live="polite">{preset?.name ?? 'Custom'} · {tuning.length === 5 ? tuningLetters(tuning) : ''}</p>
    <div className="settings-strings">
      {[5, 4, 3, 2, 1].map(string => {
        const value = tuning[string - 1];
        return <div key={string} className="settings-string">
          <span>{ordinal(string)} string</span>
          <button type="button" aria-label={`Lower ${prefix}string ${string}`} disabled={value <= TUNING_LIMITS.min} onClick={() => step(string, -1)}>−</button>
          <output aria-label={capital(`${prefix}string ${string} note`)}>{midiName(value)}</output>
          <button type="button" aria-label={`Raise ${prefix}string ${string}`} disabled={value >= TUNING_LIMITS.max} onClick={() => step(string, 1)}>+</button>
        </div>;
      })}
    </div>
  </>;
}
