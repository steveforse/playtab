// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/frontend/App';
import { demo } from '../../app/frontend/music/score';
import { exportAscii } from '../../app/frontend/music/ascii';

const { readMusicXml, promoteNativeScore, musicXmlEditorState, applyMusicXmlEdits, addMusicXmlNote, addMusicXmlRepeat, addMusicXmlEndings, inspectMusicXmlRepeats, inspectMusicXmlRepeatEndings, removeMusicXmlRepeat, removeMusicXmlNotes, changeMusicXmlDuration, changeMusicXmlMeter, changeMusicXmlPickup, connectMusicXmlTie, inspectMusicXmlTie, removeMusicXmlTie, inspectMusicXmlDuration, inspectMusicXmlMeterRange, insertMusicXmlEvent, createMusicXmlTriplet, removeMusicXmlTriplet, inspectMusicXmlTriplet, insertMusicXmlMeasure, duplicateMusicXmlMeasure, deleteMusicXmlMeasure, sourceTabNoteRecords } = vi.hoisted(() => ({ readMusicXml: vi.fn(), promoteNativeScore: vi.fn(), musicXmlEditorState: vi.fn(), applyMusicXmlEdits: vi.fn(), addMusicXmlNote: vi.fn(), addMusicXmlRepeat: vi.fn(), addMusicXmlEndings: vi.fn(), inspectMusicXmlRepeats: vi.fn(() => []), inspectMusicXmlRepeatEndings: vi.fn(() => null), removeMusicXmlRepeat: vi.fn(), removeMusicXmlNotes: vi.fn(), changeMusicXmlDuration: vi.fn(), changeMusicXmlMeter: vi.fn(), changeMusicXmlPickup: vi.fn(), connectMusicXmlTie: vi.fn(), inspectMusicXmlTie: vi.fn(() => ({ canRemove: false })), removeMusicXmlTie: vi.fn(), inspectMusicXmlDuration: vi.fn(() => ({ denominator: 4, dots: 0, rest: false })), inspectMusicXmlMeterRange: vi.fn(() => ({ firstMeasure: 1, lastMeasure: 2 })), insertMusicXmlEvent: vi.fn(), createMusicXmlTriplet: vi.fn(), removeMusicXmlTriplet: vi.fn(), inspectMusicXmlTriplet: vi.fn(() => ({ triplet: false, canRemove: false })), insertMusicXmlMeasure: vi.fn(), duplicateMusicXmlMeasure: vi.fn(), deleteMusicXmlMeasure: vi.fn(), sourceTabNoteRecords: vi.fn(() => []) }));
const { createBlankMusicXml } = vi.hoisted(() => ({ createBlankMusicXml: vi.fn() }));
const { copyMusicXmlMeasures, pasteMusicXmlMeasures, cutMusicXmlMeasures } = vi.hoisted(() => ({ copyMusicXmlMeasures: vi.fn(), pasteMusicXmlMeasures: vi.fn(), cutMusicXmlMeasures: vi.fn() }));
const { connectMusicXmlTransition, inspectMusicXmlTransitions, removeMusicXmlTransition } = vi.hoisted(() => ({
  connectMusicXmlTransition: vi.fn(), inspectMusicXmlTransitions: vi.fn(() => []), removeMusicXmlTransition: vi.fn() }));
const { inspectMusicXmlScoreSettings, applyMusicXmlScoreSettings, inspectMusicXmlTempo, setMusicXmlLocalTempo } = vi.hoisted(() => ({
  inspectMusicXmlScoreSettings: vi.fn(), applyMusicXmlScoreSettings: vi.fn(), inspectMusicXmlTempo: vi.fn(), setMusicXmlLocalTempo: vi.fn() }));
const { inspectMusicXmlAnchor, changeMusicXmlAnchor, inspectMusicXmlLyrics, setMusicXmlLyric, setMusicXmlStandaloneLyrics } = vi.hoisted(() => ({
  inspectMusicXmlAnchor: vi.fn(), changeMusicXmlAnchor: vi.fn(), inspectMusicXmlLyrics: vi.fn(), setMusicXmlLyric: vi.fn(), setMusicXmlStandaloneLyrics: vi.fn() }));
const { inspectMusicXmlNoteTechniques, setMusicXmlBend, setMusicXmlHand } = vi.hoisted(() => ({
  inspectMusicXmlNoteTechniques: vi.fn(() => ({ picking: 'none', fretting: 'none', bend: 'none' })), setMusicXmlBend: vi.fn(), setMusicXmlHand: vi.fn() }));
const { applyMusicXmlGraceGroup, inspectMusicXmlGraceGroup, removeMusicXmlGraceGroup, removeMusicXmlGrace } = vi.hoisted(() => ({
  applyMusicXmlGraceGroup: vi.fn(), inspectMusicXmlGraceGroup: vi.fn(), removeMusicXmlGraceGroup: vi.fn(), removeMusicXmlGrace: vi.fn() }));
