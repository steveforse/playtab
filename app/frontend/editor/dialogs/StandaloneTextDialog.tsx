import { useEffect, useState, type RefObject } from 'react';
import { STANDALONE_LYRICS_LIMIT } from '../../music/musicxml-editor';
import { useModalDialog } from '../useModalDialog';

// Whole-score "Lyrics & chords" text; onApply returns an error or null.
export function StandaloneTextDialog({ target, onApply, onClose, returnFocus }: {
  target: { initialText: string } | null; onApply: (text: string) => string | null; onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(target !== null, returnFocus);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (target) { setText(target.initialText); setError(''); } }, [target]);
  return <dialog ref={ref} className="duplicate-dialog standalone-dialog" aria-label="Lyrics and chords text" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>Lyrics &amp; chords</h2>
    <p>Whole-score text shown on its own tab and printed after the tablature. It is separate from timed lyrics. Leave it empty to remove it.</p>
    <label className="anchor-text">Text<textarea aria-label="Lyrics and chords text" data-dialog-first="" rows={14} maxLength={STANDALONE_LYRICS_LIMIT} value={text}
      onChange={event => { setError(''); setText(event.target.value); }} /></label>
    <p className="editor-rhythm-reason">{text.length.toLocaleString('en-US')} / {STANDALONE_LYRICS_LIMIT.toLocaleString('en-US')} characters</p>
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="duplicate-dialog-actions">
      <button type="button" onClick={onClose}>Cancel</button>
      <button type="button" onClick={() => setError(onApply(text) ?? '')}>Apply text</button>
    </div>
  </dialog>;
}
