import { useEffect, useState, type RefObject } from 'react';
import { useModalDialog } from '../useModalDialog';

// Confirms removing a note, rest or grace together with the connected
// music it would remove or disconnect.
export function RemovalDialog({ pending, onConfirm, onClose, returnFocus, onFocusFallback }: {
  pending: { mode: 'note' | 'rest' | 'grace'; dependencies: string[] } | null; onConfirm: () => void; onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>; onFocusFallback?: () => void;
}) {
  const ref = useModalDialog(pending !== null, returnFocus, '[data-dialog-first]', onFocusFallback);
  return <dialog ref={ref} className="removal-dialog" aria-label="Confirm note removal" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>Remove connected music?</h2>
    <p>This edit also removes or disconnects:</p>
    <ul>{pending?.dependencies.map(dependency => <li key={dependency}>{dependency}</li>)}</ul>
    <div className="removal-dialog-actions">
      <button type="button" data-dialog-first onClick={onClose}>Cancel</button>
      <button type="button" onClick={onConfirm}>{pending?.mode === 'rest' ? 'Make rest' : pending?.mode === 'grace' ? 'Remove grace' : 'Remove note'}</button>
    </div>
  </dialog>;
}

export function SaveCopyDialog({ open, initialTitle, saving, onSave, onClose }: {
  open: boolean; initialTitle: string; saving: boolean; onSave: (title: string) => void; onClose: () => void;
}) {
  const ref = useModalDialog(open, undefined, 'input');
  const [title, setTitle] = useState(initialTitle);
  useEffect(() => { if (open) setTitle(initialTitle); }, [open, initialTitle]);
  return <dialog ref={ref} className="copy-dialog" aria-label="Save a copy" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>Save a copy</h2>
    <label>Copy title<input aria-label="Copy title" value={title} maxLength={160} onChange={event => setTitle(event.target.value)} /></label>
    <div className="copy-dialog-actions"><button type="button" onClick={onClose}>Cancel</button>
      <button type="button" disabled={saving || !title.trim()} onClick={() => onSave(title.trim())}>Save copy</button></div>
  </dialog>;
}

export function LeaveDialog({ open, error, saving, onCancel, onDiscard, onSaveAndContinue }: {
  open: boolean; error: string; saving: boolean; onCancel: () => void; onDiscard: () => void; onSaveAndContinue: () => void;
}) {
  const ref = useModalDialog(open);
  return <dialog ref={ref} className="guard-dialog" aria-label="Unsaved changes" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2>Save changes before leaving this score?</h2>
    <p>Your unsaved edits will be lost if you discard them.</p>
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="guard-dialog-actions">
      <button type="button" data-dialog-first onClick={onCancel}>Cancel</button>
      <button type="button" disabled={saving} onClick={onDiscard}>Discard</button>
      <button type="button" disabled={saving} onClick={onSaveAndContinue}>Save and continue</button>
    </div>
  </dialog>;
}

export function DiscardDialog({ open, onCancel, onDiscard }: { open: boolean; onCancel: () => void; onDiscard: () => void }) {
  const ref = useModalDialog(open);
  return <dialog ref={ref} className="guard-dialog" aria-label="Discard unsaved changes" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2>Discard unsaved changes?</h2>
    <p>This restores the last saved version, or the score as you first opened it.</p>
    <div className="guard-dialog-actions"><button type="button" data-dialog-first onClick={onCancel}>Cancel</button><button type="button" onClick={onDiscard}>Discard changes</button></div>
  </dialog>;
}

export function ConflictDialog({ open, onKeep, onSaveCopy, onReload }: { open: boolean; onKeep: () => void; onSaveCopy: () => void; onReload: () => void }) {
  const ref = useModalDialog(open);
  return <dialog ref={ref} className="guard-dialog" aria-label="Score changed in another tab" onCancel={event => { event.preventDefault(); onKeep(); }}>
    <h2>This score changed in another tab.</h2>
    <p>Your draft is still here. Choose how to continue; Playtab will not overwrite the newer saved version.</p>
    <div className="guard-dialog-actions">
      <button type="button" data-dialog-first onClick={onKeep}>Keep editing</button>
      <button type="button" onClick={onSaveCopy}>Save as copy…</button>
      <button type="button" onClick={onReload}>Reload saved version…</button>
    </div>
  </dialog>;
}
