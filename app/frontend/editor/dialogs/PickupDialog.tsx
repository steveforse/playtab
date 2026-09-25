import { useEffect, useState, type RefObject } from 'react';
import type { MusicXmlPreview } from '../../music/musicxml';
import { changeMusicXmlPickup } from '../../music/musicxml-editor';
import { useModalDialog } from '../useModalDialog';

type PickupDraft = { numerator: number; denominator: 2 | 4 | 8 | 16 | 32 | 64 };

// The first measure's actual length; onApply returns an error or null.
export function PickupDialog({ target, onApply, onClose, returnFocus }: {
  target: { base: MusicXmlPreview } | null; onApply: (source: string) => string | null; onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(target !== null, returnFocus);
  const [draft, setDraft] = useState<PickupDraft>({ numerator: 1, denominator: 8 });
  const [applyError, setApplyError] = useState('');
  useEffect(() => { if (target) { setDraft({ numerator: 1, denominator: 8 }); setApplyError(''); } }, [target]);
  const preview = (() => {
    if (!target) return null;
    try { return { source: changeMusicXmlPickup(target.base.source, target.base.score, draft.numerator, draft.denominator), error: '' }; }
    catch (failure) { return { source: null, error: (failure as Error).message }; }
  })();
  return <dialog ref={ref} className="duplicate-dialog" aria-label="Pickup" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>Pickup length</h2>
    <p>Set the first measure’s actual length. It must be shorter than the nominal time signature.</p>
    <div className="insert-dialog-fields">
      <label>Numerator<input data-dialog-first type="number" min={1} step={1} value={draft.numerator}
        onChange={event => { setApplyError(''); setDraft(current => ({ ...current, numerator: Number(event.target.value) })); }} /></label>
      <label>Denominator<select value={draft.denominator}
        onChange={event => { setApplyError(''); setDraft(current => ({ ...current, denominator: Number(event.target.value) as PickupDraft['denominator'] })); }}>
        {[2, 4, 8, 16, 32, 64].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    {preview?.error && <p className="alert" role="alert">{preview.error}</p>}
    {applyError && <p className="alert" role="alert">{applyError}</p>}
    <div className="duplicate-dialog-actions"><button type="button" onClick={onClose}>Cancel</button>
      <button type="button" disabled={!preview?.source} onClick={() => { if (preview?.source) setApplyError(onApply(preview.source) ?? ''); }}>Apply</button></div>
  </dialog>;
}
