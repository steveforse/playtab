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
      undo: { label: 'Undo', shortcut: 'Ctrl+Z', run: undo },
      redo: { label: 'Redo', disabled: true, reason: 'Nothing to redo', run: vi.fn() },
      'duration-8': { label: '1/8', ariaLabel: '1/8 duration', pressed: true, run: vi.fn() },
      'make-rest': { label: 'Make rest', hidden: true, run: vi.fn() },
      tie: { label: 'Tie', run: vi.fn() },
      'odd-command': { label: 'Odd', run: vi.fn() },
    };
    render(<EditorToolbar commands={commands} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Editing toolbar' });
    expect(within(toolbar).getByRole('group', { name: 'History' })).toBeTruthy();
    const undoButton = screen.getByRole('button', { name: 'Undo' });
    const redoButton = screen.getByRole('button', { name: 'Redo' });
    const eighth = screen.getByRole('button', { name: '1/8 duration' });
    const tie = screen.getByRole('button', { name: 'Tie' });
    expect(undoButton.getAttribute('title')).toBe('Undo (Ctrl+Z)');
    expect(redoButton.getAttribute('title')).toBe('Redo — Nothing to redo');
    expect(eighth.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Make rest' })).toBeNull();
    expect([undoButton, eighth, tie].map(button => button.tabIndex)).toEqual([0, -1, -1]);
    undoButton.focus();
    fireEvent.keyDown(undoButton, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(eighth);
    fireEvent.keyDown(eighth, { key: 'End' });
    expect(document.activeElement).toBe(tie);
    fireEvent.keyDown(tie, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(undoButton);
    fireEvent.keyDown(undoButton, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tie);
    fireEvent.keyDown(tie, { key: 'Home' });
    expect(document.activeElement).toBe(undoButton);
    fireEvent.keyDown(undoButton, { key: 'x' });
    expect(document.activeElement).toBe(undoButton);
    fireEvent.click(undoButton);
    expect(undo).toHaveBeenCalledWith(undoButton);
  });
});
