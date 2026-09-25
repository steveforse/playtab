import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon } from '../ui/icons';
import { commandIcon, type EditorCommands } from './commands';

// A context menu entry: a command id, a separator, or a titled submenu.
export type MenuEntry = string | '-' | { label: string; items: readonly MenuEntry[] };

type Row = { key: string; label: string; disabled: boolean; reason?: string; shortcut?: string; pressed?: boolean;
  id?: string; submenu?: readonly MenuEntry[] };

function rows(entries: readonly MenuEntry[], commands: EditorCommands): Array<Row | '-'> {
  const result: Array<Row | '-'> = [];
  for (const entry of entries) {
    if (entry === '-') { if (result.length && result.at(-1) !== '-') result.push('-'); continue; }
    if (typeof entry !== 'string') {
      const children = rows(entry.items, commands).filter((row): row is Row => row !== '-');
      if (children.length) result.push({ key: `menu:${entry.label}`, label: entry.label, submenu: entry.items, disabled: children.every(child => child.disabled) });
      continue;
    }
    const command = commands[entry];
    if (!command || command.hidden) continue;
    result.push({ key: entry, id: entry, label: command.ariaLabel ?? command.label, disabled: Boolean(command.disabled),
      reason: command.disabled ? command.reason : undefined, shortcut: command.shortcut, pressed: command.pressed });
  }
  while (result.at(-1) === '-') result.pop();
  return result;
}

// Keeps a menu inside the viewport: it opens at the pointer and flips or
// shifts when it would overflow an edge.
function place(menu: HTMLElement, x: number, y: number) {
  const { width, height } = menu.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - width - 4));
  const top = y + height > window.innerHeight - 4 ? Math.max(4, y - height) : y;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function MenuList({ entries, commands, x, y, label, onRun, onClose, onBack }: {
  entries: readonly MenuEntry[]; commands: EditorCommands; x: number; y: number; label: string;
  onRun: (id: string) => void; onClose: () => void; onBack?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const items = rows(entries, commands);
  const [open, setOpen] = useState<{ key: string; x: number; y: number } | null>(null);
  const typed = useRef({ text: '', at: 0 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    place(ref.current, x, y);
    ref.current.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [x, y]);
  const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]') ?? []);
  const move = (step: number | 'first' | 'last') => {
    const list = focusable();
    if (!list.length) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const next = step === 'first' ? 0 : step === 'last' ? list.length - 1 : (index + step + list.length) % list.length;
    list[next].focus();
  };
  const openSubmenu = (row: Row, element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    setOpen({ key: row.key, x: box.right - 2, y: box.top });
  };
  const activate = (row: Row, element: HTMLElement) => {
    if (row.disabled) return;
    if (row.submenu) openSubmenu(row, element);
    else if (row.id) onRun(row.id);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && !ref.current?.contains(event.target)) return;
    if (event.target instanceof HTMLElement && event.target.closest('[role="menu"]') !== ref.current) return;
    const row = items.find(item => item !== '-' && item.key === (event.target as HTMLElement).dataset.key) as Row | undefined;
    const key = event.key;
    if (key === 'ArrowDown') move(1);
    else if (key === 'ArrowUp') move(-1);
    else if (key === 'Home') move('first');
    else if (key === 'End') move('last');
    else if (key === 'Escape') { if (onBack) onBack(); else onClose(); }
    else if (key === 'ArrowLeft') { if (onBack) onBack(); else return; }
    else if (key === 'ArrowRight') { if (row?.submenu && !row.disabled) openSubmenu(row, event.target as HTMLElement); else return; }
    else if (key === 'Enter' || key === ' ') { if (row) activate(row, event.target as HTMLElement); }
    else if (key === 'Tab') onClose();
    else if (key.length === 1 && /\S/.test(key)) {
      // Type-ahead moves to the next item whose label starts with the typed text.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + key.toLowerCase(), at: now };
      const list = focusable();
      const start = list.indexOf(document.activeElement as HTMLElement);
      const ordered = [...list.slice(start + 1), ...list.slice(0, start + 1)];
      ordered.find(element => element.textContent?.trim().toLowerCase().startsWith(typed.current.text))?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return <div ref={ref} role="menu" aria-label={label} className="context-menu" tabIndex={-1} onKeyDown={onKeyDown}
    onContextMenu={event => event.preventDefault()}>
    {items.map((row, index) => row === '-' ? <div key={`sep${index}`} role="separator" className="context-menu-separator" />
      : <div key={row.key} data-key={row.key} role="menuitem" tabIndex={-1} aria-disabled={row.disabled || undefined}
        aria-haspopup={row.submenu ? 'menu' : undefined} aria-expanded={row.submenu ? open?.key === row.key : undefined}
        title={row.reason}
        className={`context-menu-item${row.pressed ? ' context-menu-item-pressed' : ''}`}
        onMouseEnter={event => { event.currentTarget.focus(); if (row.submenu && !row.disabled) openSubmenu(row, event.currentTarget); else setOpen(null); }}
        onClick={event => activate(row, event.currentTarget)}>
        <span className="context-menu-icon">{row.id && commandIcon(row.id, commands[row.id]) && <Icon name={commandIcon(row.id, commands[row.id])!} size={16} />}</span>
        <span className="context-menu-label">{row.label}{row.reason && <small>{row.reason}</small>}</span>
        {row.shortcut && <kbd>{row.shortcut}</kbd>}
        {row.submenu && <span className="context-menu-arrow" aria-hidden="true">▸</span>}
      </div>)}
    {open && (() => {
      const row = items.find(item => item !== '-' && item.key === open.key) as Row | undefined;
      return row?.submenu && <MenuList entries={row.submenu} commands={commands} x={open.x} y={open.y} label={row.label}
        onRun={onRun} onClose={onClose} onBack={() => {
          setOpen(null);
          focusable().find(element => element.dataset.key === row.key)?.focus();
        }} />;
    })()}
  </div>;
}

// An ARIA menu at the pointer (or the selection) offering the editor
// commands that apply to what was right-clicked.
export function ContextMenu({ at, entries, commands, label, onClose }: {
  at: { x: number; y: number } | null; entries: readonly MenuEntry[]; commands: EditorCommands; label: string;
  onClose: (ran: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) onClose(false); };
    const dismiss = () => onClose(false);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [at]);
  if (!at) return null;
  return <div ref={root} className="context-menu-layer">
    <MenuList entries={entries} commands={commands} x={at.x} y={at.y} label={label}
      onRun={id => {
        const command = commands[id];
        const opener = document.querySelector<HTMLElement>('[data-testid="notation"]') ?? document.body;
        onClose(true);
        command?.run(opener);
      }} onClose={() => onClose(false)} />
  </div>;
}
