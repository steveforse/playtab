import type { ScoreSelection } from '../Player';
import type { StoredScore } from '../music/score';
import type { SourceIdentityMap } from '../music/source-identity';

export type Snapshot = { document: StoredScore; selection: ScoreSelection | null; sourceIdentity?: SourceIdentityMap };
type Entry = { before: Snapshot; after: Snapshot; description: string; group?: string };
export type History = { undo: Entry[]; redo: Entry[] };
export const emptyHistory = (): History => ({ undo: [], redo: [] });
export const documentKey = (document: StoredScore) => JSON.stringify(document);

export function record(history: History, entry: Entry): History {
  if (documentKey(entry.before.document) === documentKey(entry.after.document)) return history;
  const undo = [...history.undo];
  const last = undo.at(-1);
  if (entry.group && last?.group === entry.group) {
    undo[undo.length - 1] = { ...entry, before: last.before };
    if (documentKey(last.before.document) === documentKey(entry.after.document)) undo.pop();
  } else undo.push(entry);
  // Retain bounded, serialized documents rather than alphaTab models and audio.
  while (undo.length > 100 || (undo.length && new TextEncoder().encode(JSON.stringify(undo)).byteLength > 32 * 1024 * 1024)) undo.shift();
  return { undo, redo: [] };
}

export function travel(history: History, direction: 'undo' | 'redo') {
  const entries = history[direction];
  const entry = entries.at(-1);
  if (!entry) return null;
  return {
    snapshot: direction === 'undo' ? entry.before : entry.after,
    description: `${direction === 'undo' ? 'Undo' : 'Redo'}: ${entry.description}`,
    history: direction === 'undo'
      ? { undo: entries.slice(0, -1), redo: [...history.redo, entry] }
      : { undo: [...history.undo, entry], redo: entries.slice(0, -1) },
  };
}
