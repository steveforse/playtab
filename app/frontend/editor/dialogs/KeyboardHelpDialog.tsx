import type { RefObject } from 'react';
import { useModalDialog } from '../useModalDialog';

// Lists only the shortcuts the editor implements.
export function KeyboardHelpDialog({ open, onClose, returnFocus }: { open: boolean; onClose: () => void; returnFocus?: RefObject<HTMLElement | null> }) {
  const ref = useModalDialog(open, returnFocus);
  return <dialog ref={ref} className="duplicate-dialog keyboard-help" aria-label="Keyboard help" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>Keyboard help</h2>
    <p>With the score focused in edit mode:</p>
    <dl>
      <dt>Arrow keys</dt><dd>Move between events (Left/Right) and strings (Up/Down). The first arrow selects the first event.</dd>
      <dt>0–9</dt><dd>Type a fret of up to two digits; it is shown but not applied yet.</dd>
      <dt>Enter or Tab</dt><dd>Apply the typed fret.</dd>
      <dt>Escape</dt><dd>Cancel the typed fret, clear the selected range, or close a dialog.</dd>
      <dt>Backspace</dt><dd>Remove the last typed digit; with nothing typed, remove the selected note.</dd>
      <dt>Delete</dt><dd>Remove the selected note.</dd>
      <dt>Space</dt><dd>Play or pause.</dd>
      <dt>Shift-click</dt><dd>Extend the passage to the clicked event.</dd>
        <dt>Shift+Left/Right</dt><dd>Extend the range by one event.</dd>
        <dt>Ctrl/Cmd+Shift+Left/Right</dt><dd>Extend the range by a measure.</dd>
        <dt>Ctrl/Cmd+A</dt><dd>Select every event in the voice.</dd>
        <dt>Click above the staff</dt><dd>Select the whole measure; Shift-click there extends by measures.</dd>
      <dt>Ctrl/Cmd+Z</dt><dd>Undo. Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y: redo.</dd>
      <dt>Ctrl/Cmd+S</dt><dd>Apply a typed fret and save.</dd>
    </dl>
    <div className="duplicate-dialog-actions"><button type="button" data-dialog-first="" onClick={onClose}>Close</button></div>
  </dialog>;
}
