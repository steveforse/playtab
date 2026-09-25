// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandButton, CommandButtons, commandIcon, commandTitle } from '../../app/frontend/editor/commands';
import { Icon, isIconName } from '../../app/frontend/ui/icons';

afterEach(cleanup);

describe('editor commands', () => {
  it('renders an icon-only command with its name as the accessible name and tooltip', () => {
    const run = vi.fn();
    render(<CommandButton id="duration-8" command={{ label: '1/8', ariaLabel: '1/8 duration', iconOnly: true, pressed: true, run }} />);
    const button = screen.getByRole('button', { name: '1/8 duration' });
    expect(button.getAttribute('title')).toBe('1/8 duration');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.textContent).toBe('');
    fireEvent.click(button);
    expect(run).toHaveBeenCalledWith(button);
  });

  it('keeps labelled commands named by their label and adds shortcuts to tooltips', () => {
    render(<CommandButtons commands={{
      undo: { label: 'Undo', shortcut: 'Ctrl+Z', title: 'Undo: Edit fret', run: () => {} },
      'remove-tie': { label: 'Remove tie', hidden: true, run: () => {} },
      'copy-passage': { label: 'Copy passage', disabled: true, run: () => {} },
    }} ids={['undo', 'remove-tie', 'copy-passage']} />);
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('title')).toBe('Undo: Edit fret (Ctrl+Z)');
    expect(screen.queryByRole('button', { name: 'Remove tie' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Copy passage' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('resolves icons by id, alias or explicit choice', () => {
    const command = { label: 'x', run: () => {} };
    expect(commandIcon('tie', command)).toBe('tie');
    expect(commandIcon('copy-passage', command)).toBe('copy');
    expect(commandIcon('unknown', command)).toBeUndefined();
    expect(commandIcon('unknown', { ...command, icon: 'bend' })).toBe('bend');
    expect(commandTitle({ label: 'Plain', run: () => {} })).toBeUndefined();
    expect(commandTitle({ label: 'Remove', shortcut: 'Delete', run: () => {} })).toBe('Remove (Delete)');
    expect(isIconName('duration-64')).toBe(true);
    expect(isIconName('toString')).toBe(false);
    const { container } = render(<Icon name="time-signature" size={24} />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('24');
  });
});
