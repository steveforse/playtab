import { describe, expect, it } from 'vitest';
import { DURATION_DENOMINATORS, REST_SPACE_ERROR, addTime, compareTime, durationTime, fillRestTime, planDurationChange, rationalTime, subtractTime } from '../../app/frontend/editor/rhythm';

describe('ED-10 exact rhythm arithmetic', () => {
  it('represents all seven buttons and dotted values without floats', () => {
    expect(DURATION_DENOMINATORS.map(value => durationTime(value))).toEqual([
      [4n, 1n], [2n, 1n], [1n, 1n], [1n, 2n], [1n, 4n], [1n, 8n], [1n, 16n],
    ]);
    expect(durationTime(4, true)).toEqual([3n, 2n]);
    expect(durationTime(64, true)).toEqual([3n, 32n]);
  });

  it('splits and fills exact rest space using largest undotted values', () => {
    expect(fillRestTime(subtractTime(durationTime(4), durationTime(8)))).toEqual([8]);
    expect(fillRestTime(addTime(durationTime(8), durationTime(16)))).toEqual([8, 16]);
    expect(fillRestTime(rationalTime(0n))).toEqual([]);
    expect(() => fillRestTime(rationalTime(1n, 3n))).toThrow('cannot be filled exactly');
    expect(() => fillRestTime(rationalTime(-1n))).toThrow('cannot be negative');
  });

  it('compares fractions by cross-products, including a pickup and triplet', () => {
    const pickup = rationalTime(1n, 2n);
    const tripletChild = rationalTime(1n, 3n);
    expect(compareTime(pickup, tripletChild)).toBe(1);
    expect(addTime(tripletChild, addTime(tripletChild, tripletChild))).toEqual(durationTime(4));
  });

  it('shortens into immediate rests and lengthens only through contiguous rests', () => {
    expect(planDurationChange(durationTime(4), durationTime(8), [{ duration: durationTime(4), rest: true }]))
      .toEqual({ insertRests: [8], consumeRests: 0, leaveRests: [] });
    expect(planDurationChange(durationTime(8), durationTime(4), [{ duration: durationTime(8), rest: true }, { duration: durationTime(4), rest: false }]))
      .toEqual({ insertRests: [], consumeRests: 1, leaveRests: [] });
    expect(planDurationChange(durationTime(8), durationTime(4), [{ duration: durationTime(4), rest: true }]))
      .toEqual({ insertRests: [], consumeRests: 1, leaveRests: [8] });
    expect(() => planDurationChange(durationTime(4), durationTime(2), [{ duration: durationTime(4), rest: false }]))
      .toThrow(REST_SPACE_ERROR);
    expect(() => planDurationChange(durationTime(4), durationTime(2), [{ duration: durationTime(8), rest: true }]))
      .toThrow(REST_SPACE_ERROR);
  });
});
