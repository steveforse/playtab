import { useRef, type KeyboardEvent } from 'react';
import { Icon } from '../ui/icons';
import { commandIcon, commandTitle, type EditorCommands } from './commands';
import { DURATION_COMMANDS } from './sidebar/RhythmTools';

export const TOOLBAR_GROUPS: ReadonlyArray<{ label: string; ids: readonly string[] }> = [
  { label: 'History', ids: ['undo', 'redo'] },
  { label: 'Duration', ids: [...DURATION_COMMANDS, 'dotted', 'triplet', 'make-rest'] },
  { label: 'Note', ids: ['edit-fret', 'remove-note', 'insert-event'] },
  { label: 'Techniques', ids: ['tie', 'hammer-on', 'pull-off', 'slide', 'bend', 'grace'] },
  { label: 'Measure', ids: ['insert-measure-after', 'duplicate-measure', 'delete-measure', 'repeat', 'time-signature'] },
  { label: 'Text', ids: ['chord', 'section', 'words', 'lyric'] },
  { label: 'Clipboard', ids: ['copy-passage', 'cut-passage', 'paste-passage'] },
];

// The frequent editing commands as an icon toolbar above the score. It uses
// the same command table as the sidebar and context menu, and follows the
// ARIA toolbar pattern: one Tab stop, arrow keys move between buttons.
export function EditorToolbar({ commands }: { commands: EditorCommands }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef<string | null>(null);
  const buttons = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
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
  const enabled = TOOLBAR_GROUPS.flatMap(group => group.ids).filter(id => commands[id] && !commands[id].disabled && !commands[id].hidden);
  const stop = active.current && enabled.includes(active.current) ? active.current : enabled[0];
  return <div ref={ref} role="toolbar" aria-label="Editing toolbar" className="editor-toolbar" onKeyDown={onKeyDown}>
    {TOOLBAR_GROUPS.map(group => <div key={group.label} role="group" aria-label={group.label} className="editor-toolbar-group">
      {group.ids.map(id => {
        const command = commands[id];
        if (!command || command.hidden) return null;
        const icon = commandIcon(id, command);
        const disabled = Boolean(command.disabled);
        const name = command.ariaLabel ?? command.label;
        return <button key={id} type="button" className="editor-toolbar-button" aria-label={name}
          title={commandTitle({ ...command, iconOnly: true, disabled }) ?? name} aria-pressed={command.pressed} disabled={disabled}
          tabIndex={id === stop ? 0 : -1} onFocus={() => { active.current = id; }} onClick={event => command.run(event.currentTarget)}>
          {icon ? <Icon name={icon} /> : name}
        </button>;
      })}
    </div>)}
  </div>;
}
