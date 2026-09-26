import { useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../ui/icons';
import { commandIcon, commandTitle, type EditorCommands } from './commands';
import { ContextMenu, type MenuEntry } from './ContextMenu';
import { DURATION_COMMANDS } from './sidebar/RhythmTools';

type RibbonItem = { command: string; name?: string } | { menu: string; entries: readonly MenuEntry[] };

// The ribbon keeps note entry one click away and gathers the less frequent
// commands into labelled menus, so it fits one row at 1080 px.
export const RIBBON_GROUPS: ReadonlyArray<{ label: string; items: readonly RibbonItem[] }> = [
  { label: 'Duration', items: [...DURATION_COMMANDS.map(command => ({ command })), { command: 'dotted' }, { command: 'triplet' },
    // "Rest" keeps this name distinct from the Properties panel's Make rest.
    { command: 'make-rest', name: 'Rest' }] },
  { label: 'Menus', items: [
    { menu: 'Note', entries: ['edit-fret', 'insert-beat', 'remove-note', '-', 'split-rest', 'set-tempo'] },
    { menu: 'Techniques', entries: ['tie', 'hammer-on', 'pull-off', 'slide', '-', 'bend', 'grace', '-', 'remove-tie', 'remove-grace'] },
    { menu: 'Measure', entries: ['select-measure', 'insert-measure-before', 'insert-measure-after', 'duplicate-measure', 'delete-measure', '-', 'time-signature', 'repeat', 'pickup', 'second-voice'] },
    { menu: 'Text', entries: ['chord', 'section', 'words', 'lyric', '-', 'lyrics-chords'] },
  ] },
  // Short names keep these distinct from the Properties panel's range actions.
  { label: 'Clipboard', items: [{ command: 'copy-passage', name: 'Copy' }, { command: 'cut-passage', name: 'Cut' }, { command: 'paste-passage', name: 'Paste' }] },
];

// Editing ribbon above the score. It uses the same command table as the
// Properties panel and context menu, and follows the ARIA toolbar pattern:
// one Tab stop, arrow keys move between controls.
export function EditorToolbar({ commands, fret, onHelp }: {
  commands: EditorCommands; fret?: { value: string; typing: boolean }; onHelp?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef<string | null>(null);
  const closed = useRef({ label: '', at: 0 });
  const [menu, setMenu] = useState<{ label: string; entries: readonly MenuEntry[]; x: number; y: number; trigger: HTMLElement } | null>(null);
  const buttons = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(':scope > .editor-toolbar-group button:not(:disabled)') ?? []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = buttons();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const next = event.key === 'ArrowRight' ? (index + 1) % list.length : event.key === 'ArrowLeft' ? (index - 1 + list.length) % list.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    list[next].focus();
  };
  const keys = RIBBON_GROUPS.flatMap(group => group.items.map(item => 'command' in item ? item.command : `menu:${item.menu}`));
  const enabled = keys.filter(key => key.startsWith('menu:') || (commands[key] && !commands[key].disabled && !commands[key].hidden));
  const stop = active.current && enabled.includes(active.current) ? active.current : enabled[0];
  const openMenu = (label: string, entries: readonly MenuEntry[], trigger: HTMLElement) => {
    // A press on the open menu's own button closes it (the outside press has
    // already done so) instead of reopening it.
    if (menu?.label === label || (closed.current.label === label && Date.now() - closed.current.at < 300)) { setMenu(null); return; }
    const box = trigger.getBoundingClientRect();
    setMenu({ label, entries, x: box.left, y: box.bottom + 4, trigger });
  };
  return <div ref={ref} role="toolbar" aria-label="Editing toolbar" className="editor-toolbar" onKeyDown={onKeyDown}>
    {fret && <div className="editor-toolbar-group ribbon-fret" title="Type 0–9 on a selected string; Enter applies">
      <span aria-hidden="true">Fret</span>
      <output aria-label="Fret entry" className={fret.typing ? 'ribbon-fret-value typing' : 'ribbon-fret-value'}>{fret.value}</output>
    </div>}
    {RIBBON_GROUPS.map(group => <div key={group.label} role="group" aria-label={group.label} className="editor-toolbar-group">
      {group.items.map(item => {
        if ('menu' in item) {
          const key = `menu:${item.menu}`;
          return <button key={key} type="button" className="editor-toolbar-menu" aria-haspopup="menu" aria-expanded={menu?.label === item.menu}
            tabIndex={key === stop ? 0 : -1} onFocus={() => { active.current = key; }}
            onClick={event => openMenu(item.menu, item.entries, event.currentTarget)}
            onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); openMenu(item.menu, item.entries, event.currentTarget); } }}>
            {item.menu}<Icon name="chevron" size={12} />
          </button>;
        }
        const id = item.command;
        const command = commands[id];
        if (!command || command.hidden) return null;
        const icon = commandIcon(id, command);
        const disabled = Boolean(command.disabled);
        const name = item.name ?? command.ariaLabel ?? command.label;
        return <button key={id} type="button" className="editor-toolbar-button" aria-label={name}
          title={commandTitle({ ...command, iconOnly: true, disabled }) ?? name}
          aria-pressed={command.pressed} disabled={disabled}
          tabIndex={id === stop ? 0 : -1} onFocus={() => { active.current = id; }} onClick={event => command.run(event.currentTarget)}>
          {icon ? <Icon name={icon} /> : name}
        </button>;
      })}
    </div>)}
    {onHelp && <div className="editor-toolbar-group">
      <button type="button" className="editor-toolbar-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" tabIndex={-1}
        onFocus={() => { active.current = 'help'; }} onClick={onHelp}><Icon name="keyboard" /></button>
    </div>}
    <ContextMenu at={menu && { x: menu.x, y: menu.y }} entries={menu?.entries ?? []} commands={commands} label={menu?.label ?? ''}
      onClose={ran => {
        const trigger = menu?.trigger;
        if (!ran) closed.current = { label: menu?.label ?? '', at: Date.now() };
        setMenu(null);
        if (!ran) trigger?.focus();
      }} />
  </div>;
}
