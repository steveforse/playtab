import { useEffect, useState, type RefObject } from 'react';
import type { MusicXmlPreview } from '../../music/musicxml';
import { changeMusicXmlMeter, inspectMusicXmlMeterRange } from '../../music/musicxml-editor';
import { useModalDialog } from '../useModalDialog';

type MeterDraft = { numerator: number; denominator: 2 | 4 | 8 | 16; scope: 'this' | 'from' };
export type MeterCandidate = ReturnType<typeof changeMusicXmlMeter>;

// Time signature for this measure or from here; the affected range and any
// blocking reason are shown before Apply. onApply returns an error or null.
export function MeterDialog({ target, onApply, onClose, returnFocus }: {
  target: { base: MusicXmlPreview; measureIndex: number } | null; onApply: (candidate: MeterCandidate) => string | null;
  onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(target !== null, returnFocus);
  const [draft, setDraft] = useState<MeterDraft>({ numerator: 4, denominator: 4, scope: 'this' });
  const [applyError, setApplyError] = useState('');
  useEffect(() => {
    if (!target) return;
    const master = target.base.score.masterBars[target.measureIndex];
    setDraft({ numerator: master.timeSignatureNumerator, denominator: master.timeSignatureDenominator as MeterDraft['denominator'], scope: 'this' });
    setApplyError('');
  }, [target]);
  const preview = (() => {
    if (!target) return null;
    try {
      const range = inspectMusicXmlMeterRange(target.base.source, target.base.score, target.measureIndex, draft.scope);
      try {
        return { range, candidate: changeMusicXmlMeter(target.base.source, target.base.score, target.measureIndex, draft.numerator, draft.denominator, draft.scope), error: '' };
      } catch (failure) { return { range, candidate: null, error: (failure as Error).message }; }
    } catch (failure) { return { range: null, candidate: null, error: (failure as Error).message }; }
  })();
  return <dialog ref={ref} className="duplicate-dialog" aria-label="Time signature" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>Time signature</h2>
    <div className="insert-dialog-fields">
      <label>Numerator<input data-dialog-first type="number" min={1} max={12} step={1} value={draft.numerator}
        onChange={event => { setApplyError(''); setDraft(current => ({ ...current, numerator: Number(event.target.value) })); }} /></label>
      <label>Denominator<select value={draft.denominator}
        onChange={event => { setApplyError(''); setDraft(current => ({ ...current, denominator: Number(event.target.value) as MeterDraft['denominator'] })); }}>
        {[2, 4, 8, 16].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Apply to<select value={draft.scope}
        onChange={event => { setApplyError(''); setDraft(current => ({ ...current, scope: event.target.value as MeterDraft['scope'] })); }}>
        <option value="this">This measure</option><option value="from">From here (until next explicit signature)</option></select></label>
    </div>
    {preview?.range && <p>Affects measures {preview.range.firstMeasure}–{preview.range.lastMeasure} ({preview.range.lastMeasure - preview.range.firstMeasure + 1} total).</p>}
    {preview?.error && <p className="alert" role="alert">{preview.error}</p>}
    {applyError && <p className="alert" role="alert">{applyError}</p>}
    <div className="duplicate-dialog-actions"><button type="button" onClick={onClose}>Cancel</button>
      <button type="button" disabled={!preview?.candidate} onClick={() => { if (preview?.candidate) setApplyError(onApply(preview.candidate) ?? ''); }}>Apply</button></div>
  </dialog>;
}
