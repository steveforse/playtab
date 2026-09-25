// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorToolbar } from '../../app/frontend/editor/EditorToolbar';
import type { EditorCommands } from '../../app/frontend/editor/commands';

afterEach(cleanup);

describe('editing ribbon', () => {
  it('shows the fret entry, reflects command state and moves focus with arrow keys from one tab stop', () => {
    const copy = vi.fn();
    const onHelp = vi.fn();
    const commands: EditorCommands = {
      'duration-8': { label: '1/8', ariaLabel: '1/8 duration', pressed: true, run: vi.fn() },
      'make-rest': { label: 'Make rest', run: vi.fn() },
      'copy-passage': { label: 'Copy passage', shortcut: 'Ctrl+C', run: copy },
      'cut-passage': { label: 'Cut passage…', disabled: true, reason: 'Select a range first', run: vi.fn() },
      'paste-passage': { label: 'Paste passage…', hidden: true, run: vi.fn() },
    };
    render(<EditorToolbar commands={commands} fret={{ value: '12', typing: true }} onHelp={onHelp} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Editing toolbar' });
    expect(within(toolbar).getByRole('group', { name: 'Duration' })).toBeTruthy();
    expect(screen.getByLabelText('Fret entry').textContent).toBe('12');
    expect(screen.getByLabelText('Fret entry').className).toContain('typing');
    const eighth = screen.getByRole('button', { name: '1/8 duration' });
    const rest = screen.getByRole('button', { name: 'Rest' });
    const note = screen.getByRole('button', { name: 'Note' });
    const copyButton = screen.getByRole('button', { name: 'Copy' });
    expect(eighth.getAttribute('aria-pressed')).toBe('true');
    expect(rest.getAttribute('title')).toBe('Make rest');
    expect(copyButton.getAttribute('title')).toBe('Copy passage (Ctrl+C)');
    expect(screen.getByRole('button', { name: 'Cut' }).getAttribute('title')).toBe('Cut passage… — Select a range first');
    expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull();
    expect([eighth, rest, note].map(button => button.tabIndex)).toEqual([0, -1, -1]);
    eighth.focus();
    fireEvent.keyDown(eighth, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(rest);
    fireEvent.keyDown(rest, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(note);
    fireEvent.keyDown(note, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(rest);
    fireEvent.keyDown(rest, { key: 'Home' });
    expect(document.activeElement).toBe(eighth);
    fireEvent.keyDown(eighth, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    fireEvent.keyDown(eighth, { key: 'x' });
    fireEvent.click(copyButton);
    expect(copy).toHaveBeenCalledWith(copyButton);
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(onHelp).toHaveBeenCalled();
  });

  it('opens a labelled command menu from its button and closes it again', () => {
    const tie = vi.fn();
    const commands: EditorCommands = { tie: { label: 'Tie', run: tie }, 'select-measure': { label: 'Select measure', run: vi.fn() }, 'hammer-on': { label: 'Hammer-on', disabled: true, reason: 'Select a note first', run: vi.fn() } };
    render(<EditorToolbar commands={commands} />);
    const techniques = screen.getByRole('button', { name: 'Techniques' });
    fireEvent.click(techniques);
    expect(techniques.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Techniques' });
    expect(within(menu).getByRole('menuitem', { name: /Hammer-on/ }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Tie/ }));
    expect(tie).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(techniques, { key: 'ArrowDown' });
    expect(screen.getByRole('menu', { name: 'Techniques' })).toBeTruthy();
    fireEvent.click(techniques);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /Select measure/ }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
