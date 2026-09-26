import { useEffect, useState, type RefObject } from 'react';
import type { InsertBeatOptions } from '../../music/musicxml-editor';
import { DURATION_DENOMINATORS, type DurationDenominator } from '../rhythm';
import { useModalDialog } from '../useModalDialog';

export type InsertBeatDraft = Omit<InsertBeatOptions, 'measure' | 'beat' | 'voice'>;

// Inserts a note or rest before or after the selected beat.
export function InsertBeatDialog({ open, initialString, error, onInsert, onClose, returnFocus }: {
  open: boolean; initialString: number; error: string; onInsert: (draft: InsertBeatDraft) => void; onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(open, returnFocus);
  const [draft, setDraft] = useState<InsertBeatDraft>({ placement: 'after', kind: 'rest', denominator: 4, dotted: false, string: 1, fret: 0 });
  useEffect(() => { if (open) setDraft({ placement: 'after', kind: 'rest', denominator: 4, dotted: false, string: initialString, fret: 0 }); }, [open]);
  return <dialog ref={ref} className="insert-dialog" aria-label="Insert beat" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>Insert beat</h2>
    <p>Following beats move within this voice and measure. Trailing rests make room.</p>
    {open && error && <p className="alert" role="alert">{error}</p>}
    <div className="insert-dialog-fields">
      <label>Position<select data-dialog-first value={draft.placement} onChange={event => setDraft(current => ({ ...current, placement: event.target.value as 'before' | 'after' }))}><option value="before">Before</option><option value="after">After</option></select></label>
      <label>Type<select value={draft.kind} onChange={event => setDraft(current => ({ ...current, kind: event.target.value as 'note' | 'rest' }))}><option value="note">Note</option><option value="rest">Rest</option></select></label>
      <label>Duration<select value={draft.denominator} onChange={event => setDraft(current => ({ ...current, denominator: Number(event.target.value) as DurationDenominator }))}>{DURATION_DENOMINATORS.map(value => <option key={value} value={value}>{value === 1 ? '1' : `1/${value}`}</option>)}</select></label>
      <label className="insert-dialog-check"><input type="checkbox" checked={draft.dotted} onChange={event => setDraft(current => ({ ...current, dotted: event.target.checked }))} />Dotted</label>
      {draft.kind === 'note' && <>
        <label>String<select value={draft.string} onChange={event => setDraft(current => ({ ...current, string: Number(event.target.value) }))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Fret<input type="number" inputMode="numeric" min={0} max={36} step={1} value={draft.fret} onChange={event => setDraft(current => ({ ...current, fret: Number(event.target.value) }))} /></label>
      </>}
    </div>
    <div className="insert-dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button type="button" onClick={() => onInsert(draft)}>Insert</button></div>
  </dialog>;
}
