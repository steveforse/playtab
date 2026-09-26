import type { RefObject } from 'react';
import { useModalDialog } from '../useModalDialog';

// Lists only the shortcuts the editor implements.
export function KeyboardHelpDialog({ open, onClose, returnFocus }: { open: boolean; onClose: () => void; returnFocus?: RefObject<HTMLElement | null> }) {
  const ref = useModalDialog(open, returnFocus);
  return <dialog ref={ref} className="duplicate-dialog keyboard-help" aria-label="Keyboard help" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>Keyboard help</h2>
    <p>With the score focused in edit mode:</p>
    <dl>
      <dt>Arrow keys</dt><dd>Move between beats (Left/Right) and strings (Up/Down). The first arrow selects the first beat.</dd>
      <dt>0–9</dt><dd>Replace the fret at once. A second digit typed quickly makes a two-digit fret (up to 36); both digits are one undo step. Other letters are ignored.</dd>
      <dt>Enter</dt><dd>Finish typing a fret, so the next digit starts a new one.</dd>
      <dt>Escape</dt><dd>Finish typing a fret, clear the selected range, or close a dialog.</dd>
      <dt>Backspace</dt><dd>Just after a two-digit fret, go back to its first digit; otherwise remove the selected note.</dd>
      <dt>Delete</dt><dd>Remove the selected note.</dd>
      <dt>Space</dt><dd>Play or pause.</dd>
      <dt>Shift-click</dt><dd>Extend the passage to the clicked beat.</dd>
        <dt>Shift+Left/Right</dt><dd>Extend the range by one beat.</dd>
        <dt>Ctrl/Cmd+Shift+Left/Right</dt><dd>Extend the range by a measure.</dd>
        <dt>Ctrl/Cmd+A</dt><dd>Select every beat in the voice.</dd>
        <dt>Ctrl/Cmd+C, X, V</dt><dd>Copy, cut or paste whole measures of the selected range.</dd>
        <dt>Delete with a range</dt><dd>Clear the range to rests after confirming.</dd>
        <dt>Click above the staff</dt><dd>Select the whole measure; Shift-click there extends by measures.</dd>
      <dt>Ctrl/Cmd+Z</dt><dd>Undo. Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y: redo.</dd>
      <dt>Ctrl/Cmd+S</dt><dd>Save the score.</dd>
    </dl>
    <div className="duplicate-dialog-actions"><button type="button" data-dialog-first="" onClick={onClose}>Close</button></div>
  </dialog>;
}
