// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/frontend/App';
import { demo } from '../../app/frontend/music/score';
import { exportAscii } from '../../app/frontend/music/ascii';

const { readMusicXml } = vi.hoisted(() => ({ readMusicXml: vi.fn() }));
vi.mock('../../app/frontend/Player', () => ({
  Player: () => <div data-testid="player" />,
  defaultPlayerPreferences: () => ({
    speed: 1, loop: false, metronome: false, barsPerRow: 4, lyricsColumns: 2,
    scoreView: 'continuous', scrollDirection: 'vertical', showChordDiagrams: false,
    hideTabClef: false, soundFontId: 'musescore-general-lite',
  }),
}));
vi.mock('../../app/frontend/music/musicxml', () => ({
  readMusicXml,
  toImportedScoreDocument: (preview: any, warnings: string[]) => ({
    version: 2, kind: 'musicxml', title: preview.score.title, sourceName: preview.filename,
    sourceFormat: preview.sourceFormat, source: preview.source, warnings,
  }),
}));

const response = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });
const score = structuredClone(demo);
const preview = {
  id: 'preview-1', source: '<score-partwise version="4.0"/>', filename: 'import.musicxml', sourceFormat: 'musicxml',
  score: { title: 'Imported tune', masterBars: [{}] }, tuningLabel: 'g C G C D', lyricsSection: 'VERSE\nThere once was a ship',
};

function file(name: string, contents = '', size = contents.length) {
  const value = new File([contents], name);
  Object.defineProperty(value, 'text', { value: async () => contents });
  Object.defineProperty(value, 'size', { value: size });
  return value;
}

function selectFile(name: string, contents = '', size = contents.length) {
  const input = screen.getByLabelText('Choose tablature file');
  fireEvent.change(input, { target: { files: [file(name, contents, size)] } });
}

function openImport() {
  fireEvent.click(screen.getByRole('button', { name: /Import a tab/ }));
}

describe('workspace application', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); readMusicXml.mockReset(); });
  afterAll(() => { vi.unstubAllGlobals(); });

  it('loads the library, opens plaintext and saves the native score', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ id: 7, title: 'My banjo tab' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/songs', expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: /Practice demo/ }));
    fireEvent.click(screen.getByRole('button', { name: /Import a tab/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Morning tune' } });
    fireEvent.change(screen.getByLabelText('Plaintext tablature'), { target: { value: exportAscii(demo) } });
    fireEvent.click(screen.getByRole('button', { name: /Open in player/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Morning tune' })).toBeTruthy());
    expect(screen.queryByLabelText('Score editor')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Save to library/ }));
    await waitFor(() => expect(screen.getByText('Saved to your library.')).toBeTruthy());
    expect(fetchMock).toHaveBeenLastCalledWith('/api/songs', expect.objectContaining({ method: 'POST' }));
    fireEvent.click(screen.getByRole('button', { name: /My library/ }));
    expect(screen.queryByRole('button', { name: /Practice demo/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'My banjo tab' }));
    openImport();
    fireEvent.click(screen.getByRole('button', { name: 'Close import' }));
  });

  it('opens stored native and imported scores and reports load failures', async () => {
    const native = { id: 1, title: 'Native', score, source_text: 'D' };
    const imported = { id: 2, title: 'Imported', score: { version: 2, kind: 'musicxml', title: 'Imported', sourceName: 'i.xml', sourceFormat: 'musicxml', source: preview.source, warnings: ['warning'] }, source_text: null };
    readMusicXml.mockReturnValue(preview);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{ id: 1, title: 'Native' }, { id: 2, title: 'Imported' }]))
      .mockResolvedValueOnce(response(native))
      .mockResolvedValueOnce(response(imported))
      .mockRejectedValueOnce(new Error('library unavailable'));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Native' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Native' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: demo.title })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Imported' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    expect(screen.getByText('warning')).toBeTruthy();
    expect(screen.queryByLabelText('Score editor')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Native' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('library unavailable'));
  });

  it('handles import formats, limits and conversion errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([]));
    vi.stubGlobal('fetch', fetchMock);
    readMusicXml.mockReturnValue(preview);
    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    openImport();
    fetchMock.mockResolvedValueOnce(response({ musicxml: preview.source, warnings: ['PDF warning'] }));
    selectFile('notes.pdf', 'raw pdf');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/pdf_imports', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(screen.getByText('PDF warning')).toBeTruthy());
    openImport();
    selectFile('notes.mid');
    expect((await screen.findByRole('alert')).textContent).toContain('Choose a .tef');
    selectFile('notes.musicxml', 'x', 2_000_001);
    expect((await screen.findByRole('alert')).textContent).toContain('smaller than 2 MB');

    selectFile('notes.txt', exportAscii(demo));
    await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('notes'));
    fireEvent.click(screen.getByRole('button', { name: /Open in player/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'notes' })).toBeTruthy());

    openImport();
    selectFile('notes.json', JSON.stringify(score));
    await waitFor(() => expect(screen.getByRole('heading', { name: score.title })).toBeTruthy());

    openImport();
    selectFile('notes.musicxml', preview.source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());

    openImport();
    fetchMock.mockResolvedValueOnce(response({ musicxml: preview.source, warnings: ['TEF warning'] }));
    selectFile('notes.tef', 'raw tef');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tef_imports', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(screen.getByText('TEF warning')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Import a tab/ }));
    fetchMock.mockRejectedValueOnce(new Error('TEF failed'));
    selectFile('notes.tef', 'raw tef');
    expect((await screen.findByRole('alert')).textContent).toContain('TEF failed');
  });

  it('reports invalid JSON, import parsing and save failures', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('library load failed'));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    openImport();
    fireEvent.change(screen.getByLabelText('Choose tablature file'), { target: { files: [] } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Assume each note is' }), { target: { value: '4' } });
    selectFile('bad.json', '{}');
    await waitFor(() => expect(screen.getAllByRole('alert').map(alert => alert.textContent).some(text => /Unsupported|version/.test(text ?? ''))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /Import a tab/ }));
    fireEvent.change(screen.getByLabelText('Plaintext tablature'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: /Open in player/ }));
    await waitFor(() => expect(screen.getAllByRole('alert').map(alert => alert.textContent).some(text => text?.includes('five tablature lines'))).toBe(true));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error('not json'); } });
    fireEvent.click(screen.getByRole('button', { name: /Save to library/ }));
    await waitFor(() => expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toContain('Request failed (500).'));
  });

  it('signs out the current account', async () => {
    const root = document.createElement('div');
    root.id = 'playtab-root';
    root.dataset.userEmail = 'user@example.com';
    document.body.append(root);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({}));
    vi.stubGlobal('fetch', fetchMock);
    const originalLocation = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
    render(<App />);

    await waitFor(() => expect(screen.getByText('user@example.com')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/session', expect.objectContaining({ method: 'DELETE' })));
    expect(assign).toHaveBeenCalledWith('/session/new');
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    root.remove();
  });

  it('reports a failed sign out request', async () => {
    const root = document.createElement('div');
    root.id = 'playtab-root';
    root.dataset.userEmail = 'user@example.com';
    document.body.append(root);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ error: 'no' }, false, 500));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await waitFor(() => expect(screen.getByText('user@example.com')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not sign out.'));
    root.remove();
  });
});
