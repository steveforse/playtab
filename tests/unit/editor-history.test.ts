import { describe, expect, it } from 'vitest';
import { emptyHistory, record, travel, type Snapshot } from '../../app/frontend/editor/history';
import { demo } from '../../app/frontend/music/score';

const snapshot = (title: string): Snapshot => ({ document: { ...demo, title }, selection: null });
describe('editor history', () => {
  it('groups digit entry, restores whole snapshots, and clears redo after a new edit', () => {
    const original = snapshot('original');
    let history = record(emptyHistory(), { before: original, after: snapshot('1'), description: 'Fret 1', group: 'entry' });
    history = record(history, { before: snapshot('1'), after: snapshot('12'), description: 'Fret 12', group: 'entry' });
    expect(history.undo).toHaveLength(1);
    const undo = travel(history, 'undo')!;
    expect(undo.snapshot).toEqual(original);
    expect(travel(undo.history, 'redo')!.snapshot).toEqual(snapshot('12'));
    expect(record(undo.history, { before: original, after: snapshot('new'), description: 'New' }).redo).toEqual([]);
  });
  it('ignores no-ops and bounds retained actions', () => {
    let history = emptyHistory();
    const current = snapshot('same');
    expect(record(history, { before: current, after: current, description: 'No-op' })).toBe(history);
    for (let i = 0; i < 110; i++) history = record(history, { before: snapshot(String(i)), after: snapshot(String(i + 1)), description: 'Edit' });
    expect(history.undo).toHaveLength(100);
    expect(history.undo[0].before.document.title).toBe('10');
    expect(travel(emptyHistory(), 'undo')).toBeNull();
  });
});
