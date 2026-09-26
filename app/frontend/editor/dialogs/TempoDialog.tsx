import { useEffect, useState, type RefObject } from 'react';
import { TEMPO_LIMITS, type LocalTempoInfo } from '../../music/musicxml-editor';
import { useModalDialog } from '../useModalDialog';

export type TempoDialogTarget = { selection: { measure: number; beat: number }; info: LocalTempoInfo };

// onApply returns an error message to show, or null once the tempo is set.
export function TempoDialog({ target, onApply, onClose, returnFocus }: {
  target: TempoDialogTarget | null; onApply: (tempo: number | null) => string | null; onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(target !== null, returnFocus);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (target) { setDraft(String(target.info.local ?? target.info.inherited)); setError(''); } }, [target]);
  const apply = (tempo: number | null) => setError(onApply(tempo) ?? '');
  return <dialog ref={ref} className="duplicate-dialog" aria-label="Set tempo here" onCancel={event => { event.preventDefault(); onClose(); }}>
    {target && <>
      <h2>Set tempo here</h2>
      {target.info.opening ? <p>The first beat uses the opening tempo ({target.info.local ?? target.info.inherited} BPM). Change it in Score settings.</p> : <>
        <p>Measure {target.selection.measure}, beat {target.selection.beat}. {target.info.local !== null
          ? `A local tempo of ${target.info.local} BPM starts here; without it, ${target.info.inherited} BPM continues.`
          : `${target.info.inherited} BPM continues here from earlier in the score.`}</p>
        <label className="anchor-text">Tempo (BPM)<input aria-label="Tempo" data-dialog-first="" type="number" inputMode="numeric" min={TEMPO_LIMITS.min} max={TEMPO_LIMITS.max}
          value={draft} onChange={event => { setError(''); setDraft(event.target.value); }} /></label>
      </>}
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="duplicate-dialog-actions">
        <button type="button" data-dialog-first={target.info.opening ? '' : undefined} onClick={onClose}>Cancel</button>
        {!target.info.opening && target.info.local !== null && <button type="button" onClick={() => apply(null)}>Remove local tempo</button>}
        {!target.info.opening && <button type="button" onClick={() => apply(Number(draft))}>Apply tempo</button>}
      </div>
    </>}
  </dialog>;
}
