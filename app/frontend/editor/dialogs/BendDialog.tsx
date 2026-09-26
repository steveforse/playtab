import { useEffect, useState, type RefObject } from 'react';
import type { BendAmount, NoteBend } from '../../music/musicxml-editor';
import { BEND_LABELS } from '../labels';
import { useModalDialog } from '../useModalDialog';

export type BendDialogTarget = { selection: { measure: number; beat: number; string: number | null }; existing: NoteBend | 'none' | null; reason?: string };

// A null `existing` is an imported curve kept as written; applying replaces it.
export function BendDialog({ target, onApply, onClose, returnFocus }: {
  target: BendDialogTarget | null; onApply: (bend: NoteBend | null) => void; onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(target !== null, returnFocus);
  const [draft, setDraft] = useState<NoteBend>({ amount: 2, shape: 'bend' });
  useEffect(() => {
    if (target) setDraft(target.existing && target.existing !== 'none' ? target.existing : { amount: 2, shape: 'bend' });
  }, [target]);
  return <dialog ref={ref} className="duplicate-dialog bend-dialog" aria-label="Bend" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>Bend</h2>
    <p>Measure {target?.selection.measure}, beat {target?.selection.beat}, string {target?.selection.string}. The pitch reaches the bend by the middle of the note.</p>
    {target?.reason && <p className="grace-read-only" role="note">{target.reason}</p>}
    <div className="insert-dialog-fields">
      <label>Amount<select data-dialog-first="" value={draft.amount} onChange={event => setDraft(current => ({ ...current, amount: Number(event.target.value) as BendAmount }))}>
        {([1, 2, 3, 4] as BendAmount[]).map(amount => <option key={amount} value={amount}>{BEND_LABELS[amount]}</option>)}</select></label>
      <label>Shape<select value={draft.shape} onChange={event => setDraft(current => ({ ...current, shape: event.target.value as NoteBend['shape'] }))}>
        <option value="bend">Bend</option><option value="release">Bend and release</option></select></label>
    </div>
    <div className="duplicate-dialog-actions">
      <button type="button" onClick={onClose}>Cancel</button>
      {target?.existing !== 'none' && <button type="button" onClick={() => onApply(null)}>Remove bend</button>}
      <button type="button" onClick={() => onApply(draft)}>{target?.existing === null ? 'Replace bend' : 'Apply bend'}</button>
    </div>
  </dialog>;
}
