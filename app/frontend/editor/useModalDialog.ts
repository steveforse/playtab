import { useEffect, useRef, type RefObject } from 'react';

// Opens a <dialog> modally while `open` is true, focuses its first marked
// control, and returns focus to the opener when it closes.
export function useModalDialog(open: boolean, returnFocus?: RefObject<HTMLElement | null>, focusSelector = '[data-dialog-first]', onFocusFallback?: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>(focusSelector)?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      if (returnFocus?.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
      else onFocusFallback?.();
    }
  }, [open]);
  return ref;
}
