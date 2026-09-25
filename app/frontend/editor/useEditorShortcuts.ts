import { useEffect, useRef } from 'react';

export type ShortcutHandlers = {
  save: () => void;
  history: (direction: 'undo' | 'redo') => void;
  // Returns whether the clipboard shortcut was handled; unhandled keys keep
  // the browser's own copy, cut and paste.
  clipboard: (key: 'c' | 'x' | 'v') => boolean;
};

// Workspace keyboard shortcuts. Ctrl/Cmd+S always saves instead of opening
// the browser's save-page dialog; in edit mode Ctrl/Cmd+Z/Y and C/X/V act on
// the score unless focus is in a text field (or, for the clipboard, a dialog).
export function useEditorShortcuts(editMode: boolean, handlers: ShortcutHandlers) {
  const current = useRef(handlers);
  current.current = handlers;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      current.current.save();
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, []);
  useEffect(() => {
    if (!editMode) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if ((key === 'c' || key === 'x' || key === 'v') && !event.shiftKey) {
        if (target instanceof HTMLElement && target.closest('dialog')) return;
        if (current.current.clipboard(key)) event.preventDefault();
        return;
      }
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      current.current.history(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [editMode]);
}
