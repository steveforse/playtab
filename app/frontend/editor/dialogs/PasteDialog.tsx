import { useEffect, useState, type RefObject } from 'react';
import type { MusicXmlPreview } from '../../music/musicxml';
import { pasteMusicXmlMeasures, type MeasureClipboard, type PasteMode, type TuningMode } from '../../music/musicxml-editor';
import { useModalDialog } from '../useModalDialog';

export type PasteDialogTarget = { base: MusicXmlPreview; measure: number; replaceFrom: number | null; replaceCount: number };

// Insert before the selected measure, or replace a matching selected range.
// The candidate is computed live; onApply returns an error or null.
export function PasteDialog({ target, clipboard, onApply, onClose, returnFocus }: {
  target: PasteDialogTarget | null; clipboard: MeasureClipboard | null; onApply: (candidate: string, replacing: boolean) => string | null;
  onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(target !== null, returnFocus);
  const [pasteMode, setPasteMode] = useState<TuningMode>('frets');
  const [pastePlacement, setPastePlacement] = useState<PasteMode>('insert');
  const [pasteError, setPasteError] = useState('');
  useEffect(() => { if (target) { setPasteMode('frets'); setPastePlacement('insert'); setPasteError(''); } }, [target]);
  const apply = (candidate: string, replacing: boolean) => setPasteError(onApply(candidate, replacing) ?? '');
  return (
  <dialog ref={ref} className="duplicate-dialog" aria-label="Paste passage" onCancel={event => { event.preventDefault(); onClose(); }}>
    {target && clipboard && (() => {
      let candidate: string | null = null;
      let problem = '';
      const count = clipboard.measures.length;
      const canReplace = target.replaceFrom !== null && target.replaceCount === count;
      const replacing = pastePlacement === 'replace' && canReplace;
      try {
        candidate = pasteMusicXmlMeasures(target.base.source, target.base.score, clipboard,
          (replacing ? target.replaceFrom! : target.measure) - 1, replacing ? 'replace' : 'insert', pasteMode);
      } catch (failure) { problem = (failure as Error).message; }
      return <>
        <h2>Paste passage</h2>
        <p>{replacing ? `Destination: measures ${target.replaceFrom}–${target.replaceFrom! + count - 1}.` : `Destination: before measure ${target.measure}.`} Source: {count} measure{count === 1 ? '' : 's'} from “{clipboard.title}” ({clipboard.meters.join(', ')}). {replacing ? 'The bar count stays the same.' : `The score will grow by ${count} measure${count === 1 ? '' : 's'}.`}</p>
        <fieldset className="settings-mode"><legend>Placement</legend>
          <label><input type="radio" name="paste-placement" data-dialog-first="" checked={!replacing} onChange={() => setPastePlacement('insert')} />Insert measures before measure {target.measure}</label>
          <label><input type="radio" name="paste-placement" disabled={!canReplace} checked={replacing} onChange={() => setPastePlacement('replace')} />Replace selected measures</label>
          {!canReplace && <p className="editor-rhythm-reason">To replace, select {count} whole measure{count === 1 ? '' : 's'} as the passage first.</p>}
        </fieldset>
        <fieldset className="settings-mode"><legend>If the tuning differs</legend>
          <label><input type="radio" name="paste-mode" checked={pasteMode === 'frets'} onChange={() => setPasteMode('frets')} />Keep frets (pitches follow this score’s tuning)</label>
          <label><input type="radio" name="paste-mode" checked={pasteMode === 'pitches'} onChange={() => setPasteMode('pitches')} />Keep pitches (frets change)</label>
        </fieldset>
        {clipboard.excluded.length > 0 && <p className="grace-read-only" role="note">Not pasted: {clipboard.excluded.join('; ')}.</p>}
        {problem && <p className="alert" role="alert">{problem}</p>}
        {pasteError && <p className="alert" role="alert">{pasteError}</p>}
        <div className="duplicate-dialog-actions">
          <button type="button" onClick={() => onClose()}>Cancel</button>
          <button type="button" disabled={!candidate} onClick={() => { if (candidate) apply(candidate, replacing); }}>Paste</button>
        </div>
      </>;
    })()}
  </dialog>
  );
}
