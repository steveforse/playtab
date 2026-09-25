import type { ReactNode } from 'react';

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
  pressed?: boolean;
  // Hidden commands are not offered at all (for example "Remove tie" when
  // the selected note has no tie).
  hidden?: boolean;
  className?: string;
  run: (opener: HTMLElement) => void;
}

export type EditorCommands = Record<string, EditorCommand>;

export function commandTitle(command: EditorCommand) {
  if (command.title) return command.title;
  return command.shortcut ? `${command.ariaLabel ?? command.label} (${command.shortcut})` : undefined;
}

export function CommandButton({ command }: { command: EditorCommand }) {
  if (command.hidden) return null;
  return <button type="button" className={command.className} aria-label={command.ariaLabel} title={commandTitle(command)}
    aria-pressed={command.pressed} disabled={command.disabled} onClick={event => command.run(event.currentTarget)}>{command.label}</button>;
}

export function CommandButtons({ commands, ids }: { commands: EditorCommands; ids: readonly string[] }) {
  return <>{ids.map(id => <CommandButton key={id} command={commands[id]} />)}</>;
}

// A collapsible sidebar group of commands with optional explanatory notes.
export function CommandGroup({ className, summary, commands, ids, children }: {
  className: string; summary: string; commands: EditorCommands; ids: readonly string[]; children?: ReactNode;
}) {
  return <details className={className}><summary>{summary}</summary><CommandButtons commands={commands} ids={ids} />{children}</details>;
}
