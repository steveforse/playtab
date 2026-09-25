// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu, type MenuEntry } from '../../app/frontend/editor/ContextMenu';
import type { EditorCommands } from '../../app/frontend/editor/commands';

afterEach(cleanup);

function setup(onClose = vi.fn()) {
  const run = { copy: vi.fn(), paste: vi.fn(), tie: vi.fn(), bend: vi.fn() };
  const commands: EditorCommands = {
    'copy-passage': { label: 'Copy passage', shortcut: 'Ctrl+C', run: run.copy },
    'paste-passage': { label: 'Paste passage…', disabled: true, reason: 'Copy or cut measures first', run: run.paste },
    'remove-tie': { label: 'Remove tie', hidden: true, run: vi.fn() },
    tie: { label: 'Tie', run: run.tie },
    bend: { label: 'Bend…', run: run.bend },
  };
  const entries: MenuEntry[] = ['-', 'copy-passage', 'paste-passage', 'remove-tie', '-', { label: 'Techniques', items: ['tie', 'bend'] },
    { label: 'Empty', items: ['remove-tie'] }, '-'];
  render(<div><button type="button">Outside</button><ContextMenu at={{ x: 10, y: 10 }} entries={entries} commands={commands} label="Score actions" onClose={onClose} /></div>);
  return { run, onClose };
}

describe('context menu', () => {
  it('lists visible commands with reasons, skips hidden and empty groups, and trims separators', () => {
    setup();
    const menu = screen.getByRole('menu', { name: 'Score actions' });
    const items = screen.getAllByRole('menuitem');
    expect(items.map(item => item.textContent)).toEqual(['Copy passageCtrl+C', 'Paste passage…Copy or cut measures first', 'Techniques▸']);
    expect(items[1].getAttribute('aria-disabled')).toBe('true');
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(document.activeElement).toBe(items[0]);
  });

  it('navigates with arrows, Home/End and type-ahead, and opens submenus with the keyboard', () => {
    const { run, onClose } = setup();
    const items = screen.getAllByRole('menuitem');
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: 'Enter' });
    expect(run.paste).not.toHaveBeenCalled();
    fireEvent.keyDown(items[1], { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2], { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
    fireEvent.keyDown(items[2], { key: 'c' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 't' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2], { key: 'ArrowRight' });
    const submenu = screen.getByRole('menu', { name: 'Techniques' });
    expect(items[2].getAttribute('aria-expanded')).toBe('true');
    const tie = screen.getByRole('menuitem', { name: 'Tie' });
    expect(document.activeElement).toBe(tie);
    fireEvent.keyDown(tie, { key: 'ArrowLeft' });
    expect(screen.queryByRole('menu', { name: 'Techniques' })).toBeNull();
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2], { key: ' ' });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Tie' }), { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Techniques' })).toBeNull();
    expect(submenu.isConnected).toBe(false);
    fireEvent.keyDown(items[2], { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Tie' }), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Bend…' }), { key: 'Enter' });
    expect(run.bend).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('runs a clicked command, opens submenus on hover and closes on Escape, Tab or an outside press', () => {
    const { run, onClose } = setup();
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /Techniques/ }));
    expect(screen.getByRole('menu', { name: 'Techniques' })).toBeTruthy();
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /Copy passage/ }));
    expect(screen.queryByRole('menu', { name: 'Techniques' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy passage/ }));
    expect(run.copy).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /Copy passage/ }), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /Copy passage/ }), { key: 'Tab' });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(onClose.mock.calls.map(call => call[0])).toEqual([true, false, false, false]);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /Copy passage/ }), { key: 'x' });
    fireEvent(window, new Event('resize'));
    expect(onClose).toHaveBeenLastCalledWith(false);
  });

  it('renders nothing without a position', () => {
    render(<ContextMenu at={null} entries={['x']} commands={{}} label="Score actions" onClose={() => {}} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
