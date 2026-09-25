import { useEffect, useState, type RefObject } from 'react';
import type { MusicXmlPreview } from '../../music/musicxml';
import { addMusicXmlEndings, addMusicXmlRepeat, inspectMusicXmlRepeatEndings, inspectMusicXmlRepeats, type RepeatRegion } from '../../music/musicxml-editor';
import { useModalDialog } from '../useModalDialog';

export type RepeatDraft = { start: number; end: number; count: number };

// Adds a repeat, first/second endings to a selected repeat, or asks to
// clear one. Each callback returns an error to show, or null on success.
export function RepeatDialog({ target, onAdd, onAddEndings, onRequestRemoval, onClose, returnFocus }: {
  target: { base: MusicXmlPreview; measure: number } | null;
  onAdd: (candidate: string, draft: RepeatDraft) => string | null;
  onAddEndings: (candidate: string, region: RepeatRegion) => string | null;
  onRequestRemoval: (region: RepeatRegion) => string | null;
  onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(target !== null, returnFocus);
  const [repeatDraft, setRepeatDraft] = useState<RepeatDraft>({ start: 1, end: 2, count: 2 });
  const [repeatAddTouched, setRepeatAddTouched] = useState(false);
  const [repeatSelected, setRepeatSelected] = useState('');
  const [endingDraft, setEndingDraft] = useState({ firstStart: 1, secondEnd: 1 });
  const [repeatApplyError, setRepeatApplyError] = useState('');
  useEffect(() => {
    if (!target) return;
    let regions: RepeatRegion[] = [];
    try { regions = inspectMusicXmlRepeats(target.base.source); } catch { /* Unsupported imported maps stay read-only. */ }
    const selected = regions.find(item => target.measure - 1 >= item.start && target.measure - 1 <= item.end) ?? regions[0];
    setRepeatDraft({ start: target.measure, end: Math.min(target.base.score.masterBars.length, target.measure + 1), count: 2 });
    setRepeatAddTouched(false);
    setRepeatSelected(selected ? `${selected.start}:${selected.end}` : '');
    setEndingDraft({ firstStart: selected ? selected.end + 1 : target.measure, secondEnd: selected ? selected.end + 2 : target.measure + 1 });
    setRepeatApplyError('');
  }, [target]);
  const repeatPreview = (() => {
    if (!target) return null;
    try {
      const existing = inspectMusicXmlRepeats(target.base.source);
      try {
        return { existing, candidate: addMusicXmlRepeat(target.base.source, target.base.score, repeatDraft.start - 1, repeatDraft.end - 1, repeatDraft.count), error: '', structureError: false };
      } catch (failure) { return { existing, candidate: null, error: (failure as Error).message, structureError: false }; }
    } catch (failure) { return { existing: [], candidate: null, error: (failure as Error).message, structureError: true }; }
  })();
  const selectedRepeat = repeatPreview?.existing.find(region => `${region.start}:${region.end}` === repeatSelected);
  const endingsPreview = (() => {
    if (!target || !selectedRepeat) return null;
    try {
      const existing = inspectMusicXmlRepeatEndings(target.base.source, selectedRepeat.start, selectedRepeat.end);
      if (existing) return { existing, candidate: null, error: 'This repeat already has first and second endings.' };
      try {
        return { existing: null, candidate: addMusicXmlEndings(target.base.source, target.base.score,
          selectedRepeat.start, selectedRepeat.end, endingDraft.firstStart - 1, endingDraft.secondEnd - 1), error: '' };
      } catch (failure) { return { existing: null, candidate: null, error: (failure as Error).message }; }
    } catch (failure) { return { existing: null, candidate: null, error: (failure as Error).message }; }
  })();
  const report = (error: string | null) => setRepeatApplyError(error ?? '');
  return <dialog ref={ref} className="duplicate-dialog" aria-label="Repeat / endings" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>Repeat / endings</h2>
    <p>Existing repeats: {repeatPreview?.structureError ? 'unavailable (imported structure is read-only)' : repeatPreview?.existing.length ? repeatPreview.existing.map(region =>
      `measures ${region.start + 1}–${region.end + 1} ×${region.count}`).join('; ') : 'none'}.</p>
    <p>Add a non-overlapping repeat. Endings require a two-play repeat and one measure after its backward marker.</p>
    <div className="insert-dialog-fields">
      <label>Start measure<input data-dialog-first type="number" min={1} max={target?.base.score.masterBars.length ?? 1} step={1}
        value={repeatDraft.start} onChange={event => { setRepeatAddTouched(true); setRepeatApplyError(''); setRepeatDraft(current => ({ ...current, start: Number(event.target.value) })); }} /></label>
      <label>End measure<input type="number" min={1} max={target?.base.score.masterBars.length ?? 1} step={1}
        value={repeatDraft.end} onChange={event => { setRepeatAddTouched(true); setRepeatApplyError(''); setRepeatDraft(current => ({ ...current, end: Number(event.target.value) })); }} /></label>
      <label>Play count<select value={repeatDraft.count}
        onChange={event => { setRepeatAddTouched(true); setRepeatApplyError(''); setRepeatDraft(current => ({ ...current, count: Number(event.target.value) })); }}>
        {[2, 3, 4, 5, 6, 7, 8].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    {repeatPreview?.error && (repeatAddTouched || !repeatPreview.existing.length) && <p className="alert" role="alert">{repeatPreview.error}</p>}
    {repeatApplyError && <p className="alert" role="alert">{repeatApplyError}</p>}
    <div className="duplicate-dialog-actions"><button type="button" onClick={onClose}>Cancel</button>
      <button type="button" disabled={!repeatPreview?.candidate} onClick={() => { if (repeatPreview?.candidate) report(onAdd(repeatPreview.candidate, repeatDraft)); }}>Add repeat</button></div>
    {!!repeatPreview?.existing.length && <>
      <h3>Selected repeat</h3>
      <div className="insert-dialog-fields"><label>Repeat region<select value={repeatSelected} onChange={event => {
        const region = repeatPreview.existing.find(item => `${item.start}:${item.end}` === event.target.value);
        setRepeatSelected(event.target.value);
        if (region) setEndingDraft({ firstStart: region.end + 1, secondEnd: region.end + 2 });
        setRepeatApplyError('');
      }}>
        {repeatPreview.existing.map(region => <option key={`${region.start}:${region.end}`} value={`${region.start}:${region.end}`}>
          Measures {region.start + 1}–{region.end + 1} · {region.count} plays
        </option>)}</select></label></div>
      {selectedRepeat && <>
        {endingsPreview?.existing && <p>First ending: measures {endingsPreview.existing.firstStart + 1}–{endingsPreview.existing.firstEnd + 1}; second ending: measures {endingsPreview.existing.secondStart + 1}–{endingsPreview.existing.secondEnd + 1}.</p>}
        {!endingsPreview?.existing && <>
          <div className="insert-dialog-fields">
            <label>First ending start<input type="number" min={selectedRepeat.start + 1} max={selectedRepeat.end + 1} step={1}
              value={endingDraft.firstStart} onChange={event => { setRepeatApplyError(''); setEndingDraft(current => ({ ...current, firstStart: Number(event.target.value) })); }} /></label>
            <p>First ending end: measure {selectedRepeat.end + 1} (fixed). Second ending start: measure {selectedRepeat.end + 2} (fixed).</p>
            <label>Second ending end<input type="number" min={selectedRepeat.end + 2} max={target?.base.score.masterBars.length ?? 1} step={1}
              value={endingDraft.secondEnd} onChange={event => { setRepeatApplyError(''); setEndingDraft(current => ({ ...current, secondEnd: Number(event.target.value) })); }} /></label>
          </div>
          {endingsPreview?.error && <p className="alert" role="alert">{endingsPreview.error}</p>}
          <button type="button" disabled={!endingsPreview?.candidate} onClick={() => {
            if (endingsPreview?.candidate) report(onAddEndings(endingsPreview.candidate, selectedRepeat));
          }}>Add first/second endings</button>
        </>}
        <button type="button" onClick={() => report(onRequestRemoval(selectedRepeat))}>Clear selected repeat/ending…</button>
      </>}
    </>}
  </dialog>;
}
