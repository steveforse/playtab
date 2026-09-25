import type { RefObject } from 'react';
import type { MeasureCut } from '../../music/musicxml-editor';
import { useModalDialog } from '../useModalDialog';

// Confirms a whole-measure Cut, or clearing a range to rests, listing what
// will be removed.
export function CutDialog({ target, onConfirm, onClose, returnFocus }: {
  target: { first: number; last: number; cut: Pick<MeasureCut, 'notes' | 'labels' | 'lyrics' | 'spans'>; mode?: 'cut' | 'clear'; label?: string } | null; onConfirm: () => void; onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(target !== null, returnFocus);
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const clear = target?.mode === 'clear';
  const where = target ? target.label ?? (target.first === target.last ? `measure ${target.first}` : `measures ${target.first}–${target.last}`) : '';
  return <dialog ref={ref} className="duplicate-dialog" aria-label={clear ? 'Clear range' : 'Cut passage'} onCancel={event => { event.preventDefault(); onClose(); }}>
    {target && <>
      <h2>{clear ? 'Clear' : 'Cut'} {where}?</h2>
      <p>{clear ? 'The selected music becomes rests at the same beats; nothing is copied.' : 'The measures are copied to the clipboard and left as rests at the same beats.'} The bar count, meter, tempo and later timing do not change.</p>
      <ul>
        <li>{plural(target.cut.notes, 'note')}</li>
        {target.cut.labels > 0 && <li>{plural(target.cut.labels, 'chord or text label')}</li>}
        {target.cut.lyrics > 0 && <li>{plural(target.cut.lyrics, 'lyric syllable')}</li>}
        {target.cut.spans.length > 0 && <li>{target.label ? 'Also removes or disconnects' : 'Connected techniques inside'}: {target.cut.spans.join(', ')}</li>}
      </ul>
      <div className="duplicate-dialog-actions">
        <button type="button" data-dialog-first="" onClick={onClose}>Cancel</button>
        <button type="button" onClick={onConfirm}>{clear ? 'Clear' : 'Cut'}</button>
      </div>
    </>}
  </dialog>;
}
