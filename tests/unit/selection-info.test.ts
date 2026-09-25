import { describe, expect, it } from 'vitest';
import { demo } from '../../app/frontend/music/score';
import { inspectSelection, tiePosition } from '../../app/frontend/editor/selectionInfo';

const note = { track: 1, staff: 1, measure: 1, event: 1, voice: 1, string: 3, fret: 0, kind: 'note' as const, noteId: 1, graceIndex: null, graceGroupId: null };

describe('selection info', () => {
  it('reports nothing without a selection', () => {
    const info = inspectSelection(null, null, demo, '', 'fret');
    expect(info.selectedDetails).toBeNull();
    expect(info.moveOutcome).toBeNull();
    expect(info.selectedRhythm).toBeNull();
    expect(info.selectedTransitions).toEqual([]);
    expect(info.selectedHasGrace).toBe(false);
  });

  it('describes a native note and the outcome of moving it', () => {
    const info = inspectSelection(note, null, demo, '2', 'pitch');
    expect(info.selectedDetails?.pitch).toMatch(/^[A-G]#?\d$/);
    expect(info.selectedRhythm).toMatchObject({ denominator: demo.measures[0].beats[0].duration, dots: 0, rest: false });
    expect(info.selectedTechniques).toEqual({ picking: 'none', fretting: 'none', bend: 'none' });
    expect(info.moveOutcome?.destination).toBe(2);
    const same = inspectSelection(note, null, demo, '3', 'fret');
    expect(same.moveOutcome).toBeNull();
    expect(tiePosition(note)).toEqual({ measure: 0, beat: 0, voice: 1, string: 3, fret: 0 });
  });
});
