import { useEffect, useState, type RefObject } from 'react';
import { OPEN_G_TUNING } from '../../music/musicxml';
import { TuningPicker } from '../TuningPicker';
import { useModalDialog } from '../useModalDialog';

export type NewScoreDraft = { title: string; tempo: string; numerator: string; denominator: string; measures: string; tuning: number[] };
const defaults = (): NewScoreDraft => ({ title: 'Untitled', tempo: '96', numerator: '4', denominator: '4', measures: '8', tuning: [...OPEN_G_TUNING] });

// A blank score's title, tempo, meter, length and tuning. onCreate returns
// a validation error, or null once the App takes over (unsaved-work guard).
export function NewScoreDialog({ open, onCreate, onClose, returnFocus }: {
  open: boolean; onCreate: (draft: NewScoreDraft) => string | null; onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(open, returnFocus);
  const [newScoreDraft, setNewScoreDraft] = useState<NewScoreDraft>(defaults);
  const [newScoreError, setNewScoreError] = useState('');
  useEffect(() => { if (open) { setNewScoreDraft(defaults()); setNewScoreError(''); } }, [open]);
  return (
  <dialog ref={ref} className="duplicate-dialog settings-dialog" aria-label="New score" onCancel={event => { event.preventDefault(); onClose(); }}>
    {open && <>
    <h2>New score</h2>
    <label className="anchor-text">Title<input aria-label="New score title" data-dialog-first="" maxLength={160} value={newScoreDraft.title}
      onChange={event => { setNewScoreError(''); setNewScoreDraft(draft => ({ ...draft, title: event.target.value })); }} /></label>
    <div className="insert-dialog-fields">
      <label>Tempo (BPM)<input aria-label="New score tempo" type="number" inputMode="numeric" min={30} max={240} value={newScoreDraft.tempo}
        onChange={event => { setNewScoreError(''); setNewScoreDraft(draft => ({ ...draft, tempo: event.target.value })); }} /></label>
      <label>Measures<input aria-label="New score measures" type="number" inputMode="numeric" min={1} max={256} value={newScoreDraft.measures}
        onChange={event => { setNewScoreError(''); setNewScoreDraft(draft => ({ ...draft, measures: event.target.value })); }} /></label>
      <label>Beats<select aria-label="New score beats" value={newScoreDraft.numerator} onChange={event => setNewScoreDraft(draft => ({ ...draft, numerator: event.target.value }))}>
        {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
      <label>Beat unit<select aria-label="New score beat unit" value={newScoreDraft.denominator} onChange={event => setNewScoreDraft(draft => ({ ...draft, denominator: event.target.value }))}>
        {[2, 4, 8, 16].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    <fieldset className="settings-section settings-tuning"><legend>Tuning</legend>
      <TuningPicker label="new score" tuning={newScoreDraft.tuning} onChange={tuning => { setNewScoreError(''); setNewScoreDraft(draft => ({ ...draft, tuning })); }} />
    </fieldset>
    {newScoreError && <p className="alert" role="alert">{newScoreError}</p>}
    <div className="duplicate-dialog-actions">
      <button type="button" onClick={() => onClose()}>Cancel</button>
      <button type="button" onClick={() => setNewScoreError(onCreate(newScoreDraft) ?? '')}>Create score</button>
    </div>
    </>}
  </dialog>
  );
}
