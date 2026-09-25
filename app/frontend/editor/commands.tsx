import type { ReactNode } from 'react';
import { Icon, isIconName, type IconName } from '../ui/icons';

// A single description of each editor action, shared by the edit sidebar,
// the toolbar and context menus so every surface enables, labels and runs
// an action the same way.
export interface EditorCommand {
  label: string;
  // Accessible name when it differs from the visible label.
  ariaLabel?: string;
  // Tooltip text; defaults to the label plus its shortcut.
  title?: string;
  shortcut?: string;
  disabled?: boolean;
  // Why a disabled command is unavailable; shown in tooltips and menus.
  reason?: string;
  pressed?: boolean;
  // Hidden commands are not offered at all (for example "Remove tie" when
  // the selected note has no tie).
  hidden?: boolean;
  className?: string;
  // Defaults to the icon named like the command id (or its alias).
  icon?: IconName;
  // Shows only the icon; the label becomes the accessible name and tooltip.
  iconOnly?: boolean;
  run: (opener: HTMLElement) => void;
}

export type EditorCommands = Record<string, EditorCommand>;

const ICON_ALIASES: Record<string, IconName> = {
  'apply-fret': 'apply', 'move-string': 'move', 'set-tempo': 'tempo', 'remove-triplet': 'clear', 'remove-grace': 'clear',
  'remove-tie': 'clear', 'clear-passage': 'clear', 'copy-passage': 'copy', 'cut-passage': 'cut', 'paste-passage': 'paste',
  'score-settings': 'settings', 'keyboard-help': 'keyboard',
};

export function commandIcon(id: string, command: EditorCommand): IconName | undefined {
  return command.icon ?? ICON_ALIASES[id] ?? (isIconName(id) ? id : undefined);
}

// Tooltips name the command and its shortcut; icon-only buttons always get one.
export function commandTitle(command: EditorCommand): string | undefined {
  if (command.disabled && command.reason) return `${command.ariaLabel ?? command.label} — ${command.reason}`;
  if (command.title) return command.shortcut ? `${command.title} (${command.shortcut})` : command.title;
  const name = command.ariaLabel ?? command.label;
  if (command.shortcut) return `${name} (${command.shortcut})`;
  return command.iconOnly ? name : undefined;
}

export function CommandButton({ command, id }: { command: EditorCommand; id?: string }) {
  if (command.hidden) return null;
  const icon = id ? commandIcon(id, command) : command.icon;
  const label = command.iconOnly ? undefined : command.label;
  return <button type="button" className={['command-button', command.iconOnly && 'icon-only', command.className].filter(Boolean).join(' ')}
    aria-label={command.iconOnly ? command.ariaLabel ?? command.label : command.ariaLabel} title={commandTitle(command)}
    aria-pressed={command.pressed} disabled={command.disabled} onClick={event => command.run(event.currentTarget)}>
    {icon && <Icon name={icon} />}{label !== undefined && <span className="command-label">{label}</span>}</button>;
}

export function CommandButtons({ commands, ids }: { commands: EditorCommands; ids: readonly string[] }) {
  return <>{ids.map(id => <CommandButton key={id} id={id} command={commands[id]} />)}</>;
}

// A collapsible sidebar group of commands with optional explanatory notes.
export function CommandGroup({ className, summary, commands, ids, children, open }: {
  className: string; summary: string; commands: EditorCommands; ids: readonly string[]; children?: ReactNode; open?: boolean;
}) {
  return <details className={className} open={open}><summary>{summary}</summary><CommandButtons commands={commands} ids={ids} />{children}</details>;
}
