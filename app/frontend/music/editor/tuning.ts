// Open-string tuning and capo arithmetic shared by import and editing.
import type { model } from '@coderline/alphatab';

// The usual 5th-string spike for a neck capo: the 5th string starts at the
// 5th fret, so capo 2 pairs with a spike at 7.
export const defaultFifthCapo = (capo: number) => capo > 0 ? capo + 5 : null;

// Semitones the 5th string sounds above its open tuning, relative to what a
// capo applied to every string would give it.
export function fifthStringOffset(capo: number, fifthCapo: number | null) {
  return (fifthCapo === null ? 0 : fifthCapo - 5) - capo;
}

type OffsetScore = model.Score & { playtabFifthStringOffset?: number };

// alphaTab applies the capo to every string. A 5th-string capo other than
// capo + 5 sounds by offsetting the 5th string's playback tuning; the offset
// is recorded so editing can recover the written open tuning.
export function applyFifthStringCapo(score: model.Score, tab: model.Staff, source: string) {
  const field = /<miscellaneous-field\s+name="playtab-fifth-string-capo"\s*>([^<]*)</.exec(source)?.[1]?.trim();
  if (field === undefined) return;
  const fifthCapo = field === 'none' ? null : Number(field);
  if (fifthCapo !== null && !Number.isInteger(fifthCapo)) return;
  const offset = fifthStringOffset(tab.capo, fifthCapo);
  if (!offset || tab.tuning.length !== 5) return;
  tab.tuning[4] += offset;
  (score as OffsetScore).playtabFifthStringOffset = offset;
}

// The written open-string tuning (strings 1–5), without any playback offset.
export function openTabTuning(score: model.Score): number[] {
  const tuning = [...(score.tracks?.[0]?.staves?.[0]?.tuning ?? [])];
  const offset = (score as OffsetScore).playtabFifthStringOffset ?? 0;
  if (offset && tuning.length === 5) tuning[4] -= offset;
  return tuning;
}