vi.mock('../../app/frontend/Player', () => ({
  Player: ({ onPreferencesChange, onSelectionChange, onPassageChange, onFretKey, onBeforeNavigate, selection, onSelectionDelete, editing, exportBlockedReason, onRenderResult, onContextMenu, controlsRef }: any) => <>
    {controlsRef && (controlsRef.current = { canPlay: true, playFrom: () => { (window as any).__played = 'from'; }, playSelection: () => { (window as any).__played = 'selection'; } }) && null}
    <button type="button" data-testid="context-event" onClick={() => onContextMenu?.({ x: 5, y: 5, scope: 'event' })}>Context event</button>
    <button type="button" data-testid="context-range" onClick={() => onContextMenu?.({ x: 5, y: 5, scope: 'range' })}>Context range</button>
    <button type="button" data-testid="choose-range" onClick={() => onPassageChange?.({
      start: { track: 1, staff: 1, measure: 1, event: 1, voice: 1, string: 3, fret: 0, kind: 'note', noteId: 1, graceIndex: null, graceGroupId: null },
      end: { track: 1, staff: 1, measure: 1, event: 2, voice: 1, string: 3, fret: 0, kind: 'note', noteId: 2, graceIndex: null, graceGroupId: null } })}>Choose range</button>
    {['1', '2', '3', '4', '5', '9', '0', 'Enter', 'Escape', 'Backspace', 'Tab'].map(key => <button key={key} type="button" data-testid={`key-${key}`} onClick={() => { if (!onFretKey?.(selection, key) && key === 'Backspace') onSelectionDelete?.(selection); }}>{`Key ${key}`}</button>)}
    <button type="button" data-testid="navigate" onClick={() => onBeforeNavigate?.()}>Navigate</button>
    <button type="button" data-testid="render-ok" onClick={() => onRenderResult?.({ ok: true })}>Rendered</button>
    <button type="button" data-testid="render-fail" onClick={() => onRenderResult?.({ ok: false, message: 'Layout failed.' })}>Render failed</button>
    <button type="button" data-testid="player" onClick={() => onPreferencesChange?.({ speed: 1.1 })}>Player</button>
    <span data-testid="export-blocked">{exportBlockedReason ?? ''}</span>
    {editing && <>
      <button type="button" data-testid="choose-note" onClick={() => onSelectionChange?.({ track: 1, staff: 1, measure: 1, event: 1, voice: 1, string: 3, fret: 0, kind: 'note', noteId: 1, graceIndex: null, graceGroupId: null })}>Choose note</button>
      <button type="button" data-testid="choose-grace" onClick={() => onSelectionChange?.({ track: 1, staff: 1, measure: 1, event: 1, voice: 1, string: 3, fret: 2, kind: 'note', noteId: 5, graceIndex: 0, graceGroupId: 'g1' })}>Choose grace</button>
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
  readMusicXml, promoteNativeScore, createBlankMusicXml, OPEN_G_TUNING: [62, 59, 55, 50, 67],
  toImportedScoreDocument: (preview: any, warnings: string[]) => ({
    version: 2, kind: 'musicxml', title: preview.score.title, sourceName: preview.filename,
    sourceFormat: preview.sourceFormat, source: preview.source, warnings,
  }),
}));
vi.mock('../../app/frontend/music/musicxml-editor', () => ({ musicXmlEditorState, applyMusicXmlEdits, addMusicXmlNote, copyMusicXmlMeasures, pasteMusicXmlMeasures, cutMusicXmlMeasures, inspectMusicXmlTransitions, removeMusicXmlTransition,
  connectMusicXmlTransition: (source: string, score: unknown, kind: string, origin: unknown, destination: unknown) =>
    kind === 'tie' ? connectMusicXmlTie(source, score, origin, destination) : connectMusicXmlTransition(source, score, kind, origin, destination),
  inspectMusicXmlScoreSettings, applyMusicXmlScoreSettings, inspectMusicXmlTempo, setMusicXmlLocalTempo,
  TEMPO_LIMITS: { min: 30, max: 240 }, TUNING_LIMITS: { min: 36, max: 96 }, CAPO_LIMIT: 12, defaultFifthCapo: (capo: number) => capo > 0 ? capo + 5 : null, inspectMusicXmlAnchor, changeMusicXmlAnchor, ANCHOR_TEXT_LIMIT: 160, LYRIC_VERSES: 8, STANDALONE_LYRICS_LIMIT: 20000,
  inspectMusicXmlLyrics, setMusicXmlLyric, setMusicXmlStandaloneLyrics,
  chordSpellingName: (chord: { step: string; alter: number; quality: string; bass: { step: string } | null }) => `${chord.step}${chord.alter === -1 ? '♭' : chord.alter === 1 ? '♯' : ''}${chord.quality === 'minor' ? 'm' : chord.quality === 'major' ? '' : chord.quality}${chord.bass ? `/${chord.bass.step}` : ''}`,
  inspectMusicXmlNoteTechniques, setMusicXmlBend, setMusicXmlHand, applyMusicXmlGraceGroup, inspectMusicXmlGraceGroup, removeMusicXmlGraceGroup, removeMusicXmlGrace, addMusicXmlRepeat, addMusicXmlEndings, inspectMusicXmlRepeats, inspectMusicXmlRepeatEndings, removeMusicXmlRepeat, removeMusicXmlNotes, changeMusicXmlDuration, changeMusicXmlMeter, changeMusicXmlPickup, connectMusicXmlTie, inspectMusicXmlTie, removeMusicXmlTie, inspectMusicXmlDuration, inspectMusicXmlMeterRange, insertMusicXmlEvent, createMusicXmlTriplet, removeMusicXmlTriplet, inspectMusicXmlTriplet, insertMusicXmlMeasure, duplicateMusicXmlMeasure, deleteMusicXmlMeasure, sourceTabNoteRecords }));

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
  afterEach(() => { createBlankMusicXml.mockReset(); copyMusicXmlMeasures.mockReset(); pasteMusicXmlMeasures.mockReset(); cutMusicXmlMeasures.mockReset(); connectMusicXmlTransition.mockReset(); removeMusicXmlTransition.mockReset(); inspectMusicXmlTransitions.mockReset(); inspectMusicXmlTransitions.mockReturnValue([]); inspectMusicXmlScoreSettings.mockReset(); applyMusicXmlScoreSettings.mockReset(); inspectMusicXmlTempo.mockReset(); setMusicXmlLocalTempo.mockReset(); inspectMusicXmlAnchor.mockReset(); changeMusicXmlAnchor.mockReset(); inspectMusicXmlLyrics.mockReset(); setMusicXmlLyric.mockReset(); setMusicXmlStandaloneLyrics.mockReset(); inspectMusicXmlNoteTechniques.mockReset(); inspectMusicXmlNoteTechniques.mockReturnValue({ picking: 'none', fretting: 'none', bend: 'none' }); setMusicXmlBend.mockReset(); setMusicXmlHand.mockReset(); applyMusicXmlGraceGroup.mockReset(); inspectMusicXmlGraceGroup.mockReset(); removeMusicXmlGraceGroup.mockReset(); removeMusicXmlGrace.mockReset(); });
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

  it('clears a partial range to rests and routes range clipboard shortcuts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([]));
    vi.stubGlobal('fetch', fetchMock);
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    const beat = () => ({ isRest: false, graceType: 0, notes: [{}] });
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{}], tracks: [{ staves: [{ bars: [{ voices: [{ beats: [beat(), beat()] }] }] }] }] } }));
    removeMusicXmlNotes.mockImplementation((source: string) => ({ source: `${source}<rest/>`, dependencies: ['hammer-on to m1 e3'] }));
    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByTestId('choose-range'));
    expect(screen.getAllByText('M1 E1 – M1 E2 selected')).toHaveLength(2);
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
    expect(screen.getByRole('alert').textContent).toContain('Select whole measures to copy');
    fireEvent.keyDown(document.body, { key: 'x', metaKey: true });
    expect(screen.getByRole('alert').textContent).toContain('Select whole measures to cut');
    fireEvent.click(screen.getByTestId('key-Backspace'));
    const dialog = screen.getByRole('dialog', { name: 'Clear range', hidden: true });
    expect(dialog.textContent).toContain('Clear M1 E1 – M1 E2?');
    expect(dialog.textContent).toContain('Also removes or disconnects: hammer-on to m1 e3');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear', hidden: true }));
    expect(screen.getByText('Cleared M1 E1 – M1 E2; it now holds rests.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('title')).toContain('Undo: Clear M1 E1 – M1 E2');
  });

  it('opens target-specific context menus that run shared commands', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByTestId('context-event'));
    const menu = screen.getByRole('menu', { name: 'Score actions' });
    expect(within(menu).getByRole('menuitem', { name: /Edit fret/ })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Play from here/ }));
    expect((window as any).__played).toBe('from');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByTestId('choose-range'));
    fireEvent.click(screen.getByTestId('context-range'));
    const range = screen.getByRole('menu', { name: 'Score actions' });
    expect(within(range).getByRole('menuitem', { name: /Copy passage/ }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(range).getByRole('menuitem', { name: /Play range/ }));
    expect((window as any).__played).toBe('selection');
    fireEvent.click(screen.getByTestId('choose-empty'));
    fireEvent.click(screen.getByTestId('context-event'));
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 0; });
    fireEvent.click(within(screen.getByRole('menu', { name: 'Score actions' })).getByRole('menuitem', { name: /Add a note/ }));
    expect(document.activeElement).toBe(screen.getByLabelText('Add fret'));
    frame.mockRestore();
    delete (window as any).__played;
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
    fireEvent.change(within(dialog).getByLabelText('Duration'), { target: { value: '8' } });
    fireEvent.click(within(dialog).getByLabelText('Dotted'));
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

  it('adds a grace chord with a supported display duration as one history step', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    inspectMusicXmlGraceGroup.mockReturnValue({ destination: 0, events: [], readOnly: [], connections: [] });
    applyMusicXmlGraceGroup.mockReturnValue('<score-partwise><grace/></score-partwise>');
    readMusicXml.mockImplementation((source: string, filename: string) => ({ ...preview, source, filename,
      score: { title: score.title, masterBars: [{}, {}], tracks: [{ staves: [{ bars: [{ voices: [{ beats: [{
        graceType: source.includes('<grace/>') ? 1 : 0, graceIndex: 0,
        notes: [{ string: 3, fret: source.includes('<grace/>') ? 2 : 0, id: 11 }],
      }] }] }] }] }] } }));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Techniques', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add grace…' }));
    const dialog = screen.getByRole('dialog', { name: 'Add grace group' });
    expect(within(dialog).queryByRole('button', { name: 'Remove grace group' })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Grace event 1 fret 1'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add string to grace event 1' }));
    fireEvent.change(within(dialog).getByLabelText('Grace event 1 string 2'), { target: { value: '4' } });
    fireEvent.change(within(dialog).getByLabelText('Grace event 1 transition 2'), { target: { value: 'hammer-on' } });
    fireEvent.change(within(dialog).getByLabelText('Grace event 1 display duration'), { target: { value: '8' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add grace event' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove grace event 2' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add string to grace event 1' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove grace event 1 string 3' }));
    expect(applyMusicXmlGraceGroup).toHaveBeenLastCalledWith('<score-partwise/>', expect.anything(), { measure: 0, beat: 0, voice: 0 },
      [{ denominator: 8, notes: [{ string: 3, fret: 2, transition: 'none' }, { string: 4, fret: 0, transition: 'hammer-on' }] }]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply grace group' }));
    expect(screen.getByText('Grace group added before the selected event.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    applyMusicXmlGraceGroup.mockImplementation(() => { throw new Error('Grace event 1, string 4: a hammer-on needs a higher fret.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Add grace…' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('needs a higher fret');
    expect(within(dialog).getByRole('button', { name: 'Apply grace group' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    applyMusicXmlGraceGroup.mockReturnValue('<score-partwise><grace/></score-partwise>');
    fireEvent.click(screen.getByRole('button', { name: 'Add grace…' }));
    readMusicXml.mockImplementationOnce(() => { throw new Error('Grace preview could not be rendered.'); });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply grace group' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('could not be rendered');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    inspectMusicXmlGraceGroup.mockImplementationOnce(() => { throw new Error('The paired grace group cannot be matched safely.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Add grace…' }));
    expect(screen.getByRole('alert').textContent).toContain('cannot be matched safely');
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add grace…' }));
    expect(screen.getByRole('alert').textContent).toContain('Apply the pending fret');
  });

  it('edits an existing grace group, and keeps a read-only one unless it is removed whole', async () => {
    const source = '<score-partwise version="4.0"><part/></score-partwise>';
    const grace = { notes: [{ string: 3, fret: 2, id: 5 }], playbackStart: 0, graceType: 1, graceIndex: 0, graceGroup: { id: 'g1' }, isRest: false };
    const main = { notes: [{ string: 3, fret: 0, id: 1 }], playbackStart: 0, graceType: 0, isRest: false };
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, score: {
      ...preview.score, tracks: [{ staves: [{ bars: [{ voices: [{ beats: value.includes('removed') ? [main] : [grace, main] }] }] }] }],
    } }));
    const existing = [{ denominator: null, notes: [{ string: 3, fret: 2, transition: 'pull-off' }] }];
    inspectMusicXmlGraceGroup.mockReturnValue({ destination: 1, events: existing, readOnly: [], connections: ['pull-off'] });
    applyMusicXmlGraceGroup.mockReturnValue('<score-partwise edited="true"/>');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Techniques', { selector: 'summary' }));
    fireEvent.click(screen.getByTestId('choose-grace'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit grace…' }));
    let dialog = screen.getByRole('dialog', { name: 'Edit grace group' });
    expect(dialog.textContent).toContain('Destination: measure 1, event 2');
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Grace event 1 display duration').value).toBe('');
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Grace event 1 transition 1').value).toBe('pull-off');
    fireEvent.change(within(dialog).getByLabelText('Grace event 1 fret 1'), { target: { value: '3' } });
    expect(applyMusicXmlGraceGroup).toHaveBeenLastCalledWith(source, expect.anything(), { measure: 0, beat: 1, voice: 0 },
      [{ denominator: null, notes: [{ string: 3, fret: 3, transition: 'pull-off' }] }]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply grace group' }));
    expect(screen.getByText('Grace group updated.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    inspectMusicXmlGraceGroup.mockReturnValue({ destination: 1, events: existing, connections: ['slide'],
      readOnly: ['Grace event 1, string 3 has the marking “TEF grace effect 5”.'] });
    removeMusicXmlGraceGroup.mockReturnValue({ source: '<score-partwise removed="true"/>', dependencies: ['slide'] });
    fireEvent.click(screen.getByRole('button', { name: 'Edit grace…' }));
    dialog = screen.getByRole('dialog', { name: 'Edit grace group' });
    expect(within(dialog).getByRole('note').textContent).toContain('TEF grace effect 5');
    expect(within(dialog).getByRole('note').textContent).toContain('disconnects its slide');
    expect(within(dialog).queryByRole('button', { name: 'Apply grace group' })).toBeNull();
    expect(within(dialog).queryByLabelText('Grace event 1 fret 1')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Edit grace…' }));
    removeMusicXmlGraceGroup.mockImplementationOnce(() => { throw new Error('The paired grace group cannot be matched safely.'); });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove grace group' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('cannot be matched safely');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove grace group' }));
    expect(removeMusicXmlGraceGroup).toHaveBeenLastCalledWith(source, expect.anything(), { measure: 0, beat: 1, voice: 0 });
    expect(screen.getByText('Grace group removed.')).toBeTruthy();
    expect(screen.getByText('Fret 0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add grace…' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
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
    createBlankMusicXml.mockReturnValue('<score-partwise blank="yes"/>');
    readMusicXml.mockReturnValue({ ...preview, source: '<score-partwise blank="yes"/>', score: { title: 'Untitled', masterBars: [{}], tracks: [{ staves: [{ bars: [{ voices: [{ beats: [] }] }] }] }] } });
    fireEvent.click(screen.getByRole('button', { name: '＋ New score' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create score' }));
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
    createBlankMusicXml.mockReturnValue('<score-partwise blank="yes"/>');
    readMusicXml.mockReturnValue({ ...preview, source: '<score-partwise blank="yes"/>', score: { title: 'Untitled', masterBars: [{}], tracks: [{ staves: [{ bars: [{ voices: [{ beats: [] }] }] }] }] } });
    fireEvent.click(screen.getByRole('button', { name: '＋ New score' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create score' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
    openImport();
    selectFile('broken.json', '{}');
    await waitFor(() => expect(screen.getAllByRole('alert').some(node => node.textContent?.includes('Unsupported score version'))).toBe(true));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close import' }));
    fireEvent.click(screen.getByText('More'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved changes…' }));
    await screen.findByRole('dialog', { name: 'Discard unsaved changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved changes…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.getByText('Not saved to library')).toBeTruthy());
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
    fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
    fireEvent.click(screen.getByRole('link', { name: 'Playtab home' }));
    await screen.findByRole('dialog', { name: 'Unsaved changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('dialog', { name: 'Unsaved changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
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

  it('removes a grace event after span confirmation and a grace string directly, each as one Undo step', async () => {
    const source = '<score-partwise version="4.0"><part/></score-partwise>';
    const grace = { notes: [{ string: 3, fret: 2, id: 5 }], playbackStart: 0, graceType: 1, graceIndex: 0, graceGroup: { id: 'g1' }, isRest: false };
    const main = { notes: [{ string: 3, fret: 0, id: 1 }], playbackStart: 0, graceType: 0, isRest: false };
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, score: {
      ...preview.score, tracks: [{ staves: [{ bars: [{ voices: [{ beats: value.includes('removed') ? [main] : [grace, main] }] }] }] }],
    } }));
    removeMusicXmlGrace.mockReturnValue({ source: '<score-partwise removed="true"/>', dependencies: ['slide'], groupRemoved: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-grace'));
    expect(screen.queryByRole('button', { name: 'Make rest' })).toBeNull();
    fireEvent.click(screen.getByText('Techniques', { selector: 'summary' }));
    expect(screen.getByRole('button', { name: 'Edit grace…' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove grace' }));
    expect(removeMusicXmlGrace).toHaveBeenLastCalledWith(source, expect.anything(), { measure: 0, beat: 0, voice: 0, string: undefined });
    const dialog = screen.getByRole('dialog', { name: 'Confirm note removal' });
    expect(dialog.textContent).toContain('slide');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove grace' }));
    expect(screen.getByText('Grace event removed.')).toBeTruthy();
    expect(screen.getByText('Fret 0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Fret 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    removeMusicXmlGrace.mockReturnValue({ source: '<score-partwise removed="true"/>', dependencies: [], groupRemoved: false });
    fireEvent.click(screen.getByRole('button', { name: 'Remove note' }));
    expect(removeMusicXmlGrace).toHaveBeenLastCalledWith(source, expect.anything(), { measure: 0, beat: 0, voice: 0, string: 3 });
    expect(screen.getByText('Grace note removed.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    removeMusicXmlGrace.mockImplementation(() => { throw new Error('This grace note has a protected notehead attachment.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Remove grace' }));
    expect(screen.getByRole('alert').textContent).toContain('protected notehead');
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
  });

  it('changes each hand independently and applies, replaces or removes a bend as single history steps', async () => {
    const source = '<score-partwise version="4.0"><part/></score-partwise>';
    const beat = { notes: [{ string: 3, fret: 0, id: 1 }], playbackStart: 0, graceType: 0, isRest: false };
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, score: {
      ...preview.score, tracks: [{ staves: [{ bars: [{ voices: [{ beats: [beat] }] }] }] }] } }));
    inspectMusicXmlNoteTechniques.mockReturnValue({ picking: 'T', fretting: '1', bend: 'none' });
    setMusicXmlHand.mockImplementation((_source: string, _score: unknown, _position: unknown, hand: string, value: string) => `<score-partwise ${hand}="${value}"/>`);
    setMusicXmlBend.mockImplementation((_source: string, _score: unknown, _position: unknown, bend: { amount: number } | null) => `<score-partwise bend="${bend?.amount ?? 'none'}"/>`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Techniques', { selector: 'summary' }));
    expect(screen.getByLabelText<HTMLSelectElement>('Picking hand').value).toBe('T');
    expect(screen.getByLabelText<HTMLSelectElement>('Fretting hand').value).toBe('1');
    fireEvent.change(screen.getByLabelText('Picking hand'), { target: { value: 'I' } });
    expect(setMusicXmlHand).toHaveBeenLastCalledWith(source, expect.anything(), { measure: 0, beat: 0, voice: 1, string: 3, fret: 0 }, 'picking', 'I');
    expect(screen.getByText('Picking hand set to I.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Fretting hand'), { target: { value: 'T' } });
    expect(screen.getByText('Fretting hand set to Thumb.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Bend…' }));
    let dialog = screen.getByRole('dialog', { name: 'Bend' });
    expect(within(dialog).queryByRole('button', { name: 'Remove bend' })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '3' } });
    fireEvent.change(within(dialog).getByLabelText('Shape'), { target: { value: 'release' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply bend' }));
    expect(setMusicXmlBend).toHaveBeenLastCalledWith(source, expect.anything(), { measure: 0, beat: 0, voice: 1, string: 3, fret: 0 }, { amount: 3, shape: 'release' });
    expect(screen.getByText('Bend and release 1½ steps applied.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    inspectMusicXmlNoteTechniques.mockReturnValue({ picking: null, pickingReason: 'This note has more than one picking-hand marking; it is kept as written.',
      fretting: '1', bend: null, bendReason: 'This imported bend (a release-only bend curve) is kept as written. Applying a bend here replaces it.' });
    fireEvent.click(screen.getByTestId('choose-note'));
    expect(screen.getByLabelText<HTMLSelectElement>('Picking hand').disabled).toBe(true);
    expect(screen.getByText('This note has more than one picking-hand marking; it is kept as written.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bend…' }));
    dialog = screen.getByRole('dialog', { name: 'Bend' });
    expect(within(dialog).getByRole('note').textContent).toContain('release-only bend curve');
    expect(within(dialog).getByRole('button', { name: 'Replace bend' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Bend…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove bend' }));
    expect(setMusicXmlBend).toHaveBeenLastCalledWith(source, expect.anything(), expect.anything(), null);
    expect(screen.getByText('Bend removed.')).toBeTruthy();

    setMusicXmlHand.mockImplementation(() => { throw new Error('The fretting-hand marking “5” is kept as written.'); });
    fireEvent.change(screen.getByLabelText('Fretting hand'), { target: { value: '2' } });
    expect(screen.getByRole('alert').textContent).toContain('kept as written');
    inspectMusicXmlNoteTechniques.mockImplementation(() => { throw new Error('The selected note cannot be uniquely identified in the source.'); });
    fireEvent.click(screen.getByTestId('choose-note'));
    expect(screen.getByLabelText<HTMLSelectElement>('Fretting hand').disabled).toBe(true);
    expect(screen.getAllByText('The selected note cannot be uniquely identified in the source.').length).toBeGreaterThan(0);
  });

  it('promotes a native score before its first hand annotation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    promoteNativeScore.mockReturnValue('<score-partwise/>');
    readMusicXml.mockImplementation((value: string, filename: string) => ({ ...preview, source: value, filename, score: { title: score.title, masterBars: [{}],
      tracks: [{ staves: [{ bars: [{ voices: [{ beats: [{ graceType: 0, notes: [{ string: 3, fret: 0, id: 11 }] }] }] }] }] }] } }));
    setMusicXmlHand.mockReturnValue('<score-partwise fretting="2"/>');
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Techniques', { selector: 'summary' }));
    expect(screen.getByLabelText<HTMLSelectElement>('Fretting hand').value).toBe('none');
    fireEvent.change(screen.getByLabelText('Fretting hand'), { target: { value: '2' } });
    expect(setMusicXmlHand).toHaveBeenLastCalledWith('<score-partwise/>', expect.anything(), expect.anything(), 'fretting', '2');
    expect(screen.getByText('Fretting hand set to 2.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bend…' }));
    expect(screen.getByRole('alert').textContent).toContain('Apply the pending fret');
    fireEvent.change(screen.getByLabelText('Fretting hand'), { target: { value: '3' } });
    expect(screen.getByRole('alert').textContent).toContain('Apply the pending fret');
  });

  it('adds, edits and removes anchored chords, sections and annotations as single history steps', async () => {
    const source = '<score-partwise version="4.0"><part/></score-partwise>';
    const beat = { notes: [{ string: 3, fret: 0, id: 1 }], playbackStart: 0, graceType: 0, isRest: false };
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, score: {
      ...preview.score, tracks: [{ staves: [{ bars: [{ voices: [{ beats: [beat] }] }] }] }] } }));
    inspectMusicXmlAnchor.mockReturnValue({ chords: [], words: [{ text: 'Section A' }, { text: 'Play softly' }], sections: [] });
    changeMusicXmlAnchor.mockImplementation((_source: string, _score: unknown, _position: unknown, kind: string, index: number | null) => `<score-partwise ${kind}="${index}"/>`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Text', { selector: 'summary' }));

    fireEvent.click(screen.getByRole('button', { name: 'Chord name…' }));
    let dialog = screen.getByRole('dialog', { name: 'Chord name' });
    expect(within(dialog).queryByLabelText('Existing item')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Remove chord' })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Root'), { target: { value: 'B' } });
    fireEvent.change(within(dialog).getByLabelText('Root accidental'), { target: { value: '-1' } });
    fireEvent.change(within(dialog).getByLabelText('Quality'), { target: { value: 'minor' } });
    fireEvent.change(within(dialog).getByLabelText('Bass'), { target: { value: 'F' } });
    fireEvent.change(within(dialog).getByLabelText('Bass accidental'), { target: { value: '1' } });
    expect(dialog.textContent).toContain('Shows as B♭m/F');
    fireEvent.change(within(dialog).getByLabelText('Bass'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(changeMusicXmlAnchor).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Chord name…' }));
    fireEvent.change(within(dialog).getByLabelText('Quality'), { target: { value: 'minor' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply chord' }));
    expect(changeMusicXmlAnchor).toHaveBeenLastCalledWith(source, expect.anything(), { measure: 0, beat: 0, voice: 0 }, 'chord', null,
      { step: 'C', alter: 0, quality: 'minor', bass: null });
    expect(screen.getByText('Chord “Cm” added at measure 1, event 1.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    fireEvent.click(screen.getByRole('button', { name: 'Annotation…' }));
    dialog = screen.getByRole('dialog', { name: 'Annotation' });
    expect(within(dialog).getByLabelText<HTMLInputElement>('Text').value).toBe('Section A');
    fireEvent.change(within(dialog).getByLabelText('Existing item'), { target: { value: '1' } });
    fireEvent.change(within(dialog).getByLabelText('Text'), { target: { value: 'Play loudly' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply annotation' }));
    expect(changeMusicXmlAnchor).toHaveBeenLastCalledWith(source, expect.anything(), expect.anything(), 'words', 1, 'Play loudly');
    expect(screen.getByText('Annotation “Play loudly” updated at measure 1, event 1.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annotation…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove annotation' }));
    expect(changeMusicXmlAnchor).toHaveBeenLastCalledWith(source, expect.anything(), expect.anything(), 'words', 0, null);
    expect(screen.getByText('Annotation “Section A” removed from measure 1, event 1.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annotation…' }));
    fireEvent.change(within(dialog).getByLabelText('Existing item'), { target: { value: 'new' } });
    expect(within(dialog).getByRole('button', { name: 'Apply annotation' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Text'), { target: { value: 'Swing' } });
    changeMusicXmlAnchor.mockImplementationOnce(() => { throw new Error('Text must be 1–160 characters.'); });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply annotation' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('1–160');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    inspectMusicXmlAnchor.mockReturnValue({ chords: [{ text: 'C♭m7b5', reason: 'The imported chord “C♭m7b5” … kept until you replace it.' }], words: [], sections: [{ text: 'Verse' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Chord name…' }));
    dialog = screen.getByRole('dialog', { name: 'Chord name' });
    expect(within(dialog).getByRole('note').textContent).toContain('kept until you replace it');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace chord' }));
    expect(changeMusicXmlAnchor).toHaveBeenLastCalledWith(source, expect.anything(), expect.anything(), 'chord', 0, { step: 'C', alter: 0, quality: 'major', bass: null });
    fireEvent.click(screen.getByRole('button', { name: 'Section label…' }));
    dialog = screen.getByRole('dialog', { name: 'Section label' });
    expect(dialog.textContent).toContain('Anchored at the start of measure 1.');
    fireEvent.change(within(dialog).getByLabelText('Text'), { target: { value: 'Chorus' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply section' }));
    expect(screen.getByText('Section “Chorus” updated at measure 1.')).toBeTruthy();
    inspectMusicXmlAnchor.mockImplementationOnce(() => { throw new Error('Select an ordinary event to anchor text to it.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Annotation…' }));
    expect(screen.getByRole('alert').textContent).toContain('Select an ordinary event');
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annotation…' }));
    expect(screen.getByRole('alert').textContent).toContain('Apply the pending fret');
  });

  it('edits one lyric verse and the standalone Lyrics & chords text as separate single history steps', async () => {
    const source = '<score-partwise version="4.0"><part/></score-partwise>';
    const beat = { notes: [{ string: 3, fret: 0, id: 1 }], playbackStart: 0, graceType: 0, isRest: false };
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, lyricsSection: value.includes('standalone') ? 'VERSE\nNew words' : preview.lyricsSection,
      score: { ...preview.score, tracks: [{ staves: [{ bars: [{ voices: [{ beats: [beat] }] }] }] }] } }));
    inspectMusicXmlLyrics.mockReturnValue([{ verse: 1, text: 'Low', syllabic: 'single' },
      { verse: 2, text: 'High', syllabic: 'begin', reason: 'Verse 2 has an extension line; it is kept as written.' },
      { verse: 0, text: 'x', syllabic: 'single', reason: 'The lyric verse “chorus” is kept as written.' }]);
    setMusicXmlLyric.mockImplementation((_source: string, _score: unknown, _position: unknown, verse: number) => `<score-partwise verse="${verse}"/>`);
    setMusicXmlStandaloneLyrics.mockImplementation((_source: string, value: string) => value === preview.lyricsSection ? _source : `<score-partwise standalone="${value.length}"/>`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Text', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lyric syllable…' }));
    const dialog = screen.getByRole('dialog', { name: 'Lyric syllable' });
    expect(within(dialog).getByLabelText<HTMLInputElement>('Lyric text').value).toBe('Low');
    expect(within(dialog).getByText('The lyric verse “chorus” is kept as written.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Lyric text'), { target: { value: '' } });
    expect(within(dialog).getByText('To clear verse 1, use Remove lyric.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Apply lyric' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Verse'), { target: { value: '2' } });
    expect(within(dialog).getByText('Verse 2 has an extension line; it is kept as written.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Apply lyric' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Verse'), { target: { value: '3' } });
    expect(within(dialog).queryByRole('button', { name: 'Remove lyric' })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Lyric text'), { target: { value: 'ship' } });
    fireEvent.change(within(dialog).getByLabelText('Syllabic'), { target: { value: 'end' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Lyric syllable…' }));
    fireEvent.change(within(dialog).getByLabelText('Verse'), { target: { value: '3' } });
    fireEvent.change(within(dialog).getByLabelText('Lyric text'), { target: { value: 'ship' } });
    fireEvent.change(within(dialog).getByLabelText('Syllabic'), { target: { value: 'end' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply lyric' }));
    expect(setMusicXmlLyric).toHaveBeenLastCalledWith(source, expect.anything(), { measure: 0, beat: 0, voice: 0 }, 3, { text: 'ship', syllabic: 'end' });
    expect(screen.getByText('Verse 3 lyric “ship” applied at measure 1, event 1.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lyric syllable…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove lyric' }));
    expect(setMusicXmlLyric).toHaveBeenLastCalledWith(source, expect.anything(), expect.anything(), 1, null);
    expect(screen.getByText('Verse 1 lyric removed from measure 1, event 1.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    setMusicXmlLyric.mockImplementationOnce(() => { throw new Error('Lyric text must be 1–160 characters.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Lyric syllable…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply lyric' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('1–160');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Lyrics & chords…' }));
    const standalone = screen.getByRole('dialog', { name: 'Lyrics and chords text' });
    const area = within(standalone).getByLabelText<HTMLTextAreaElement>('Lyrics and chords text');
    expect(area.value).toBe(preview.lyricsSection);
    fireEvent.click(within(standalone).getByRole('button', { name: 'Apply text' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Lyrics & chords…' }));
    fireEvent.change(area, { target: { value: 'VERSE\nNew words' } });
    expect(within(standalone).getByText('15 / 20,000 characters')).toBeTruthy();
    fireEvent.click(within(standalone).getByRole('button', { name: 'Apply text' }));
    expect(screen.getByText('Lyrics & chords text updated.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lyrics & chords…' }));
    fireEvent.change(area, { target: { value: '' } });
    fireEvent.click(within(standalone).getByRole('button', { name: 'Apply text' }));
    expect(screen.getByText('Lyrics & chords text removed.')).toBeTruthy();
    setMusicXmlStandaloneLyrics.mockImplementationOnce(() => { throw new Error('Lyrics & chords text is limited to 20,000 characters.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Lyrics & chords…' }));
    fireEvent.click(within(standalone).getByRole('button', { name: 'Apply text' }));
    expect(within(standalone).getByRole('alert').textContent).toContain('20,000');
    fireEvent.click(within(standalone).getByRole('button', { name: 'Cancel' }));
    inspectMusicXmlLyrics.mockImplementationOnce(() => { throw new Error('Select an ordinary event to edit its lyric.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Lyric syllable…' }));
    expect(screen.getByRole('alert').textContent).toContain('Select an ordinary event');
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lyrics & chords…' }));
    expect(screen.getByRole('alert').textContent).toContain('Apply the pending fret');
    fireEvent.click(screen.getByRole('button', { name: 'Lyric syllable…' }));
    expect(screen.getByRole('alert').textContent).toContain('Apply the pending fret');
  });

  it('applies title, opening tempo and tuning together and undoes them together', async () => {
    const source = '<score-partwise version="4.0"><part/></score-partwise>';
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, score: { ...preview.score, title: 'Imported tune',
      tracks: [{ staves: [{ bars: [{ voices: [{ beats: [{ notes: [{ string: 3, fret: 0, id: 1 }], playbackStart: 0, graceType: 0, isRest: false }] }] }] }] }] } }));
    inspectMusicXmlScoreSettings.mockReturnValue({ title: 'Imported tune', tempo: 96, tuning: [62, 59, 55, 50, 67], tuningRange: { first: 1, last: 2 },
      capo: 0, fifthCapo: null, subtitle: '', composer: '', arranger: '', keyFifths: 0, feel: 'straight' });
    applyMusicXmlScoreSettings.mockImplementation((_source: string, _score: unknown, settings: { tempo: number }) => {
      if (settings.tempo < 30) throw new Error('Opening tempo must be a whole number from 30 to 240 BPM.');
      return { source: `<score-partwise tempo="${settings.tempo}"/>`, tuningRange: { first: 1, last: 2 } };
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('player'));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Score settings…' }));
    const dialog = screen.getByRole('dialog', { name: 'Score settings' });
    expect(within(dialog).getByLabelText<HTMLInputElement>('Title').value).toBe('Imported tune');
    expect(within(dialog).getByLabelText<HTMLInputElement>('Opening tempo').value).toBe('96');
    expect(within(dialog).getByLabelText<HTMLSelectElement>('String 5 note').selectedOptions[0].textContent).toBe('G4');
    expect(dialog.textContent).toContain('A tuning change would apply to measures 1–2.');
    fireEvent.change(within(dialog).getByLabelText('Opening tempo'), { target: { value: '29' } });
    expect(within(dialog).getByRole('alert').textContent).toContain('30 to 240 BPM');
    expect(within(dialog).getByRole('button', { name: 'Apply settings' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Opening tempo'), { target: { value: '120' } });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: '  New name ' } });
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Tuning preset').value).toBe('Open G');
    fireEvent.change(within(dialog).getByLabelText('String 4 note'), { target: { value: '49' } });
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Tuning preset').value).toBe('');
    expect(dialog.textContent).toContain('Custom — gC#GBD');
    fireEvent.change(within(dialog).getByLabelText('String 4 note'), { target: { value: '48' } });
    expect(within(dialog).getByLabelText<HTMLSelectElement>('String 4 note').selectedOptions[0].textContent).toBe('C3');
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Tuning preset').value).toBe('Standard C');
    fireEvent.change(within(dialog).getByLabelText('Tuning preset'), { target: { value: 'Double C' } });
    expect(within(dialog).getByLabelText<HTMLSelectElement>('String 2 note').selectedOptions[0].textContent).toBe('C4');
    fireEvent.change(within(dialog).getByLabelText('Tuning preset'), { target: { value: 'Standard C' } });
    fireEvent.change(within(dialog).getByLabelText('Capo'), { target: { value: '2' } });
    expect(within(dialog).getByLabelText<HTMLSelectElement>('5th-string capo').value).toBe('7');
    fireEvent.change(within(dialog).getByLabelText('5th-string capo'), { target: { value: '' } });
    fireEvent.change(within(dialog).getByLabelText('Feel'), { target: { value: 'swing' } });
    fireEvent.change(within(dialog).getByLabelText('Key signature'), { target: { value: '1' } });
    fireEvent.change(within(dialog).getByLabelText('Composer'), { target: { value: 'Traditional' } });
    fireEvent.click(within(dialog).getByLabelText('Keep pitches (frets change)'));
    expect(dialog.textContent).toContain('Tuning applies to measures 1–2.');
    expect(applyMusicXmlScoreSettings).toHaveBeenLastCalledWith(source, expect.anything(), { title: '  New name ', tempo: 120, tuning: [62, 59, 55, 48, 67], mode: 'pitches',
      subtitle: '', composer: 'Traditional', arranger: '', feel: 'swing', keyFifths: 1, capo: 2, fifthCapo: null });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply settings' }));
    expect(screen.getByText('Score settings applied. Tuning changed for measures 1–2. Capo at fret 2.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'New name' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Score settings…' }));
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Other' } });
    readMusicXml.mockImplementationOnce(() => { throw new Error('Settings preview could not be rendered.'); });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply settings' }));
    expect(within(dialog).getAllByRole('alert').at(-1)!.textContent).toContain('could not be rendered');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Score settings…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply settings' }));
    expect(screen.getByText('Score settings applied.')).toBeTruthy();
    inspectMusicXmlScoreSettings.mockImplementationOnce(() => { throw new Error('This score has no part to configure.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Score settings…' }));
    expect(screen.getByRole('alert').textContent).toContain('no part to configure');
  });

  it('sets and removes a local tempo, and points the first event at Score settings', async () => {
    const source = '<score-partwise version="4.0"><part/></score-partwise>';
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, score: { ...preview.score,
      tracks: [{ staves: [{ bars: [{ voices: [{ beats: [{ notes: [{ string: 3, fret: 0, id: 1 }], playbackStart: 0, graceType: 0, isRest: false }] }] }] }] }] } }));
    inspectMusicXmlTempo.mockReturnValue({ local: null, inherited: 108, opening: false });
    setMusicXmlLocalTempo.mockImplementation((_source: string, _score: unknown, _position: unknown, tempo: number | null) => `<score-partwise local="${tempo}"/>`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByRole('button', { name: 'Set tempo here…' }));
    const dialog = screen.getByRole('dialog', { name: 'Set tempo here' });
    expect(dialog.textContent).toContain('108 BPM continues here from earlier in the score.');
    expect(within(dialog).queryByRole('button', { name: 'Remove local tempo' })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Tempo'), { target: { value: '80' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply tempo' }));
    expect(setMusicXmlLocalTempo).toHaveBeenLastCalledWith(source, expect.anything(), { measure: 0, beat: 0, voice: 0 }, 80);
    expect(screen.getByText('Tempo 80 BPM set at measure 1, event 1.')).toBeTruthy();
    inspectMusicXmlTempo.mockReturnValue({ local: 80, inherited: 108, opening: false });
    fireEvent.click(screen.getByRole('button', { name: 'Set tempo here…' }));
    expect(dialog.textContent).toContain('A local tempo of 80 BPM starts here; without it, 108 BPM continues.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove local tempo' }));
    expect(screen.getByText('Local tempo removed at measure 1, event 1; 108 BPM continues.')).toBeTruthy();
    setMusicXmlLocalTempo.mockImplementationOnce(() => { throw new Error('Tempo must be a whole number from 30 to 240 BPM.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Set tempo here…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply tempo' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('30 to 240');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    inspectMusicXmlTempo.mockReturnValue({ local: 96, inherited: 120, opening: true });
    fireEvent.click(screen.getByRole('button', { name: 'Set tempo here…' }));
    expect(dialog.textContent).toContain('The first event uses the opening tempo (96 BPM). Change it in Score settings.');
    expect(within(dialog).queryByRole('button', { name: 'Apply tempo' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    inspectMusicXmlTempo.mockImplementationOnce(() => { throw new Error('Select an ordinary event to anchor text to it.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Set tempo here…' }));
    expect(screen.getByRole('alert').textContent).toContain('Select an ordinary event');
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set tempo here…' }));
    expect(screen.getByRole('alert').textContent).toContain('Apply the pending fret');
    fireEvent.click(screen.getByRole('button', { name: 'Score settings…' }));
    expect(screen.getByRole('alert').textContent).toContain('Apply the pending fret');
  });

  it('authors hammer-ons, pull-offs and slides by pointer or keyboard and removes a named span', async () => {
    const source = '<score-partwise version="4.0"><part/></score-partwise>';
    const beats = [{ notes: [{ string: 3, fret: 0, id: 1 }], playbackStart: 0, graceType: 0, isRest: false }];
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, score: { ...preview.score, masterBars: [{}, {}],
      tracks: [{ staves: [{ bars: [{ voices: [{ beats }] }, { voices: [{ beats }] }] }] }] } }));
    connectMusicXmlTransition.mockImplementation((_source: string, _score: unknown, kind: string) => `<score-partwise ${kind}="yes"/>`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Techniques', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hammer-on' }));
    expect(screen.getByText(/Hammer-on origin: measure 1, event 1, string 3, fret 0/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pull-off' }).hasAttribute('disabled')).toBe(true);
    connectMusicXmlTransition.mockImplementationOnce(() => { throw new Error('A hammer-on must go to a higher fret.'); });
    fireEvent.click(screen.getByTestId('choose-next-note'));
    expect(screen.getByRole('alert').textContent).toContain('higher fret');
    expect(screen.getByRole('button', { name: 'Cancel hammer-on' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('choose-next-note'));
    expect(connectMusicXmlTransition).toHaveBeenLastCalledWith(source, expect.anything(), 'hammer-on',
      expect.objectContaining({ measure: 0, beat: 0, string: 3 }), expect.objectContaining({ measure: 1, beat: 0, string: 3 }));
    expect(screen.getByText('Hammer-on added between the selected notes.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByRole('button', { name: 'Slide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel slide' }));
    expect(screen.getByText('Slide cancelled.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Pull-off' }));
    fireEvent.change(screen.getByLabelText('Selection measure'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use selected note' }));
    expect(connectMusicXmlTransition).toHaveBeenLastCalledWith(source, expect.anything(), 'pull-off', expect.anything(), expect.objectContaining({ measure: 1 }));
    expect(screen.getByText('Pull-off added between the selected notes.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    inspectMusicXmlTransitions.mockReturnValue([{ kind: 'pull-off', direction: 'outgoing', other: { measure: 2, event: 1, fret: 0 } },
      { kind: 'slide', direction: 'incoming', other: null }]);
    removeMusicXmlTransition.mockReturnValue('<score-partwise removed="yes"/>');
    fireEvent.click(screen.getByTestId('choose-note'));
    expect(screen.getByRole('button', { name: 'Remove slide from its other note' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove pull-off to m2 e1' }));
    expect(removeMusicXmlTransition).toHaveBeenLastCalledWith(source, expect.anything(), expect.anything(), 'pull-off', 'outgoing');
    expect(screen.getByText('Pull-off removed.')).toBeTruthy();
    removeMusicXmlTransition.mockImplementationOnce(() => { throw new Error('The other slide endpoint cannot be identified safely.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Remove slide from its other note' }));
    expect(screen.getByRole('alert').textContent).toContain('cannot be identified safely');
    fireEvent.click(screen.getByRole('button', { name: 'Hammer-on' }));
    expect(screen.getByRole('alert').textContent).toContain('already starts a tie or transition');
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove pull-off to m2 e1' }));
    expect(screen.getByRole('alert').textContent).toContain('Apply the pending fret before removing a pull-off');
  });

  it('copies whole measures without history and pastes them as one undoable insertion', async () => {
    const source = '<score-partwise version="4.0"><part/></score-partwise>';
    const beats = [{ notes: [{ string: 3, fret: 0, id: 1 }], playbackStart: 0, graceType: 0, isRest: false },
      { notes: [{ string: 3, fret: 2, id: 2 }], playbackStart: 960, graceType: 0, isRest: false }];
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, score: { ...preview.score, masterBars: [{}, {}],
      tracks: [{ staves: [{ bars: [{ voices: [{ beats }] }, { voices: [{ beats }] }] }] }] } }));
    copyMusicXmlMeasures.mockReturnValue({ title: 'ignored', measures: ['<measure/>'], meters: ['4/4'], staves: [1], tabStaff: 1, tuning: [62, 59, 55, 50, 67],
      excluded: ['a tie that crosses the passage edge'] });
    pasteMusicXmlMeasures.mockImplementation((_source: string, _score: unknown, _clip: unknown, _measure: number, _mode: string, pitch: string) => `<score-partwise pasted="${pitch}"/>`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Select passage', { selector: 'summary' }));
    expect(screen.getByRole('button', { name: 'Paste passage…' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Set range start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set range end' }));
    expect(screen.getByRole('button', { name: 'Copy passage' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Copy passage' }).getAttribute('title')).toBe('Copy passage — Select whole measures first');
    expect(copyMusicXmlMeasures).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select measure' }));
    expect(screen.getByText('Measure 1 selected as a passage.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy passage' }));
    expect(copyMusicXmlMeasures).toHaveBeenLastCalledWith(source, expect.anything(), 0, 0);
    expect(screen.getByText('Copied 1 measure (1).')).toBeTruthy();
    expect(screen.getByText('Clipboard: 1 measure from “Imported tune”.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Paste passage…' }));
    const dialog = screen.getByRole('dialog', { name: 'Paste passage' });
    expect(dialog.textContent).toContain('Destination: before measure 1. Source: 1 measure from “Imported tune” (4/4). The score will grow by 1 measure.');
    expect(within(dialog).getByRole('note').textContent).toContain('Not pasted: a tie that crosses the passage edge.');
    fireEvent.click(within(dialog).getByLabelText('Keep pitches (frets change)'));
    expect(pasteMusicXmlMeasures).toHaveBeenLastCalledWith(source, expect.anything(), expect.objectContaining({ title: 'Imported tune' }), 0, 'insert', 'pitches');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Paste passage…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Paste' }));
    expect(screen.getByText('Pasted 1 measure before measure 1; they are now measures 1–1.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    pasteMusicXmlMeasures.mockImplementation(() => { throw new Error('The copied measures use staves 1, 2 with tablature on staff 2.'); });
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByRole('button', { name: 'Paste passage…' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('staves 1, 2');
    expect(within(dialog).getByRole('button', { name: 'Paste' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    copyMusicXmlMeasures.mockImplementationOnce(() => { throw new Error('Cannot safely inherit unsupported transpose attributes.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Select measure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy passage' }));
    expect(screen.getByRole('alert').textContent).toContain('transpose');
    pasteMusicXmlMeasures.mockReturnValue('<score-partwise pasted="yes"/>');
    fireEvent.click(screen.getByRole('button', { name: 'Paste passage…' }));
    readMusicXml.mockImplementationOnce(() => { throw new Error('Paste preview could not be rendered.'); });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Paste' }));
    expect(within(dialog).getAllByRole('alert').at(-1)!.textContent).toContain('could not be rendered');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Paste passage…' }));
    expect(screen.getByRole('alert').textContent).toContain('Apply the pending fret before pasting');
  });

  it('cuts whole measures after confirmation and pastes over a matching selection', async () => {
    const source = '<score-partwise version="4.0"><part/></score-partwise>';
    const beats = [{ notes: [{ string: 3, fret: 0, id: 1 }], playbackStart: 0, graceType: 0, isRest: false }];
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, score: { ...preview.score, masterBars: [{}, {}],
      tracks: [{ staves: [{ bars: [{ voices: [{ beats }] }, { voices: [{ beats }] }] }] }] } }));
    const clip = { title: 'x', measures: ['<measure/>'], meters: ['4/4'], staves: [1], tabStaff: 1, tuning: [62, 59, 55, 50, 67], excluded: [] };
    cutMusicXmlMeasures.mockReturnValue({ source: '<score-partwise cut="yes"/>', clipboard: clip, notes: 2, labels: 1, lyrics: 1, spans: ['hammer-on'] });
    pasteMusicXmlMeasures.mockImplementation((_source: string, _score: unknown, _clip: unknown, measure: number, mode: string) => `<score-partwise ${mode}="${measure}"/>`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByText('Select passage', { selector: 'summary' }));
    fireEvent.click(screen.getByText('Measure', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set range start' }));
    fireEvent.change(screen.getByLabelText('Selection measure'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set range end' }));
    cutMusicXmlMeasures.mockImplementationOnce(() => { throw new Error('Cutting these measures would split a tie that crosses the passage edge. Remove it first.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Cut passage…' }));
    expect(screen.getByRole('alert').textContent).toContain('would split a tie');
    fireEvent.click(screen.getByRole('button', { name: 'Select measure' }));
    fireEvent.change(screen.getByLabelText('Selection measure'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select measure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cut passage…' }));
    expect(cutMusicXmlMeasures).toHaveBeenLastCalledWith(source, expect.anything(), 0, 0);
    let dialog = screen.getByRole('dialog', { name: 'Cut passage' });
    expect(dialog.textContent).toContain('Cut measure 1?');
    expect(dialog.textContent).toContain('2 notes');
    expect(dialog.textContent).toContain('1 chord or text label');
    expect(dialog.textContent).toContain('1 lyric syllable');
    expect(dialog.textContent).toContain('Connected techniques inside: hammer-on');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cut passage…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cut' }));
    expect(screen.getByText('Cut measure 1 to the clipboard; the measures now hold rests.')).toBeTruthy();
    expect(screen.getByText('Clipboard: 1 measure from “Imported tune”.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear passage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paste passage…' }));
    dialog = screen.getByRole('dialog', { name: 'Paste passage' });
    expect(within(dialog).getByLabelText<HTMLInputElement>('Replace selected measures').disabled).toBe(true);
    expect(dialog.textContent).toContain('To replace, select 1 whole measure as the passage first.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select measure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paste passage…' }));
    fireEvent.click(within(dialog).getByLabelText('Replace selected measures'));
    expect(dialog.textContent).toContain('Destination: measures 1–1.');
    expect(dialog.textContent).toContain('The bar count stays the same.');
    expect(pasteMusicXmlMeasures).toHaveBeenLastCalledWith(source, expect.anything(), expect.anything(), 0, 'replace', 'frets');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Paste' }));
    expect(screen.getByText('Replaced measures 1–1 with the copied 1 measure.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select measure' }));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cut passage…' }));
    expect(screen.getByRole('alert').textContent).toContain('Apply the pending fret before cutting');
  });

  it('creates an unsaved blank score from the New score dialog and opens it for editing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([]));
    vi.stubGlobal('fetch', fetchMock);
    createBlankMusicXml.mockImplementation((options: { title: string; measures: number; tuning: number[] }) => {
      if (options.measures > 256) throw new Error('A score needs 1 to 256 measures.');
      return `<score-partwise blank="${options.title}" tuning="${options.tuning.join(',')}"/>`;
    });
    readMusicXml.mockImplementation((value: string, filename: string, format: string) => ({ ...preview, source: value, filename, sourceFormat: format, score: { title: 'ignored', masterBars: [{}],
      tracks: [{ staves: [{ bars: [{ voices: [{ beats: [{ notes: [], isRest: true, graceType: 0, playbackStart: 0 }] }] }] }] }] } }));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: /New score/ }));
    const dialog = screen.getByRole('dialog', { name: 'New score' });
    expect(within(dialog).getByLabelText<HTMLInputElement>('New score title').value).toBe('Untitled');
    expect(within(dialog).getByLabelText<HTMLInputElement>('New score tempo').value).toBe('96');
    expect(within(dialog).getByLabelText<HTMLInputElement>('New score measures').value).toBe('8');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: score.title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /New score/ }));
    fireEvent.change(within(dialog).getByLabelText('New score measures'), { target: { value: '300' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create score' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('1 to 256 measures');
    fireEvent.change(within(dialog).getByLabelText('New score measures'), { target: { value: '4' } });
    fireEvent.change(within(dialog).getByLabelText('New score title'), { target: { value: ' Cluck Old Hen ' } });
    fireEvent.change(within(dialog).getByLabelText('New score beats'), { target: { value: '3' } });
    expect(within(dialog).getByLabelText<HTMLSelectElement>('New score tuning preset').value).toBe('Open G');
    fireEvent.change(within(dialog).getByLabelText('New score string 4 note'), { target: { value: '48' } });
    expect(within(dialog).getByLabelText<HTMLSelectElement>('New score string 4 note').selectedOptions[0].textContent).toBe('C3');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create score' }));
    expect(createBlankMusicXml).toHaveBeenLastCalledWith({ title: 'Cluck Old Hen', tempo: 96, numerator: 3, denominator: 4, measures: 4, tuning: [62, 59, 55, 48, 67] });
    expect(readMusicXml).toHaveBeenLastCalledWith('<score-partwise blank="Cluck Old Hen" tuning="62,59,55,48,67"/>', 'Cluck Old Hen.musicxml', 'musicxml');
    expect(screen.getByRole('heading', { name: 'Cluck Old Hen' })).toBeTruthy();
    expect(screen.getByText('New score “Cluck Old Hen” created. It is not saved until you choose Save to library.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done editing' })).toBeTruthy();
    expect(screen.getByLabelText('Selection inspector').textContent).toContain('Measure 1');
    expect(screen.getByLabelText('Selection inspector').textContent).toContain('String 1');
    expect(fetchMock.mock.calls.filter(([, options]) => (options as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
  });

  it('blocks export while a typed fret is still pending', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    expect(screen.getByTestId('export-blocked').textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '7' } });
    expect(screen.getByTestId('export-blocked').textContent).toBe('Apply or clear the pending fret before exporting.');
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '0' } });
    expect(screen.getByTestId('export-blocked').textContent).toBe('');
  });

  it('keeps one set of edit tools that moves between the properties column and a narrow-screen sheet without losing work', async () => {
    const listeners: (() => void)[] = [];
    let narrowMatches = true;
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ get matches() { return query.includes('max-width: 800px') ? narrowMatches : false; },
      media: query, addEventListener: (_: string, listener: () => void) => listeners.push(listener), removeEventListener: vi.fn() })));
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
      render(<App />);
      await screen.findByRole('button', { name: /Practice demo/ });
      fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
      const toggle = screen.getByRole('button', { name: 'Properties' });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByLabelText('Selection inspector')).toBeNull();
      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      const sheet = screen.getByRole('complementary', { name: 'Properties' });
      expect(within(sheet).getByLabelText('Selection inspector')).toBeTruthy();
      fireEvent.click(screen.getByTestId('choose-note'));
      fireEvent.change(within(sheet).getByLabelText('Fret'), { target: { value: '7' } });
      fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('complementary', { name: 'Properties' })).toBeNull();
      expect(document.activeElement).toBe(toggle);
      fireEvent.click(toggle);
      expect(screen.getAllByLabelText('Selection inspector')).toHaveLength(1);
      expect(screen.getByLabelText<HTMLInputElement>('Fret').value).toBe('7');
      narrowMatches = false;
      act(() => listeners.forEach(listener => listener()));
      expect(screen.queryByRole('button', { name: 'Properties' })).toBeNull();
      expect(screen.getByRole('complementary', { name: 'Properties' })).toBeTruthy();
      expect(screen.getAllByLabelText('Selection inspector')).toHaveLength(1);
      expect(screen.getByLabelText<HTMLInputElement>('Fret').value).toBe('7');
      expect(screen.getByText('Measure 1')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('saves with Ctrl/Cmd+S from anywhere in the workspace instead of the browser save dialog', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response({ id: 7, title: score.title, revision: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '2' } });
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { screen.getByLabelText('Fret').dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => (options as RequestInit | undefined)?.method === 'POST')).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls.find(([, options]) => (options as RequestInit | undefined)?.method === 'POST')![1].body);
    expect(body.score.measures[0].beats[0].notes[0].fret).toBe(2);
    const other = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    act(() => { document.body.dispatchEvent(other); });
    expect(other.defaultPrevented).toBe(false);
  });

  it('undoes a committed edit that fails to render and keeps the last renderable draft', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByTestId('render-fail'));
    expect(screen.getByRole('alert').textContent).toContain('Layout failed.');
    fireEvent.click(screen.getByTestId('render-ok'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.change(screen.getByLabelText('Fret'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    expect(screen.getByText('Fret 5')).toBeTruthy();
    fireEvent.click(screen.getByTestId('render-fail'));
    expect(screen.getByRole('alert').textContent).toContain('“Change fret to 5” could not be displayed, so it was undone: Layout failed.');
    expect(screen.getByText('Fret 0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('render-ok'));
    fireEvent.click(screen.getByTestId('render-fail'));
    expect(screen.getByText('Fret 0')).toBeTruthy();
  });

  it('applies typed frets live, joins a quick second digit into one undo step and ignores other keys', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    fireEvent.click(screen.getByTestId('key-1'));
    expect(screen.getByText('Fret 1')).toBeTruthy();
    expect(screen.getByLabelText('Fret entry').className).toContain('typing');
    fireEvent.click(screen.getByTestId('key-2'));
    expect(screen.getByText('Fret 12')).toBeTruthy();
    expect(screen.getByLabelText('Fret entry').textContent).toBe('12');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Fret 0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    // 3 then 7 would be fret 37, so the 7 starts a new fret.
    fireEvent.click(screen.getByTestId('key-3'));
    fireEvent.click(screen.getByTestId('key-Escape'));
    fireEvent.click(screen.getByTestId('key-1'));
    fireEvent.click(screen.getByTestId('key-9'));
    expect(screen.getByText('Fret 19')).toBeTruthy();
    fireEvent.click(screen.getByTestId('key-Backspace'));
    expect(screen.getByText('Fret 1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('key-Enter'));
    fireEvent.click(screen.getByTestId('key-Tab'));
    fireEvent.click(screen.getByTestId('choose-next-note'));
    expect(screen.getByText('Measure 2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('choose-empty'));
    fireEvent.click(screen.getByTestId('key-5'));
    expect(screen.getByText('Fret 5')).toBeTruthy();
  });

  it('shows offset and pitch, moves notes keeping fret or pitch, and lists keyboard shortcuts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await screen.findByRole('button', { name: /Practice demo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    const summary = () => screen.getByLabelText('Selection inspector').querySelector('.editor-selection-summary')!.textContent;
    expect(summary()).toContain('Offset 0');
    expect(summary()).toContain('G3');
    fireEvent.change(screen.getByLabelText('Move to string'), { target: { value: '4' } });
    expect(screen.getByText('Result: string 4, fret 0, D3.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Move keeps'), { target: { value: 'pitch' } });
    expect(screen.getByText('Result: string 4, fret 5, G3.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Move to string'), { target: { value: '1' } });
    expect(screen.getByText('Keeping the pitch would need fret -7 on string 1, outside 0–36.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Move to string'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(summary()).toContain('String 4');
    expect(summary()).toContain('Fret 5');
    expect(summary()).toContain('G3');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    const help = screen.getByRole('dialog', { name: 'Keyboard help' });
    expect(help.textContent).toContain('Ctrl/Cmd+S');
    fireEvent.click(within(help).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Keyboard help' })).toBeNull();
  });

  it('offers a grace selector and exact offsets on an imported event', async () => {
    const source = '<score-partwise version="4.0"><part/></score-partwise>';
    const beats = [{ notes: [{ string: 3, fret: 2, realValue: 57, id: 5 }], playbackStart: 480, graceType: 1, graceIndex: 0, isRest: false },
      { notes: [{ string: 3, fret: 0, realValue: 55, id: 1 }], playbackStart: 480, graceType: 0, isRest: false },
      { notes: [], playbackStart: 1440, graceType: 0, isRest: true }];
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, score: { ...preview.score,
      tracks: [{ staves: [{ tuning: [62, 59, 55, 50, 67], bars: [{ voices: [{ beats }] }] }] }] } }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-grace'));
    const summary = () => screen.getByLabelText('Selection inspector').querySelector('.editor-selection-summary')!.textContent;
    expect(summary()).toContain('Offset 1/2 quarter note');
    expect(summary()).toContain('A3');
    const grace = screen.getByLabelText<HTMLSelectElement>('Selection grace');
    expect(Array.from(grace.options).map(option => option.textContent)).toEqual(['Grace 1', 'Main']);
    fireEvent.change(grace, { target: { value: '2' } });
    expect(summary()).toContain('Event 2');
    expect(summary()).toContain('G3');
    fireEvent.change(screen.getByLabelText('Selection event'), { target: { value: '3' } });
    expect(summary()).toContain('Offset 3/2 quarter notes');
    expect(summary()).toContain('Rest / empty string');
    expect(screen.queryByLabelText('Selection grace')).toBeNull();
  });

  it('explains why a shortest or dotted rest cannot be split', async () => {
    const source = '<score-partwise version="4.0"><part/></score-partwise>';
    readMusicXml.mockImplementation((value: string) => ({ ...preview, source: value, score: { ...preview.score,
      tracks: [{ staves: [{ bars: [{ voices: [{ beats: [{ notes: [{ string: 3, fret: 0, id: 1 }], playbackStart: 0, graceType: 0, isRest: false }] }] }] }] }] } }));
    inspectMusicXmlDuration.mockReturnValue({ denominator: 64, dots: 0, rest: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy());
    openImport();
    selectFile('import.musicxml', source);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Imported tune' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit score' }));
    fireEvent.click(screen.getByTestId('choose-note'));
    expect(screen.getByRole('button', { name: 'Split rest' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('A 1/64 rest is the shortest rest; it cannot be split further.')).toBeTruthy();
    inspectMusicXmlDuration.mockReturnValue({ denominator: 4, dots: 1, rest: true });
    fireEvent.click(screen.getByTestId('choose-next-note'));
    expect(screen.getByText('A dotted rest cannot be split; choose an undotted duration first.')).toBeTruthy();
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
