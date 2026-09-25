// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorToolbar } from '../../app/frontend/editor/EditorToolbar';
import type { EditorCommands } from '../../app/frontend/editor/commands';

afterEach(cleanup);

describe('editing toolbar', () => {
  it('groups icon commands, reflects state and moves focus with arrow keys from one tab stop', () => {
    const undo = vi.fn();
    const commands: EditorCommands = {
      'edit-fret': { label: 'Edit fret…', shortcut: 'Enter', run: undo },
      'copy-passage': { label: 'Copy passage', disabled: true, reason: 'Select a range first', run: vi.fn() },
      'duration-8': { label: '1/8', ariaLabel: '1/8 duration', pressed: true, run: vi.fn() },
      'make-rest': { label: 'Make rest', hidden: true, run: vi.fn() },
      tie: { label: 'Tie', run: vi.fn() },
      'odd-command': { label: 'Odd', run: vi.fn() },
    };
    render(<EditorToolbar commands={commands} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Editing toolbar' });
    expect(within(toolbar).getByRole('group', { name: 'Duration' })).toBeTruthy();
    const undoButton = screen.getByRole('button', { name: 'Edit fret…' });
    const redoButton = screen.getByRole('button', { name: 'Copy passage' });
    const eighth = screen.getByRole('button', { name: '1/8 duration' });
    const tie = screen.getByRole('button', { name: 'Tie' });
    expect(undoButton.getAttribute('title')).toBe('Edit fret… (Enter)');
    expect(redoButton.getAttribute('title')).toBe('Copy passage — Select a range first');
    expect(eighth.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Make rest' })).toBeNull();
    expect([eighth, undoButton, tie].map(button => button.tabIndex)).toEqual([0, -1, -1]);
    eighth.focus();
    fireEvent.keyDown(eighth, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(undoButton);
    fireEvent.keyDown(undoButton, { key: 'End' });
    expect(document.activeElement).toBe(tie);
    fireEvent.keyDown(tie, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(eighth);
    fireEvent.keyDown(eighth, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tie);
    fireEvent.keyDown(tie, { key: 'Home' });
    expect(document.activeElement).toBe(eighth);
    fireEvent.keyDown(eighth, { key: 'x' });
    expect(document.activeElement).toBe(eighth);
    fireEvent.click(undoButton);
    expect(undo).toHaveBeenCalledWith(undoButton);
  });
});
