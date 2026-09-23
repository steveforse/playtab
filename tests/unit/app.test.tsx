// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/frontend/App';
import { demo } from '../../app/frontend/music/score';
import { exportAscii } from '../../app/frontend/music/ascii';

const { readMusicXml, musicXmlEditorState, applyMusicXmlEdits, addMusicXmlNote, removeMusicXmlNotes } = vi.hoisted(() => ({ readMusicXml: vi.fn(), musicXmlEditorState: vi.fn(), applyMusicXmlEdits: vi.fn(), addMusicXmlNote: vi.fn(), removeMusicXmlNotes: vi.fn() }));
vi.mock('../../app/frontend/Player', () => ({
  Player: ({ onPreferencesChange, onSelectionChange, onFretInput, onSelectionDelete, editing }: any) => <>
    <button type="button" data-testid="player" onClick={() => onPreferencesChange?.({ speed: 1.1 })}>Player</button>
    {editing && <>
      <button type="button" data-testid="choose-note" onClick={() => onSelectionChange?.({ track: 1, staff: 1, measure: 1, event: 1, voice: 1, string: 3, fret: 0, kind: 'note', noteId: 1, graceIndex: null, graceGroupId: null })}>Choose note</button>
      <button type="button" data-testid="choose-empty" onClick={() => onSelectionChange?.({ track: 1, staff: 1, measure: 1, event: 2, voice: 1, string: 2, fret: null, kind: 'empty', noteId: null, graceIndex: null, graceGroupId: null })}>Choose empty</button>
      <button type="button" data-testid="delete-empty" onClick={() => onSelectionDelete?.({ track: 1, staff: 1, measure: 1, event: 2, voice: 1, string: 2, fret: null, kind: 'empty', noteId: null, graceIndex: null, graceGroupId: null })}>Delete empty</button>
    </>}
  </>,
  defaultPlayerPreferences: () => ({
    speed: 1, volume: 1, loop: false, metronome: false, barsPerRow: 4, lyricsColumns: 2,
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
vi.mock('../../app/frontend/music/musicxml-editor', () => ({ musicXmlEditorState, applyMusicXmlEdits, addMusicXmlNote, removeMusicXmlNotes }));

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
  afterEach(() => { cleanup(); vi.restoreAllMocks(); readMusicXml.mockReset(); musicXmlEditorState.mockReset(); applyMusicXmlEdits.mockReset(); addMusicXmlNote.mockReset(); removeMusicXmlNotes.mockReset(); });
  afterAll(() => { vi.unstubAllGlobals(); });

  it('loads the library, opens plaintext and saves the native score', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ id: 7, title: 'My banjo tab' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/songs', expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: /Practice demo/ }));
    fireEvent.click(screen.getByTestId('player'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss practice tip' }));
    expect(screen.queryByRole('note', { name: 'Practice tip' })).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss import warnings' }));
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

  it('enters and leaves explicit score edit mode without changing the score', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([]));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/songs', expect.anything()));
    expect(screen.queryByLabelText('Edit tools')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit score' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('player')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    expect(screen.getByRole('button', { name: 'Done editing' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Edit tools')).toBeTruthy();
    expect(screen.getByText('Select a note or empty string position to begin editing.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Practice demo/ })).toBeNull();
    expect(screen.getByTestId('player')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
    expect(screen.queryByLabelText('Edit tools')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit score' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('player')).toBeTruthy();
  });

  it('applies, moves, deletes, undoes and redoes a native selected note', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    expect(screen.getByText('Fret 4')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Move to string'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
    expect(screen.getByText('String 2')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Redo', exact: true }));
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(screen.getByText('String 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect(screen.getByText('Fret 4')).toBeTruthy();
  });

  it('adds a native note at an empty staff position and replaces it without changing the chord', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-empty'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(screen.getByText('String 2')).toBeTruthy();
    expect(screen.getByText('Fret 1')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    expect(screen.getByText('Fret 2')).toBeTruthy();
  });

  it('removes native notes, makes rests, and ignores Delete on an empty selection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('delete-empty'));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove note' }));
    expect(screen.queryByText('Fret 0')).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Fret 0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make rest' }));
    expect(screen.queryByText('Fret 0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Fret 0')).toBeTruthy();
  });

  it('requires confirmation for imported dependencies and restores the source with one Undo', async () => {
    const source = '<score-partwise version="4.0"><part/></score-partwise>';
    const beforeBeat = { notes: [{ fret: 0 }], playbackStart: 0, graceType: 0, isRest: false };
    const afterBeat = { notes: [], playbackStart: 0, graceType: 0, isRest: true };
    const imported = (value: string) => ({ ...preview, source: value, score: {
      ...preview.score, tracks: [{ staves: [{ bars: [{ voices: [{ beats: [value.includes('removed') ? afterBeat : beforeBeat] }] }] }] }],
    } });
    readMusicXml.mockImplementation((value: string) => imported(value));
    removeMusicXmlNotes.mockReturnValue({ source: '<score-partwise removed="true"/>', dependencies: ['hammer-on'] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByRole('button', { name: 'Make rest' }));
    expect(screen.getByRole('dialog', { name: 'Confirm note removal' }).textContent).toContain('hammer-on');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Fret 0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Make rest' }));
    fireEvent.click(screen.getByRole('dialog', { name: 'Confirm note removal' }).querySelector('button:last-child')!);
    expect(screen.queryByText('Fret 0')).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Fret 0')).toBeTruthy();
  });

  it('blocks an imported deletion with a protected attachment', async () => {
    const imported = { ...preview, source: '<score-partwise version="4.0"><part/></score-partwise>' };
    readMusicXml.mockReturnValue(imported);
    removeMusicXmlNotes.mockImplementation(() => { throw new Error('This note has a protected tap attachment.'); });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', imported.source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByRole('button', { name: 'Make rest' }));
    expect(screen.getByRole('alert').textContent).toContain('protected tap attachment');
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
  });

  it('handles imported note corrections, empty selections, and failed restores', async () => {
    const imported = { ...preview, source: '<score-partwise version="4.0"><part/></score-partwise>' };
    readMusicXml.mockReturnValue(imported);
    musicXmlEditorState.mockReturnValue({ notes: [{ index: 0, measure: 0, beat: 0, string: 3, fret: 0, technique: 'none' }] });
    applyMusicXmlEdits.mockReturnValue('<edited/>');
    addMusicXmlNote.mockReturnValue('<added/>');
    const fetchMock = vi.fn().mockResolvedValue(response([]));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    openImport();
    selectFile('import.musicxml', imported.source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-empty'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(addMusicXmlNote).toHaveBeenCalledWith(imported.source, imported.score, expect.objectContaining({ measure: 0, beat: 1, string: 2, fret: 1 }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '23' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    await waitFor(() => expect(screen.getByText('Fret 23')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Delete' });
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(applyMusicXmlEdits).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  });
});
