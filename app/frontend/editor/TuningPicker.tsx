import type { ReactNode } from 'react';
import { TUNING_LIMITS } from '../music/musicxml-editor';
import { midiName } from './labels';

// Open strings 1–5 (1 is the highest-pitched long string, 5 the short drone).
// Some named tunings are another tuning played with a capo (the 5th-string
// capo follows at capo + 5); those carry the capo.
export type TuningPresetInfo = { name: string; tuning: readonly number[]; capo?: number };
export const TUNING_PRESETS: ReadonlyArray<TuningPresetInfo> = [
  { name: 'Open G', tuning: [62, 59, 55, 50, 67] },
  { name: 'Double C', tuning: [62, 60, 55, 48, 67] },
  { name: 'Sawmill (G modal)', tuning: [62, 60, 55, 50, 67] },
  { name: 'Standard C', tuning: [62, 59, 55, 48, 67] },
  { name: 'Open C', tuning: [64, 60, 55, 48, 67] },
  { name: 'Open D', tuning: [62, 57, 54, 50, 66] },
  { name: 'Double D', tuning: [62, 60, 55, 48, 67], capo: 2 },
  { name: 'Open A', tuning: [62, 59, 55, 50, 67], capo: 2 },
];

const LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// How players say a tuning: 5th string first, lower-case, e.g. "gDGBD".
export const tuningLetters = (tuning: readonly number[]) =>
  [4, 3, 2, 1, 0].map((string, at) => { const name = LETTERS[((tuning[string] % 12) + 12) % 12]; return at === 0 ? name.toLowerCase() : name; }).join('');
const sameTuning = (preset: TuningPresetInfo, tuning: readonly number[]) => preset.tuning.every((value, index) => value === tuning[index]);
// A capo preset matches only its own capo; a plain preset matches its
// tuning at any capo. Without a capo (New score), only plain presets apply.
export const tuningPreset = (tuning: readonly number[], capo?: number) =>
  (capo === undefined ? undefined : TUNING_PRESETS.find(preset => preset.capo !== undefined && preset.capo === capo && sameTuning(preset, tuning)))
  ?? TUNING_PRESETS.find(preset => preset.capo === undefined && sameTuning(preset, tuning));
// The pitches heard with a capo: every string rises, the 5th with its own capo.
const sounding = (preset: TuningPresetInfo) => preset.tuning.map(value => value + (preset.capo ?? 0));
const presetLabel = (preset: TuningPresetInfo) => `${preset.name} — ${tuningLetters(sounding(preset))}${preset.capo ? ` (${tuningPreset(preset.tuning)?.name ?? 'tuning'}, capo ${preset.capo})` : ''}`;
const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

// A preset menu plus one compact note menu per string (5th string first).
// Editing a string by hand turns the preset into "Custom".
export function TuningPicker({ tuning, capo, onChange, label = '', children }: {
  tuning: number[]; capo?: number; onChange: (tuning: number[], capo?: number) => void; label?: string; children?: ReactNode;
}) {
  const preset = tuningPreset(tuning, capo);
  const presets = TUNING_PRESETS.filter(item => capo !== undefined || item.capo === undefined);
  // A capo preset sets its capo; leaving one for a plain preset removes the
  // capo it added, while a plain-to-plain change keeps the current capo.
  const choose = (chosen: TuningPresetInfo) => onChange([...chosen.tuning],
    capo === undefined ? undefined : chosen.capo ?? (preset?.capo !== undefined ? 0 : capo));
  const prefix = label ? `${label} ` : '';
  return <>
    <div className="settings-tuning-top"><label className="anchor-text">Preset<select aria-label={capital(`${prefix}tuning preset`)} value={preset?.name ?? ''}
      onChange={event => { const chosen = presets.find(item => item.name === event.target.value); if (chosen) choose(chosen); }}>
      {!preset && <option value="">Custom — {tuning.length === 5 ? tuningLetters(tuning) : ''}</option>}
      {presets.map(item => <option key={item.name} value={item.name}>{presetLabel(item)}</option>)}
    </select></label>{children}</div>
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
