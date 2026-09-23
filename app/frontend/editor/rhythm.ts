// Quarter-note units are exact fractions. Never round a MusicXML duration to
// a floating point tick count before deciding whether a rhythm edit fits.
export type RationalTime = readonly [bigint, bigint];
export type DurationDenominator = 1 | 2 | 4 | 8 | 16 | 32 | 64;
export const DURATION_DENOMINATORS: readonly DurationDenominator[] = [1, 2, 4, 8, 16, 32, 64];

export function rationalTime(numerator: bigint, denominator = 1n): RationalTime {
  if (denominator <= 0n) throw new Error('Rhythm denominator must be positive.');
  const gcd = (left: bigint, right: bigint): bigint => right === 0n ? left : gcd(right, left % right);
  const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator) || 1n;
  return [numerator / divisor, denominator / divisor];
}

export const addTime = (left: RationalTime, right: RationalTime): RationalTime =>
  rationalTime(left[0] * right[1] + right[0] * left[1], left[1] * right[1]);
export const subtractTime = (left: RationalTime, right: RationalTime): RationalTime =>
  rationalTime(left[0] * right[1] - right[0] * left[1], left[1] * right[1]);
export const compareTime = (left: RationalTime, right: RationalTime): number =>
  left[0] * right[1] < right[0] * left[1] ? -1 : left[0] * right[1] > right[0] * left[1] ? 1 : 0;

export function durationTime(denominator: DurationDenominator, dotted = false): RationalTime {
  if (!DURATION_DENOMINATORS.includes(denominator)) throw new Error('Unsupported note duration.');
  return rationalTime(dotted ? 6n : 4n, BigInt(denominator));
}

// Largest-first, undotted rest decomposition. The final remainder must be
// exactly representable at 1/64 or the command rejects without mutation.
export function fillRestTime(duration: RationalTime): DurationDenominator[] {
  if (compareTime(duration, rationalTime(0n)) < 0) throw new Error('Rest space cannot be negative.');
  let remaining = duration;
  const result: DurationDenominator[] = [];
  for (const denominator of DURATION_DENOMINATORS) {
    const value = durationTime(denominator);
    while (compareTime(remaining, value) >= 0) {
      result.push(denominator);
      remaining = subtractTime(remaining, value);
    }
  }
  if (compareTime(remaining, rationalTime(0n)) !== 0) throw new Error('This duration cannot be filled exactly with supported rests.');
  return result;
}

export type RestSpacePlan = { insertRests: DurationDenominator[]; consumeRests: number; leaveRests: DurationDenominator[] };
export const REST_SPACE_ERROR = 'Not enough rest space in this measure. Shorten another event or insert a measure.';

export function planDurationChange(current: RationalTime, next: RationalTime,
  following: readonly { duration: RationalTime; rest: boolean }[]): RestSpacePlan {
  if (compareTime(current, rationalTime(0n)) <= 0 || compareTime(next, rationalTime(0n)) <= 0) {
    throw new Error('Event duration must be positive.');
  }
  const change = compareTime(next, current);
  if (change === 0) return { insertRests: [], consumeRests: 0, leaveRests: [] };
  if (change < 0) return { insertRests: fillRestTime(subtractTime(current, next)), consumeRests: 0, leaveRests: [] };
  let needed = subtractTime(next, current);
  let consumed = 0;
  for (const neighbor of following) {
    if (!neighbor.rest) break;
    consumed++;
    needed = subtractTime(needed, neighbor.duration);
    if (compareTime(needed, rationalTime(0n)) <= 0) {
      return { insertRests: [], consumeRests: consumed,
        leaveRests: fillRestTime(rationalTime(-needed[0], needed[1])) };
    }
  }
  throw new Error(REST_SPACE_ERROR);
}
