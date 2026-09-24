// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/frontend/App';
import { demo } from '../../app/frontend/music/score';
import { exportAscii } from '../../app/frontend/music/ascii';

const { readMusicXml, promoteNativeScore, musicXmlEditorState, applyMusicXmlEdits, addMusicXmlNote, addMusicXmlRepeat, addMusicXmlEndings, inspectMusicXmlRepeats, inspectMusicXmlRepeatEndings, removeMusicXmlRepeat, removeMusicXmlNotes, changeMusicXmlDuration, changeMusicXmlMeter, changeMusicXmlPickup, connectMusicXmlTie, inspectMusicXmlTie, removeMusicXmlTie, inspectMusicXmlDuration, inspectMusicXmlMeterRange, insertMusicXmlEvent, createMusicXmlTriplet, removeMusicXmlTriplet, inspectMusicXmlTriplet, insertMusicXmlMeasure, duplicateMusicXmlMeasure, deleteMusicXmlMeasure, sourceTabNoteRecords } = vi.hoisted(() => ({ readMusicXml: vi.fn(), promoteNativeScore: vi.fn(), musicXmlEditorState: vi.fn(), applyMusicXmlEdits: vi.fn(), addMusicXmlNote: vi.fn(), addMusicXmlRepeat: vi.fn(), addMusicXmlEndings: vi.fn(), inspectMusicXmlRepeats: vi.fn(() => []), inspectMusicXmlRepeatEndings: vi.fn(() => null), removeMusicXmlRepeat: vi.fn(), removeMusicXmlNotes: vi.fn(), changeMusicXmlDuration: vi.fn(), changeMusicXmlMeter: vi.fn(), changeMusicXmlPickup: vi.fn(), connectMusicXmlTie: vi.fn(), inspectMusicXmlTie: vi.fn(() => ({ canRemove: false })), removeMusicXmlTie: vi.fn(), inspectMusicXmlDuration: vi.fn(() => ({ denominator: 4, dots: 0, rest: false })), inspectMusicXmlMeterRange: vi.fn(() => ({ firstMeasure: 1, lastMeasure: 2 })), insertMusicXmlEvent: vi.fn(), createMusicXmlTriplet: vi.fn(), removeMusicXmlTriplet: vi.fn(), inspectMusicXmlTriplet: vi.fn(() => ({ triplet: false, canRemove: false })), insertMusicXmlMeasure: vi.fn(), duplicateMusicXmlMeasure: vi.fn(), deleteMusicXmlMeasure: vi.fn(), sourceTabNoteRecords: vi.fn(() => []) }));
vi.mock('../../app/frontend/Player', () => ({
  Player: ({ onPreferencesChange, onSelectionChange, onFretInput, onSelectionDelete, editing }: any) => <>
    <button type="button" data-testid="player" onClick={() => onPreferencesChange?.({ speed: 1.1 })}>Player</button>
    {editing && <>
      <button type="button" data-testid="choose-note" onClick={() => onSelectionChange?.({ track: 1, staff: 1, measure: 1, event: 1, voice: 1, string: 3, fret: 0, kind: 'note', noteId: 1, graceIndex: null, graceGroupId: null })}>Choose note</button>
      <button type="button" data-testid="choose-next-note" onClick={() => onSelectionChange?.({ track: 1, staff: 1, measure: 2, event: 1, voice: 1, string: 3, fret: 0, kind: 'note', noteId: 2, graceIndex: null, graceGroupId: null })}>Choose next note</button>
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
  readMusicXml, promoteNativeScore,
  toImportedScoreDocument: (preview: any, warnings: string[]) => ({
    version: 2, kind: 'musicxml', title: preview.score.title, sourceName: preview.filename,
    sourceFormat: preview.sourceFormat, source: preview.source, warnings,
  }),
}));
vi.mock('../../app/frontend/music/musicxml-editor', () => ({ musicXmlEditorState, applyMusicXmlEdits, addMusicXmlNote, addMusicXmlRepeat, addMusicXmlEndings, inspectMusicXmlRepeats, inspectMusicXmlRepeatEndings, removeMusicXmlRepeat, removeMusicXmlNotes, changeMusicXmlDuration, changeMusicXmlMeter, changeMusicXmlPickup, connectMusicXmlTie, inspectMusicXmlTie, removeMusicXmlTie, inspectMusicXmlDuration, inspectMusicXmlMeterRange, insertMusicXmlEvent, createMusicXmlTriplet, removeMusicXmlTriplet, inspectMusicXmlTriplet, insertMusicXmlMeasure, duplicateMusicXmlMeasure, deleteMusicXmlMeasure, sourceTabNoteRecords }));

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
  afterEach(() => { cleanup(); vi.restoreAllMocks(); readMusicXml.mockReset(); promoteNativeScore.mockReset(); musicXmlEditorState.mockReset(); applyMusicXmlEdits.mockReset(); addMusicXmlNote.mockReset(); addMusicXmlRepeat.mockReset(); inspectMusicXmlRepeats.mockReset(); removeMusicXmlNotes.mockReset(); changeMusicXmlDuration.mockReset(); changeMusicXmlMeter.mockReset(); changeMusicXmlPickup.mockReset(); connectMusicXmlTie.mockReset(); inspectMusicXmlTie.mockReset(); removeMusicXmlTie.mockReset(); inspectMusicXmlDuration.mockReset(); inspectMusicXmlMeterRange.mockReset(); insertMusicXmlEvent.mockReset(); createMusicXmlTriplet.mockReset(); removeMusicXmlTriplet.mockReset(); inspectMusicXmlTriplet.mockReset(); insertMusicXmlMeasure.mockReset(); duplicateMusicXmlMeasure.mockReset(); deleteMusicXmlMeasure.mockReset(); sourceTabNoteRecords.mockReset(); sourceTabNoteRecords.mockReturnValue([]); inspectMusicXmlRepeats.mockReturnValue([]); inspectMusicXmlTie.mockReturnValue({ canRemove: false }); inspectMusicXmlDuration.mockReturnValue({ denominator: 4, dots: 0, rest: false }); inspectMusicXmlMeterRange.mockReturnValue({ firstMeasure: 1, lastMeasure: 2 }); inspectMusicXmlTriplet.mockReturnValue({ triplet: false, canRemove: false }); });
  afterEach(() => { addMusicXmlEndings.mockReset(); inspectMusicXmlRepeatEndings.mockReset(); inspectMusicXmlRepeatEndings.mockReturnValue(null); removeMusicXmlRepeat.mockReset(); });
  afterAll(() => { vi.unstubAllGlobals(); });

  it('sets and clears keyboard-accessible passage endpoints without editing the document', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([]));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Select passage'));
    fireEvent.click(screen.getByRole('button', { name: 'Set range start' }));
    fireEvent.click(screen.getByTestId('choose-empty'));
    fireEvent.click(screen.getByRole('button', { name: 'Set range end' }));
    expect((screen.getByRole('button', { name: 'Clear passage' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Clear passage' }));
    expect((screen.getByRole('button', { name: 'Clear passage' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });

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

  it('promotes a high native fret in one undoable command before saving', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response({ id: 9, title: score.title, revision: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename, score: { title: score.title, masterBars: [{}] } }));
    musicXmlEditorState.mockReturnValue({ notes: [{ index: 0, measure: 0, beat: 0, string: 3, fret: 0, technique: 'none' }] });
    applyMusicXmlEdits.mockReturnValue('<score-partwise><edited/></score-partwise>');
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '28' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    expect(promoteNativeScore).toHaveBeenCalledOnce();
    expect(screen.getByText('Fret 28')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect(screen.getByText('Fret 0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Redo', exact: true }));
    expect(screen.getByText('Fret 28')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '＋ Save to library' }));
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sent.score).toMatchObject({ version: 2, kind: 'musicxml', source: '<score-partwise><edited/></score-partwise>' });
  });

  it('promotes a native rhythm edit as one undoable MusicXML change', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    changeMusicXmlDuration.mockReturnValue('<score-partwise><rhythm/></score-partwise>');
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{}] } }));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByRole('button', { name: '1/16 duration' }));
    expect(changeMusicXmlDuration).toHaveBeenCalledWith('<score-partwise/>', expect.anything(),
      { measure: 0, beat: 0, voice: 0 }, 16, false);
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Fret 0')).toBeTruthy();
    changeMusicXmlDuration.mockImplementation(() => { throw new Error('Not enough rest space in this measure.'); });
    fireEvent.click(screen.getByRole('button', { name: '1/2 duration' }));
    expect(screen.getByRole('alert').textContent).toContain('Not enough rest space');
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
  });

  it('offers a complete Insert event dialog and records a successful insert as one history step', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    insertMusicXmlEvent.mockReturnValue('<score-partwise><inserted/></score-partwise>');
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{}] } }));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByRole('button', { name: 'Insert event…' }));
    const dialog = screen.getByRole('dialog', { name: 'Insert event' });
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'before' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'note' } });
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '8' } });
    fireEvent.click(screen.getByLabelText('Dotted'));
    fireEvent.change(within(dialog).getByLabelText('String'), { target: { value: '2' } });
    fireEvent.change(within(dialog).getByLabelText('Fret'), { target: { value: '3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Insert', exact: true }));
    expect(insertMusicXmlEvent).toHaveBeenCalledWith('<score-partwise/>', expect.anything(), {
      measure: 0, beat: 0, voice: 0, placement: 'before', kind: 'note', denominator: 8,
      dotted: true, string: 2, fret: 3,
    });
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    insertMusicXmlEvent.mockImplementation(() => { throw new Error('Not enough rest space in this measure.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Insert event…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Insert', exact: true }));
    expect(within(dialog).getByRole('alert').textContent).toContain('Not enough rest space');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('promotes Triplet and removes a supported group as separate undoable commands', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    createMusicXmlTriplet.mockReturnValue('<score-partwise><triplet/></score-partwise>');
    removeMusicXmlTriplet.mockReturnValue('<score-partwise><restored/></score-partwise>');
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{}] } }));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByRole('button', { name: 'Triplet', exact: true }));
    expect(createMusicXmlTriplet).toHaveBeenCalledWith('<score-partwise/>', expect.anything(),
      { measure: 0, beat: 0, voice: 0 });
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    inspectMusicXmlTriplet.mockReturnValue({ triplet: true, canRemove: true, start: 0 });
    fireEvent.change(screen.getByRole('combobox', { name: 'Selection string' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove triplet' }));
    expect(removeMusicXmlTriplet).toHaveBeenCalledWith('<score-partwise><triplet/></score-partwise>', expect.anything(),
      { measure: 0, beat: 0, voice: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Redo' }).hasAttribute('disabled')).toBe(false);
  });

  it('promotes a native measure insertion and restores it with Undo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    insertMusicXmlMeasure.mockReturnValue('<score-partwise><new-measure/></score-partwise>');
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{}, {}] } }));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert measure after' }));
    expect(insertMusicXmlMeasure).toHaveBeenCalledWith('<score-partwise/>', expect.anything(), 0, 'after');
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('Select passage', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set range start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert measure before' }));
    expect(insertMusicXmlMeasure).toHaveBeenLastCalledWith('<score-partwise/>', expect.anything(), 0, 'before');
    expect(screen.getByText('Playback selection cleared after inserting a measure.')).toBeTruthy();
  });

  it('previews and adds a repeat as one undoable MusicXML change', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    addMusicXmlRepeat.mockReturnValue('<score-partwise><repeat/></score-partwise>');
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{}, {}] } }));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Repeat / endings…' }));
    const dialog = screen.getByRole('dialog', { name: 'Repeat / endings' });
    expect(within(dialog).getByText(/Existing repeats: none/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Play count'), { target: { value: '3' } });
    expect(addMusicXmlRepeat).toHaveBeenLastCalledWith('<score-partwise/>', expect.anything(), 0, 1, 3);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add repeat' }));
    expect(screen.getByText('Repeat added: measures 1–2, 3 plays.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    addMusicXmlRepeat.mockImplementation(() => { throw new Error('Nested or overlapping repeat regions cannot be authored.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Repeat / endings…' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('overlapping repeat');
    expect(within(dialog).getByRole('button', { name: 'Add repeat' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    inspectMusicXmlRepeats.mockReturnValue([{ start: 0, end: 1, count: 2 }]);
    addMusicXmlRepeat.mockReturnValue('<score-partwise><repeat/></score-partwise>');
    fireEvent.click(screen.getByRole('button', { name: 'Repeat / endings…' }));
    expect(within(dialog).getByText(/measures 1–2 ×2/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    inspectMusicXmlRepeats.mockImplementation(() => { throw new Error('Imported repeat map cannot be read.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Repeat / endings…' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('Imported repeat map cannot be read');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    inspectMusicXmlRepeats.mockReturnValue([]);
    addMusicXmlRepeat.mockReturnValue('<score-partwise><repeat/></score-partwise>');
    fireEvent.click(screen.getByRole('button', { name: 'Repeat / endings…' }));
    readMusicXml.mockImplementationOnce(() => { throw new Error('The updated repeat could not be rendered.'); });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add repeat' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('could not be rendered');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Repeat / endings…' }));
    expect(screen.getByRole('alert').textContent).toContain('Apply the pending fret');
  });

  it('adds endings and confirms removal of their repeat dependency', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    inspectMusicXmlRepeats.mockReturnValue([{ start: 1, end: 3, count: 2 }]);
    inspectMusicXmlRepeatEndings.mockReturnValue(null);
    addMusicXmlEndings.mockReturnValue('<score-partwise><endings/></score-partwise>');
    removeMusicXmlRepeat.mockReturnValue('<score-partwise><cleared/></score-partwise>');
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{}, {}, {}, {}, {}, {}] } }));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Repeat / endings…' }));
    const dialog = screen.getByRole('dialog', { name: 'Repeat / endings' });
    expect(within(dialog).getByLabelText('Repeat region')).toBeTruthy();
    expect(within(dialog).getByLabelText('First ending start').getAttribute('value')).toBe('4');
    fireEvent.change(within(dialog).getByLabelText('First ending start'), { target: { value: '3' } });
    expect(addMusicXmlEndings).toHaveBeenLastCalledWith('<score-partwise/>', expect.anything(), 1, 3, 2, 4);
    fireEvent.change(within(dialog).getByLabelText('First ending start'), { target: { value: '4' } });
    fireEvent.change(within(dialog).getByLabelText('Second ending end'), { target: { value: '6' } });
    expect(addMusicXmlEndings).toHaveBeenLastCalledWith('<score-partwise/>', expect.anything(), 1, 3, 3, 5);
    fireEvent.change(within(dialog).getByLabelText('Second ending end'), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add first/second endings' }));
    expect(addMusicXmlEndings).toHaveBeenCalledWith('<score-partwise/>', expect.anything(), 1, 3, 3, 4);
    expect(screen.getByText(/First and second endings added/)).toBeTruthy();
    const endings = { firstStart: 3, firstEnd: 3, secondStart: 4, secondEnd: 4 };
    inspectMusicXmlRepeatEndings.mockReturnValue(endings);
    fireEvent.click(screen.getByRole('button', { name: 'Repeat / endings…' }));
    expect(within(dialog).getByText(/First ending: measures 4–4/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear selected repeat/ending…' }));
    const confirmation = screen.getByRole('dialog', { name: 'Clear repeat and endings' });
    expect(within(confirmation).getByText(/dependent first ending/)).toBeTruthy();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(removeMusicXmlRepeat).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Repeat / endings…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear selected repeat/ending…' }));
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Clear repeat and endings' }));
    expect(removeMusicXmlRepeat).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/removed with its dependent endings/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Redo' }).hasAttribute('disabled')).toBe(false);
    inspectMusicXmlRepeatEndings.mockImplementation(() => { throw new Error('Unsupported imported endings.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Repeat / endings…' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('Unsupported imported endings');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear selected repeat/ending…' }));
    expect(within(dialog).getAllByRole('alert').at(-1)?.textContent).toContain('Unsupported imported endings');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('previews exclusions, cancels safely, and confirms duplication as one history step', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    duplicateMusicXmlMeasure.mockReturnValue({ source: '<score-partwise><copied/></score-partwise>',
      excluded: ['cross-measure tie', 'repeat marker'] });
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{}, {}] } }));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate measure…' }));
    const dialog = screen.getByRole('dialog', { name: 'Duplicate measure' });
    expect(within(dialog).getByText('cross-measure tie')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate measure…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate measure', exact: true }));
    expect(duplicateMusicXmlMeasure).toHaveBeenCalledWith('<score-partwise/>', expect.anything(), 0);
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
  });

  it('carries original measure, event, and note IDs past a duplicated bar', async () => {
    const source = '<score-partwise><part><measure number="1"><note><rest/></note></measure><measure number="2"><note><rest/></note></measure></part></score-partwise>';
    const copied = source.replace('</part>', '<measure number="3"><note><rest/></note></measure></part>');
    const identity = { nextId: 3, noteIds: ['n1', 'n2'], nextMeasureId: 3, measureIds: ['m1', 'm2'],
      nextEventId: 3, eventIds: ['e1', 'e2'] };
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, sourceIdentity: identity,
      sourceEventIdByAddress: new Map([['0:1:0', 'e1'], ['1:1:0', 'e2']]),
      score: { title: 'Imported tune', masterBars: value === copied ? [{}, {}, {}] : [{}, {}] } }));
    sourceTabNoteRecords.mockReturnValue([
      { id: '0:1:0:main:main:3', measure: 0 }, { id: '1:1:0:main:main:3', measure: 1 },
    ]);
    duplicateMusicXmlMeasure.mockReturnValue({ source: copied, excluded: [] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    openImport(); selectFile('import.musicxml', source);
    await screen.findByRole('heading', { name: 'Imported tune' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate measure…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Duplicate measure' }))
      .getByRole('button', { name: 'Duplicate measure', exact: true }));
    const carries = readMusicXml.mock.calls.at(-1)?.[3]?.carries;
    expect(carries).toEqual(expect.arrayContaining([
      { kind: 'measure', id: 'm1', address: '0' }, { kind: 'measure', id: 'm2', address: '2' },
      { kind: 'event', id: 'e1', address: '0:1:0' }, { kind: 'event', id: 'e2', address: '2:1:0' },
      { kind: 'note', id: 'n1', address: '0:1:0:main:main:3' },
      { kind: 'note', id: 'n2', address: '2:1:0:main:main:3' },
    ]));
  });

  it('previews deletion, cancels without history, then clears the edit target and supports Undo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    deleteMusicXmlMeasure.mockReturnValue({ source: '<score-partwise><deleted/></score-partwise>',
      noteCount: 2, restCount: 1, labelCount: 1 });
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{}, {}] } }));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete measure…' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete measure' });
    expect(within(dialog).getByText(/2 notes, 1 rest, and 1 local label/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete measure…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete measure', exact: true }));
    expect(deleteMusicXmlMeasure).toHaveBeenCalledWith('<score-partwise/>', expect.anything(), 0);
    expect(screen.getByText('Measure deleted. Edit selection cleared.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
  });

  it('keeps surviving imported IDs and clears a playback range touching the deleted bar', async () => {
    const source = '<score-partwise><part><measure number="1"><note><rest/></note></measure><measure number="2"><note><rest/></note></measure><measure number="3"><note><rest/></note></measure></part></score-partwise>';
    const deleted = source.replace('<measure number="1"><note><rest/></note></measure>', '');
    const identity = { nextId: 4, noteIds: ['n1', 'n2', 'n3'], nextMeasureId: 4, measureIds: ['m1', 'm2', 'm3'],
      nextEventId: 4, eventIds: ['e1', 'e2', 'e3'] };
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, sourceIdentity: identity,
      sourceEventIdByAddress: new Map([['0:1:0', 'e1'], ['1:1:0', 'e2'], ['2:1:0', 'e3']]),
      score: { title: 'Imported tune', masterBars: value === deleted ? [{}, {}] : [{}, {}, {}] } }));
    sourceTabNoteRecords.mockReturnValue([
      { id: '0:1:0:main:main:3', measure: 0 }, { id: '1:1:0:main:main:3', measure: 1 },
      { id: '2:1:0:main:main:3', measure: 2 },
    ]);
    deleteMusicXmlMeasure.mockReturnValue({ source: deleted, noteCount: 0, restCount: 1, labelCount: 0 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    openImport(); selectFile('import.musicxml', source);
    await screen.findByRole('heading', { name: 'Imported tune' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Select passage', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set range start' }));
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete measure…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete measure' }))
      .getByRole('button', { name: 'Delete measure', exact: true }));
    const carries = readMusicXml.mock.calls.at(-1)?.[3]?.carries;
    expect(carries).toEqual(expect.arrayContaining([
      { kind: 'measure', id: 'm2', address: '0' }, { kind: 'measure', id: 'm3', address: '1' },
      { kind: 'event', id: 'e2', address: '0:1:0' }, { kind: 'event', id: 'e3', address: '1:1:0' },
      { kind: 'note', id: 'n2', address: '0:1:0:main:main:3' },
      { kind: 'note', id: 'n3', address: '1:1:0:main:main:3' },
    ]));
    expect(carries).not.toEqual(expect.arrayContaining([{ kind: 'measure', id: 'm1', address: '0' }]));
    expect(screen.getByText('Playback selection cleared because it touched the deleted measure.')).toBeTruthy();
  });

  it('retains playback endpoints when a different measure is deleted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    deleteMusicXmlMeasure.mockReturnValue({ source: '<score-partwise><deleted/></score-partwise>',
      noteCount: 0, restCount: 1, labelCount: 0 });
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: Array(source.includes('deleted') ? 2 : 3).fill({}) } }));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Select passage', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set range start' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Selection measure' }), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete measure…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete measure' }))
      .getByRole('button', { name: 'Delete measure', exact: true }));
    expect(screen.getByText('Measure deleted. Playback selection moved with surviving measures.')).toBeTruthy();
  });

  it('previews a meter range before Apply and records the change as one undo step', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{ timeSignatureNumerator: source.includes('meter') ? 4 : 3,
        timeSignatureDenominator: 4 }, { timeSignatureNumerator: 3, timeSignatureDenominator: 4 }] } }));
    changeMusicXmlMeter.mockImplementation((_source: string, _score: unknown, _measure: number, numerator: number) => {
      if (numerator === 3) throw new Error('Measure 2, voice 1: final time is not removable rest.');
      return { source: '<score-partwise><meter/></score-partwise>', firstMeasure: 1, lastMeasure: 2 };
    });
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Time signature…' }));
    const dialog = screen.getByRole('dialog', { name: 'Time signature' });
    expect(within(dialog).getByText('Affects measures 1–2 (2 total).')).toBeTruthy();
    expect(within(dialog).getByText('Measure 2, voice 1: final time is not removable rest.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Apply' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Numerator'), { target: { value: '4' } });
    fireEvent.change(within(dialog).getByLabelText('Apply to'), { target: { value: 'from' } });
    expect(within(dialog).getByText('Affects measures 1–2 (2 total).')).toBeTruthy();
    expect(changeMusicXmlMeter).toHaveBeenLastCalledWith('<score-partwise/>', expect.anything(), 0, 4, 4, 'from');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
  });

  it('keeps pickup first-measure-only, validates the draft, and restores the change with Undo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{ timeSignatureNumerator: 4, timeSignatureDenominator: 4 },
        { timeSignatureNumerator: 4, timeSignatureDenominator: 4 }] } }));
    changeMusicXmlPickup.mockImplementation((_source: string, _score: unknown, numerator: number) => {
      if (numerator === 4) throw new Error('Pickup length must be shorter.');
      return '<score-partwise><pickup/></score-partwise>';
    });
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pickup…' }));
    const dialog = screen.getByRole('dialog', { name: 'Pickup' });
    fireEvent.change(within(dialog).getByLabelText('Numerator'), { target: { value: '4' } });
    expect(within(dialog).getByText('Pickup length must be shorter.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Apply' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Numerator'), { target: { value: '1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(changeMusicXmlPickup).toHaveBeenLastCalledWith('<score-partwise/>', expect.anything(), 1, 8);
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows candidate reload failures inside each dialog and leaves history untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    readMusicXml.mockImplementation((source: string, filename: string) => {
      if (source.includes('<broken/>')) throw new Error('The candidate cannot be loaded.');
      return { ...preview, source, filename, score: { title: score.title,
        masterBars: [{ timeSignatureNumerator: 4, timeSignatureDenominator: 4 },
          { timeSignatureNumerator: 4, timeSignatureDenominator: 4 }] } };
    });
    changeMusicXmlMeter.mockReturnValue({ source: '<score-partwise><broken/></score-partwise>',
      firstMeasure: 1, lastMeasure: 1 });
    changeMusicXmlPickup.mockReturnValue('<score-partwise><broken/></score-partwise>');
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Time signature…' }));
    const meter = screen.getByRole('dialog', { name: 'Time signature' });
    fireEvent.click(within(meter).getByRole('button', { name: 'Apply' }));
    expect(within(meter).getByText('The candidate cannot be loaded.')).toBeTruthy();
    fireEvent.click(within(meter).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pickup…' }));
    const pickup = screen.getByRole('dialog', { name: 'Pickup' });
    fireEvent.click(within(pickup).getByRole('button', { name: 'Apply' }));
    expect(within(pickup).getByText('The candidate cannot be loaded.')).toBeTruthy();
    fireEvent.click(within(pickup).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Selection measure' }), { target: { value: '2' } });
    expect(screen.getByRole('button', { name: 'Pickup…' }).hasAttribute('disabled')).toBe(true);
  });

  it('requires a pending fret to be applied before opening structural timing dialogs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '7' } });
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Time signature…' }));
    expect(screen.getByText('Apply the pending fret before changing the time signature.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pickup…' }));
    expect(screen.getByText('Apply the pending fret before changing the pickup.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
  });

  it('connects a pointer-chosen tie endpoint and removes it as separate undoable edits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    connectMusicXmlTie.mockReturnValue('<score-partwise><tie type="start"/></score-partwise>');
    removeMusicXmlTie.mockReturnValue('<score-partwise><removed-tie/></score-partwise>');
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{}, {}], tracks: [{ staves: [{ bars: [1, 2].map(id => ({
        voices: [{ beats: [{ notes: [{ id, string: 3, fret: 0 }] }] }],
      })) }] }] } }));
    inspectMusicXmlTie.mockImplementation((source: string) => ({ canRemove: source.includes('<tie type="start"') }));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Techniques', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tie', exact: true }));
    expect(screen.getByText(/Origin: measure 1, event 1, string 3, fret 0/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('choose-next-note'));
    expect(connectMusicXmlTie).toHaveBeenCalledWith('<score-partwise/>', expect.anything(),
      { measure: 0, beat: 0, voice: 1, string: 3, fret: 0 },
      { measure: 1, beat: 0, voice: 1, string: 3, fret: 0 });
    expect(screen.getByText('Tie added between the selected notes.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove tie' }));
    expect(removeMusicXmlTie).toHaveBeenCalledWith('<score-partwise><tie type="start"/></score-partwise>',
      expect.anything(), { measure: 1, beat: 0, voice: 1, string: 3, fret: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Remove tie' })).toBeTruthy();
  });

  it('keeps pending tie mode after an invalid endpoint and allows cancellation without history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{}, {}] } }));
    connectMusicXmlTie.mockImplementation(() => { throw new Error('Tie endpoints must have the same pitch.'); });
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Techniques', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tie', exact: true }));
    fireEvent.click(screen.getByTestId('choose-empty'));
    expect(screen.getByText('Tie destination must be a pitched note. Choose another note or cancel.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use selected note' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('choose-next-note'));
    expect(screen.getByText('Tie endpoints must have the same pitch.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel tie' }));
    expect(screen.getByText('Tie cancelled.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tie', exact: true }));
    expect(screen.getByText('Apply the pending fret before starting a tie.')).toBeTruthy();
  });

  it('updates the same record with a revision and keeps a newer edit unsaved while the request finishes', async () => {
    let finishSave!: (value: ReturnType<typeof response>) => void;
    const pendingSave = new Promise<ReturnType<typeof response>>(resolve => { finishSave = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{ id: 7, title: score.title }]))
      .mockResolvedValueOnce(response({ id: 7, title: score.title, score, source_text: null, revision: 2 }))
      .mockReturnValueOnce(pendingSave)
      .mockResolvedValueOnce(response({ id: 7, title: score.title, revision: 4 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('button', { name: score.title });
    fireEvent.click(screen.getByRole('button', { name: score.title }));
    await screen.findByText('Saved');
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/songs/7', expect.objectContaining({ method: 'PATCH' }));
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(1);
    const firstSave = JSON.parse(fetchMock.mock.lastCall![1].body);
    expect(firstSave.revision).toBe(2);
    expect(firstSave.score.measures[0].beats[0].notes[0].fret).toBe(4);
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    expect(screen.getAllByText('Saving…')).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(1);
    finishSave(response({ id: 7, title: score.title, revision: 3 }));
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    expect(JSON.parse(fetchMock.mock.lastCall![1].body).revision).toBe(3);
    expect(fetchMock.mock.calls.filter(call => call[0] === '/api/songs/7' && call[1]?.method === 'PATCH')).toHaveLength(2);
  });

  it('saves a titled copy under a new id and retries a failed update without losing the draft', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{ id: 7, title: score.title }]))
      .mockResolvedValueOnce(response({ id: 7, title: score.title, score, source_text: null, revision: 1 }))
      .mockResolvedValueOnce(response({ id: 8, title: 'Second tune', revision: 0 }))
      .mockResolvedValueOnce(response({ error: 'Cannot save right now.' }, false, 422))
      .mockResolvedValueOnce(response({ id: 8, title: 'Second tune', revision: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('button', { name: score.title });
    fireEvent.click(screen.getByRole('button', { name: score.title }));
    await screen.findByText('Saved');
    fireEvent.click(screen.getByText('More'));
    fireEvent.click(screen.getByRole('button', { name: 'Save a copy…' }));
    expect((screen.getByLabelText('Copy title') as HTMLInputElement).value).toContain('— copy');
    fireEvent.change(screen.getByLabelText('Copy title'), { target: { value: 'Second tune' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save copy' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Second tune' })).toBeTruthy());
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/songs', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByRole('button', { name: score.title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText('Could not save')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    expect(fetchMock).toHaveBeenLastCalledWith('/api/songs/8', expect.objectContaining({ method: 'PATCH' }));
  });

  it('retries a failed copy as a new record without updating the original', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{ id: 7, title: score.title }]))
      .mockResolvedValueOnce(response({ id: 7, title: score.title, score, source_text: null, revision: 1 }))
      .mockResolvedValueOnce(response({ error: 'Temporary failure.' }, false, 500))
      .mockResolvedValueOnce(response({ id: 8, title: 'Copy after retry', revision: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('button', { name: score.title });
    fireEvent.click(screen.getByRole('button', { name: score.title }));
    await screen.findByText('Saved');
    fireEvent.click(screen.getByText('More'));
    fireEvent.click(screen.getByRole('button', { name: 'Save a copy…' }));
    fireEvent.change(screen.getByLabelText('Copy title'), { target: { value: 'Copy after retry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save copy' }));
    await waitFor(() => expect(screen.getByText('Could not save')).toBeTruthy());
    expect(screen.getByRole('heading', { name: score.title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Copy after retry' })).toBeTruthy());
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(0);
  });

  it('guards navigation, preserves the draft on Cancel, and discards back to the saved document', async () => {
    const first = { id: 1, title: score.title, score, source_text: null, revision: 0 };
    const secondScore = { ...score, title: 'Second score' };
    const second = { id: 2, title: secondScore.title, score: secondScore, source_text: null, revision: 0 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{ id: 1, title: score.title }, { id: 2, title: secondScore.title }]))
      .mockResolvedValueOnce(response(first))
      .mockResolvedValueOnce(response(second))
      .mockResolvedValueOnce(response(second));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('button', { name: score.title });
    fireEvent.click(screen.getByRole('button', { name: score.title }));
    await screen.findByText('Saved');
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /My library/ }));
    fireEvent.click(screen.getByRole('button', { name: secondScore.title }));
    await screen.findByRole('dialog', { name: 'Unsaved changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: score.title })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: secondScore.title }));
    await screen.findByRole('dialog', { name: 'Unsaved changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Discard', exact: true }));
    await screen.findByRole('heading', { name: secondScore.title });
    expect(screen.getByText('Saved')).toBeTruthy();
    const afterUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterUnload);
    expect(afterUnload.defaultPrevented).toBe(false);
  });

  it('commits a pending fret before Save and continue and stays put when that save fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{ id: 1, title: score.title }]))
      .mockResolvedValueOnce(response({ id: 1, title: score.title, score, source_text: null, revision: 0 }))
      .mockResolvedValueOnce(response({ error: 'Temporary failure.' }, false, 500))
      .mockResolvedValueOnce(response({ id: 1, title: score.title, revision: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('button', { name: score.title });
    fireEvent.click(screen.getByRole('button', { name: score.title }));
    await screen.findByText('Saved');
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: '＋ New score' }));
    await screen.findByRole('dialog', { name: 'Unsaved changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(screen.getByText('Save failed. Your work is still here; retry or cancel.')).toBeTruthy());
    expect(screen.getByText('Fret 4')).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).score.measures[0].beats[0].notes[0].fret).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(screen.getByText('Not saved to library')).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull());
  });

  it('does not continue when a second edit lands during the guarded save', async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    const pendingSave = new Promise<ReturnType<typeof response>>(resolve => { finish = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{ id: 1, title: score.title }]))
      .mockResolvedValueOnce(response({ id: 1, title: score.title, score, source_text: null, revision: 0 }))
      .mockReturnValueOnce(pendingSave)
      .mockResolvedValueOnce(response({ id: 1, title: score.title, revision: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('button', { name: score.title });
    fireEvent.click(screen.getByRole('button', { name: score.title }));
    await screen.findByText('Saved');
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '＋ New score' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    finish(response({ id: 1, title: score.title, revision: 1 }));
    await waitFor(() => expect(screen.getByText('More changes were made while saving. Save and continue again.')).toBeTruthy());
    expect(screen.getByText('Fret 5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(screen.getByText('Not saved to library')).toBeTruthy());
    expect(JSON.parse(fetchMock.mock.lastCall![1].body).score.measures[0].beats[0].notes[0].fret).toBe(5);
  });

  it('keeps a conflicted draft and offers copy or confirmed reload of the newer revision', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{ id: 1, title: score.title }]))
      .mockResolvedValueOnce(response({ id: 1, title: score.title, score, source_text: null, revision: 1 }))
      .mockResolvedValueOnce(response({ error: 'Changed in another tab. Reopen the score before saving.' }, false, 409))
      .mockResolvedValueOnce(response({ id: 1, title: score.title, score: { ...score, tempo: 120 }, source_text: null, revision: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('button', { name: score.title });
    fireEvent.click(screen.getByRole('button', { name: score.title }));
    await screen.findByText('Saved');
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('dialog', { name: 'Score changed in another tab' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByText('Fret 4')).toBeTruthy();
    expect(screen.getByText('Changed in another tab')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve conflict…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved version…' }));
    await screen.findByRole('dialog', { name: 'Discard unsaved changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Fret 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve conflict…' }));
    await screen.findByRole('dialog', { name: 'Score changed in another tab' });
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved version…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    expect(fetchMock).toHaveBeenLastCalledWith('/api/songs/1', expect.anything());
  });

  it('discards an unsaved draft back to its opened version and leaves failed imports untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    openImport();
    selectFile('broken.json', '{}');
    await waitFor(() => expect(screen.getAllByRole('alert').some(node => node.textContent?.includes('Unsupported score version'))).toBe(true));
    expect(screen.getByText('Fret 4')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close import' }));
    fireEvent.click(screen.getByText('More'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved changes…' }));
    await screen.findByRole('dialog', { name: 'Discard unsaved changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Fret 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved changes…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.getByText('Not saved to library')).toBeTruthy());
    expect(screen.queryByText('Fret 4')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit score' })).toBeTruthy();
  });

  it('guards the home link and sign-out without sending a request after Cancel', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([]));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    fireEvent.click(screen.getByRole('link', { name: 'Playtab home' }));
    await screen.findByRole('dialog', { name: 'Unsaved changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('dialog', { name: 'Unsaved changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Fret 4')).toBeTruthy();
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
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported' })).toBeTruthy());
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
    await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('Request failed (500).'))).toBe(true));
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
    const imported = { ...preview, source: '<score-partwise version="4.0"><part/></score-partwise>', sourceIdByModelNoteId: new Map([[1, 'n1']]) };
    readMusicXml.mockReturnValue(imported);
    musicXmlEditorState.mockReturnValue({ notes: [{ index: 0, measure: 0, beat: 0, voice: 0, string: 3, fret: 0, technique: 'none', sourceIdentity: { id: 'n1', address: '0:1:0:main:main:3' } }] });
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

  it('rejects a rendered imported note without a unique source identity', async () => {
    const imported = { ...preview, source: '<score-partwise version="4.0"><part/></score-partwise>' };
    readMusicXml.mockReturnValue(imported);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', imported.source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    expect(screen.getByRole('alert').textContent).toContain('no unique source identity');
    expect(applyMusicXmlEdits).not.toHaveBeenCalled();
  });
});
