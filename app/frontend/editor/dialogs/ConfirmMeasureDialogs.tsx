import type { RefObject } from 'react';
import type { RepeatEndings, RepeatRegion } from '../../music/musicxml-editor';
import { useModalDialog } from '../useModalDialog';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Destructive confirmations focus Cancel by default.
export function DeleteMeasureDialog({ pending, onConfirm, onClose, returnFocus }: {
  pending: { measureIndex: number; noteCount: number; restCount: number; labelCount: number } | null;
  onConfirm: () => void; onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(pending !== null, returnFocus);
  return <dialog ref={ref} className="duplicate-dialog" aria-label="Delete measure" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>Delete measure {pending ? pending.measureIndex + 1 : ''}?</h2>
    <p>This permanently removes {plural(pending?.noteCount ?? 0, 'note')}, {plural(pending?.restCount ?? 0, 'rest')}, and {plural(pending?.labelCount ?? 0, 'local label')} from this score. Undo can restore them during this editing session.</p>
    <p>Edit and playback selections touching this measure will clear.</p>
    <div className="duplicate-dialog-actions"><button type="button" data-dialog-first onClick={onClose}>Cancel</button><button type="button" onClick={onConfirm}>Delete measure</button></div>
  </dialog>;
}

export function DuplicateMeasureDialog({ pending, onConfirm, onClose, returnFocus }: {
  pending: { measureIndex: number; noteCount: number; restCount: number; excluded: string[] } | null;
  onConfirm: () => void; onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(pending !== null, returnFocus);
  return <dialog ref={ref} className="duplicate-dialog" aria-label="Duplicate measure" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>Duplicate measure {pending ? pending.measureIndex + 1 : ''}?</h2>
    <p>The copy will include {plural(pending?.noteCount ?? 0, 'note')} and {plural(pending?.restCount ?? 0, 'rest')}, plus local labels and contained techniques.</p>
    <p>The copy will exclude:</p>
    {pending?.excluded.length ? <ul>{pending.excluded.map(item => <li key={item}>{item}</li>)}</ul> : <p>No external spans or repeat markers.</p>}
    <div className="duplicate-dialog-actions"><button type="button" data-dialog-first onClick={onClose}>Cancel</button><button type="button" onClick={onConfirm}>Duplicate measure</button></div>
  </dialog>;
}

export function RepeatRemovalDialog({ removal, error, onConfirm, onClose, returnFocus }: {
  removal: { region: RepeatRegion; endings: RepeatEndings | null } | null; error: string;
  onConfirm: () => void; onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(removal !== null, returnFocus);
  return <dialog ref={ref} className="duplicate-dialog" aria-label="Clear repeat and endings" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>Clear repeat in measures {removal ? `${removal.region.start + 1}–${removal.region.end + 1}` : ''}?</h2>
    {removal?.endings ? <p>This also removes dependent first ending in measures {removal.endings.firstStart + 1}–{removal.endings.firstEnd + 1} and second ending in measures {removal.endings.secondStart + 1}–{removal.endings.secondEnd + 1}. Notes and rests remain.</p>
      : <p>The repeat markers will be removed. Notes and rests remain.</p>}
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="duplicate-dialog-actions"><button type="button" data-dialog-first onClick={onClose}>Cancel</button>
      <button type="button" onClick={onConfirm}>Clear repeat and endings</button></div>
  </dialog>;
}
