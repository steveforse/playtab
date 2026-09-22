// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demo } from '../../app/frontend/music/score';

const alphaTab = vi.hoisted(() => {
  class EventBus<T = unknown> {
    listeners: ((event: T) => void)[] = [];
    on(listener: (event: T) => void) { this.listeners.push(listener); }
    emit(event: T = {} as T) { this.listeners.forEach(listener => listener(event)); }
  }
  class FakeAlphaTabApi {
    static latest: FakeAlphaTabApi;
    settings: unknown;
    playerReady = new EventBus<void>();
    playerStateChanged = new EventBus<{ state: number }>();
    playerPositionChanged = new EventBus<{ currentTime: number; endTime: number }>();
    noteMouseDown = new EventBus<any>();
    beatMouseDown = new EventBus<any>();
    renderFinished = new EventBus<void>();
    error = new EventBus<{ message?: string }>();
    playbackRangeHighlightChanged = new EventBus<any>();
    boundsLookup = null;
    playbackSpeed = 1;
    masterVolume = 1;
    isLooping = false;
    metronomeVolume = 0;
    renderScore = vi.fn();
    destroy = vi.fn();
    stop = vi.fn();
    playPause = vi.fn();
    downloadMidi = vi.fn();
    print = vi.fn();
    highlightPlaybackRange = vi.fn();
    applyPlaybackRangeFromHighlight = vi.fn();
    constructor(_element: unknown, settings: unknown) { this.settings = settings; FakeAlphaTabApi.latest = this; }
  }
  return { FakeAlphaTabApi, toAlphaTab: vi.fn(() => ({ tracks: [] })) };
});

vi.mock('@coderline/alphatab', () => ({
  AlphaTabApi: alphaTab.FakeAlphaTabApi,
  PlayerOutputMode: { WebAudioAudioWorklets: 0, WebAudioScriptProcessor: 1 },
}));
vi.mock('../../app/frontend/music/alphatab', () => ({ toAlphaTab: alphaTab.toAlphaTab }));

import {
  availableSoundFonts,
  createHorizontalPageScrollHandler,
  createEditingStaffInteractionHandler,
  createPaginatedCursorHandler,
  createPaginatedInteractionHandlers,
  cssLengthInPixels,
  defaultPlayerPreferences,
  downloadBytes,
  mapPaginatedSelection,
  paginateAlphaTabSurface,
  paginatedCursorPosition,
  paginatedPageForY,
  paginatedPoint,
  Player,
  selectionFromBeat,
  selectionFromNote,
} from '../../app/frontend/Player';

Object.defineProperty(HTMLAnchorElement.prototype, 'click', { configurable: true, value: vi.fn() });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const preview = {
  id: 'preview-1', source: '<score-partwise/>', filename: 'tune.musicxml', sourceFormat: 'musicxml',
  score: { title: 'Imported tune', masterBars: [], tempo: 100 }, tuningLabel: 'g C G C D', lyricsSection: 'VERSE\nThere once was a ship', timedLyrics: [], chordDiagrams: [],
} as any;

function readyPlayer(nextPreview: any = null) {
  render(<Player score={demo} preview={nextPreview} />);
  const api = alphaTab.FakeAlphaTabApi.latest;
  act(() => {
    api.playerReady.emit();
    api.renderFinished.emit();
  });
  return api;
}

function exportScore(format: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
  fireEvent.change(screen.getByLabelText('Export format'), { target: { value: format } });
  fireEvent.click(screen.getByRole('button', { name: 'Export file', exact: true }));
}

describe('notation player', () => {
  it('maps note and rest locations to editor identities', () => {
    const beat = {
      index: 1, graceType: 0, graceGroup: null, isRest: false,
      voice: { index: 0, beats: [], bar: { index: 0, staff: { index: 0, track: { index: 0 } } } },
    } as any;
    const note = { id: 42, string: 3, fret: 2, beat } as any;
    expect(selectionFromNote(note)).toMatchObject({ noteId: 42, measure: 1, event: 2, voice: 1, string: 3, fret: 2, kind: 'note' });
    expect(selectionFromBeat({ ...beat, isRest: true } as any)).toMatchObject({ measure: 1, event: 2, voice: 1, string: null, kind: 'rest' });
  });

  it('emits note and empty-beat selections only in edit mode', () => {
    const onSelectionChange = vi.fn();
    render(<Player score={demo} editing onSelectionChange={onSelectionChange} />);
    const api = alphaTab.FakeAlphaTabApi.latest;
    const beat = {
      index: 0, graceType: 0, graceGroup: null, isRest: true, notes: [],
      voice: { index: 0, beats: [], bar: { index: 0, staff: { index: 0, track: { index: 0 } } } },
    } as any;
    const note = { id: 7, string: 5, fret: 0, beat: { ...beat, isRest: false, notes: [{}] } } as any;
    act(() => api.noteMouseDown.emit(note));
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({ noteId: 7, string: 1, measure: 1, event: 1 }));
    act(() => api.beatMouseDown.emit(beat));
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rest', string: null }));
  });

  it('navigates to the next event while retaining the selected string', () => {
    const onSelectionChange = vi.fn();
    const bar = { index: 0, staff: { index: 0, track: { index: 0 } } } as any;
    const voice = { index: 0, beats: [], bar } as any;
    const beatOne = { index: 0, graceType: 0, graceGroup: null, isRest: false, notes: [], voice } as any;
    const beatTwo = { index: 1, graceType: 0, graceGroup: null, isRest: false, notes: [], voice } as any;
    const noteOne = { id: 1, string: 3, fret: 0, beat: beatOne } as any;
    const noteTwo = { id: 2, string: 3, fret: 2, beat: beatTwo } as any;
    beatOne.notes = [noteOne]; beatTwo.notes = [noteTwo]; voice.beats = [beatOne, beatTwo];
    bar.voices = [voice];
    const scoreModel = { tracks: [{ staves: [{ bars: [bar] }] }] } as any;
    const initial = selectionFromNote(noteOne);
    render(<Player score={demo} editing selection={initial} onSelectionChange={onSelectionChange} />);
    const api = alphaTab.FakeAlphaTabApi.latest;
    (api as any).score = scoreModel;
    fireEvent.keyDown(screen.getByTestId('notation'), { key: 'ArrowRight' });
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({ measure: 1, event: 2, string: 3, fret: 2 }));
  });

  it('selects an empty staff string from a point inside a beat', () => {
    const root = document.createElement('div');
    const surface = document.createElement('div');
    surface.className = 'at-surface';
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 200, bottom: 200 } as DOMRect);
    root.append(surface);
    const bar = { index: 0, staff: { index: 0, track: { index: 0 } } } as any;
    const voice = { index: 0, bar } as any;
    const beat = { index: 0, isRest: false, notes: [], voice } as any;
    const api = new alphaTab.FakeAlphaTabApi();
    (api as any).boundsLookup = {
      staffSystems: [],
      getBeatAtPos: vi.fn(() => beat),
      findBeat: vi.fn(() => ({ beat, visualBounds: { y: 0, h: 40 } })),
      getNoteAtPos: vi.fn(() => null),
    };
    const onSelection = vi.fn();
    const detach = createEditingStaffInteractionHandler(root, api as any, 'continuous', onSelection);
    fireEvent.mouseDown(root, { button: 0, clientX: 20, clientY: 20 });
    expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ measure: 1, event: 1, string: 3, kind: 'empty' }));
    detach();
  });

  it('commits multi-digit frets and delegates deletion keys', () => {
    const onFretInput = vi.fn();
    const onSelectionDelete = vi.fn();
    const initial = { track: 1, staff: 1, measure: 1, event: 1, voice: 1, string: 3, fret: 0, kind: 'note', noteId: 1, graceIndex: null, graceGroupId: null } as any;
    render(<Player score={demo} editing selection={initial} onFretInput={onFretInput} onSelectionDelete={onSelectionDelete} />);
    const notation = screen.getByTestId('notation');
    fireEvent.keyDown(notation, { key: '1' });
    fireEvent.keyDown(notation, { key: '2' });
    expect(onFretInput).toHaveBeenLastCalledWith(initial, 12);
    fireEvent.keyDown(notation, { key: 'Backspace' });
    expect(onSelectionDelete).toHaveBeenCalledWith(initial);
  });

  it('initializes alphaTab, drives transport, speed, loop and metronome controls', () => {
    const api = readyPlayer();
    expect(alphaTab.toAlphaTab).toHaveBeenCalledWith(demo);
    expect((api.settings as any).player.soundFont).toBe(`/notation/soundfont/${availableSoundFonts[0].filename}`);
    expect((api.settings as any).display.barsPerRow).toBe(4);
    if (availableSoundFonts.length > 1) expect(screen.getByLabelText('Sound bank')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Lyrics & chords' })).toBeNull();
    expect(screen.queryByText('5 strings')).toBeNull();
    expect((screen.getByLabelText('Hide TAB labels') as HTMLInputElement).checked).toBe(false);
    expect(api.renderScore).toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Playback settings' })).toBeTruthy();
    expect(screen.getAllByText('Ready when you are')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss playback tips' }));
    expect(screen.queryByRole('note', { name: 'Playback tips' })).toBeNull();

    act(() => {
      api.playerStateChanged.emit({ state: 1 });
      api.playerPositionChanged.emit({ currentTime: 61_000, endTime: 125_000 });
    });
    expect(screen.getAllByText('Playing')).toHaveLength(1);
    expect(screen.getAllByText('1:01 / 2:05')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(api.stop).toHaveBeenCalledOnce();
    expect(api.playPause).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByLabelText('Playback speed'), { target: { value: '1.25' } });
    fireEvent.change(screen.getByLabelText('Playback volume'), { target: { value: '0.65' } });
    fireEvent.click(screen.getByRole('button', { name: /Loop/ }));
    fireEvent.click(screen.getByRole('button', { name: /Click/ }));
    expect(api.playbackSpeed).toBe(1.25);
    expect(api.masterVolume).toBe(0.65);
    expect(api.isLooping).toBe(true);
    expect(api.metronomeVolume).toBe(0.6);

    act(() => api.error.emit({ message: '' }));
    expect(screen.getByRole('alert').textContent).toContain('Notation or audio could not load.');
  });

  it('offers paper-size views and horizontal score scrolling', () => {
    const api = readyPlayer();
    expect((screen.getByLabelText('Score view') as HTMLSelectElement).value).toBe('continuous');
    expect((screen.getByLabelText('Scroll direction') as HTMLSelectElement).value).toBe('vertical');
    expect((api.settings as any).display.layoutMode).toBe('page');

    fireEvent.change(screen.getByLabelText('Score view'), { target: { value: 'a4-portrait' } });
    expect(screen.getByLabelText('Banjo tablature').classList.contains('score-paper-a4-portrait')).toBe(true);
    fireEvent.change(screen.getByLabelText('Scroll direction'), { target: { value: 'horizontal' } });
    expect(screen.getByLabelText('Banjo tablature').classList.contains('score-paper-horizontal')).toBe(true);
    expect(screen.getByLabelText('Banjo tablature').classList.contains('score-paper-paginated')).toBe(true);
    expect((alphaTab.FakeAlphaTabApi.latest.settings as any).display.layoutMode).toBe('page');
    fireEvent.change(screen.getByLabelText('Score view'), { target: { value: 'continuous' } });
    expect((alphaTab.FakeAlphaTabApi.latest.settings as any).display.layoutMode).toBe('horizontal');
    expect((alphaTab.FakeAlphaTabApi.latest.settings as any).player.scrollElement).toBe(screen.getByTestId('notation').closest('.score-viewport'));
  });

  it('splits rendered alphaTab systems into page-sized HTML sheets', () => {
    const surface = document.createElement('div');
    for (const [top, height] of [[10, 80], [500, 80], [1_050, 80], [1_170, 80]]) {
      const system = document.createElement('div');
      system.style.position = 'absolute';
      system.style.top = `${top}px`;
      system.style.height = `${height}px`;
      surface.append(system);
    }
    paginateAlphaTabSurface(surface, 'a4-portrait');
    expect(surface.querySelectorAll('.score-page')).toHaveLength(2);
    expect(surface.querySelector('[data-page-number="2"]')?.querySelector('[data-playtab-page="2"]')).toBeTruthy();
    expect(surface.querySelector('[data-page-number="2"]')?.children[1]).toBeTruthy();
    expect((surface.querySelector('[data-page-number="2"]')?.children[1] as HTMLElement).style.top).toBe('120px');
    expect(surface.dataset.playtabPaginated).toBe('a4-portrait');
    expect(JSON.parse(surface.dataset.playtabOriginalPageTops || '[]')).toEqual([0, 1_050]);
  });

  it('keeps fixed pages side by side in horizontal mode', () => {
    const surface = document.createElement('div');
    surface.style.width = '740px';
    for (const [top, height] of [[10, 80], [1_050, 80], [1_170, 80]]) {
      const system = document.createElement('div');
      system.style.position = 'absolute';
      system.style.top = String(top) + 'px';
      system.style.height = String(height) + 'px';
      surface.append(system);
    }
    paginateAlphaTabSurface(surface, 'a4-portrait', true);
    expect(surface.querySelectorAll('.score-page')).toHaveLength(2);
    expect(surface.style.height).toBe(String(297 * 96 / 25.4 - 48) + 'px');
    expect(surface.querySelector('.score-page')?.style.width).toBe('794px');
    expect((surface.querySelector('[data-page-number="2"]')?.children[1] as HTMLElement).style.top).toBe('120px');
    expect(surface.dataset.playtabPaginationDirection).toBe('horizontal');
  });

  it('covers pagination coordinate helpers, cursor placement, and selection mapping', () => {
    expect(cssLengthInPixels('10mm')).toBeCloseTo(10 * 96 / 25.4);
    expect(cssLengthInPixels('2in')).toBe(192);
    expect(cssLengthInPixels('12px')).toBe(12);
    expect(cssLengthInPixels('auto')).toBe(0);

    const empty = document.createElement('div');
    paginateAlphaTabSurface(empty, 'continuous');
    expect(paginatedPageForY(empty, 10).page).toBeUndefined();
    expect(paginatedCursorPosition(empty, 10)).toEqual({ x: 0, y: 10 });
    expect(paginatedPoint(empty, new MouseEvent('mousemove'))).toBeNull();

    const blankRoot = document.createElement('div');
    const blankSurface = document.createElement('div');
    blankSurface.className = 'at-surface';
    blankRoot.append(blankSurface);
    expect(paginatedPageForY(blankRoot, 10).page).toBeUndefined();

    const root = document.createElement('div');
    const surface = document.createElement('div');
    surface.className = 'at-surface';
    surface.style.marginLeft = '12px';
    surface.dataset.playtabOriginalPageTops = JSON.stringify([0, 100]);
    const firstPage = document.createElement('div');
    firstPage.className = 'score-page';
    const secondPage = document.createElement('div');
    secondPage.className = 'score-page';
    Object.defineProperties(firstPage, { offsetLeft: { value: 10 }, offsetTop: { value: 5 } });
    Object.defineProperties(secondPage, { offsetLeft: { value: 210 }, offsetTop: { value: 10 } });
    vi.spyOn(firstPage, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 200, top: 0, bottom: 200 } as DOMRect);
    vi.spyOn(secondPage, 'getBoundingClientRect').mockReturnValue({ left: 210, right: 410, top: 0, bottom: 200 } as DOMRect);
    surface.append(firstPage, secondPage);
    root.append(surface);

    expect(paginatedPageForY(root, 150).page).toBe(secondPage);
    expect(paginatedCursorPosition(root, 150)).toEqual({ x: 222, y: 60 });
    expect(paginatedPoint(root, new MouseEvent('mousemove', { clientX: 220, clientY: 20 }))).toEqual({ x: 10, y: 120, pageIndex: 1 });
    expect(paginatedPoint(root, new MouseEvent('mousemove', { clientX: 500, clientY: 20 }))).toBeNull();

    const selection = document.createElement('div');
    selection.className = 'at-selection';
    const overlay = document.createElement('div');
    overlay.style.transform = 'scale(0.5) translate(10px, 20px)';
    selection.append(overlay);
    root.append(selection);
    mapPaginatedSelection(root, [{ x: 7, y: 150 }, { x: 8, y: 150 }]);
    expect(overlay.style.left).toBe('229px');
    expect(overlay.style.top).toBe('60px');
    expect(overlay.style.transform).toBe('scale(0.5)');

    const cursorHandler: any = createPaginatedCursorHandler(root);
    cursorHandler.onAttach();
    cursorHandler.onDetach();
    const bounds = { barBounds: { masterBarBounds: { visualBounds: { x: 10, y: 50, w: 80, h: 30 } } } };
    const barCursor = { setBounds: vi.fn() };
    const beatCursor = { setBounds: vi.fn(), transitionToX: vi.fn() };
    cursorHandler.placeBarCursor(barCursor, bounds);
    cursorHandler.placeBeatCursor(beatCursor, bounds, 20);
    cursorHandler.transitionBeatCursor(beatCursor, bounds, 20, 30, 100, 0);
    expect(barCursor.setBounds).toHaveBeenCalledWith(32, 55, 80, 30);
    expect(beatCursor.transitionToX).toHaveBeenCalled();
  });

  it('handles fixed-page mouse selection and cleans up its listeners', () => {
    const root = document.createElement('div');
    const surface = document.createElement('div');
    surface.className = 'at-surface';
    surface.dataset.playtabOriginalPageTops = JSON.stringify([0]);
    const page = document.createElement('div');
    page.className = 'score-page';
    vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 200, top: 0, bottom: 200 } as DOMRect);
    surface.append(page);
    root.append(surface);
    const api = new alphaTab.FakeAlphaTabApi();
    const beat = {};
    const lookup = vi.fn(() => beat);
    (api as any).boundsLookup = { getBeatAtPos: lookup };
    const detach = createPaginatedInteractionHandlers(root, api as any);

    fireEvent.mouseMove(root, { clientX: 20, clientY: 20 });
    fireEvent.mouseUp(window, { clientX: 20, clientY: 20 });
    fireEvent.mouseDown(root, { button: 2, clientX: 20, clientY: 20 });
    fireEvent.mouseDown(root, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.mouseMove(root, { clientX: 25, clientY: 25 });
    fireEvent.mouseUp(window, { clientX: 25, clientY: 25 });
    expect(api.highlightPlaybackRange).toHaveBeenCalled();
    expect(api.applyPlaybackRangeFromHighlight).toHaveBeenCalledOnce();
    const callCount = (api.highlightPlaybackRange as any).mock.calls.length;
    detach();
    fireEvent.mouseDown(root, { button: 0, clientX: 20, clientY: 20 });
    expect((api.highlightPlaybackRange as any).mock.calls.length).toBe(callCount);
  });

  it('paginates after render and maps playback highlight callbacks', () => {
    const preferences = { ...defaultPlayerPreferences(), scoreView: 'a4-portrait' as const };
    render(<Player score={demo} preferences={preferences} />);
    const api = alphaTab.FakeAlphaTabApi.latest;
    const surface = document.createElement('div');
    surface.className = 'at-surface';
    screen.getByTestId('notation').append(surface);
    const original = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame');
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => { callback(0); return 0; } });
    act(() => {
      api.renderFinished.emit();
      api.playbackRangeHighlightChanged.emit({ highlightBlocks: [] });
    });
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: undefined });
    act(() => api.renderFinished.emit());
    if (original) Object.defineProperty(window, 'requestAnimationFrame', original);
    else delete (window as any).requestAnimationFrame;
    expect(api.renderScore).toHaveBeenCalled();
  });

  it('scrolls fixed horizontal pages only when playback crosses a page', () => {
    const root = document.createElement('div');
    const surface = document.createElement('div');
    surface.className = 'at-surface';
    surface.dataset.playtabOriginalPageTops = JSON.stringify([0, 1_000]);
    const firstPage = document.createElement('div');
    firstPage.className = 'score-page';
    const secondPage = document.createElement('div');
    secondPage.className = 'score-page';
    surface.append(firstPage, secondPage);
    root.append(surface);
    const viewport = document.createElement('div');
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 400 });
    Object.defineProperty(viewport, 'scrollLeft', { configurable: true, writable: true, value: 0 });
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 0 } as DOMRect);
    vi.spyOn(firstPage, 'getBoundingClientRect').mockReturnValue({ left: 0 } as DOMRect);
    vi.spyOn(secondPage, 'getBoundingClientRect').mockReturnValue({ left: 800 } as DOMRect);
    const scrollTo = vi.fn();
    Object.defineProperty(viewport, 'scrollTo', { configurable: true, value: scrollTo });
    const handler = createHorizontalPageScrollHandler(root, viewport);
    const beat = (y: number, x = 100) => ({ barBounds: { masterBarBounds: { visualBounds: { x, y } } } });

    handler.onBeatCursorUpdating(beat(100) as any, undefined, 0 as any, 0, 0, 0);
    handler.onBeatCursorUpdating(beat(200, 200) as any, undefined, 0 as any, 0, 0, 0);
    expect(scrollTo).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenNthCalledWith(1, { left: 0, behavior: 'smooth' });
    handler.onBeatCursorUpdating(beat(1_100) as any, undefined, 0 as any, 0, 0, 0);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenNthCalledWith(2, { left: 800, behavior: 'smooth' });
    handler.onBeatCursorUpdating(beat(1_200, 300) as any, undefined, 0 as any, 0, 0, 0);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    handler.forceScrollTo(beat(1_200, 300) as any);
    expect(scrollTo).toHaveBeenCalledTimes(3);
    (handler as any)[Symbol.dispose]();
  });

  it('initializes persistent player preferences supplied by the host app', () => {
    const preferences = {
      speed: 0.75, volume: 0.6, loop: true, metronome: true, barsPerRow: 2, lyricsColumns: 3,
      scoreView: 'letter-landscape' as const, scrollDirection: 'horizontal' as const,
      showChordDiagrams: true, hideTabClef: true, soundFontId: availableSoundFonts[0].id,
    };
    render(<Player score={demo} preview={preview} preferences={preferences} />);
    const api = alphaTab.FakeAlphaTabApi.latest;
    act(() => {
      api.playerReady.emit();
      api.renderFinished.emit();
    });
    expect((screen.getByLabelText('Playback speed') as HTMLInputElement).value).toBe('0.75');
    expect((screen.getByLabelText('Playback volume') as HTMLInputElement).value).toBe('0.6');
    expect((screen.getByRole('button', { name: /Loop/ }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Measures per line') as HTMLSelectElement).value).toBe('2');
    expect((screen.getByLabelText('Score view') as HTMLSelectElement).value).toBe('letter-landscape');
    expect((screen.getByLabelText('Scroll direction') as HTMLSelectElement).value).toBe('horizontal');
    expect((screen.getByLabelText('Hide TAB labels') as HTMLInputElement).checked).toBe(true);
    expect((api.settings as any).display).toMatchObject({ barsPerRow: 2, layoutMode: 'page' });
    expect(api.playbackSpeed).toBe(0.75);
    expect(api.masterVolume).toBe(0.6);
    expect(api.isLooping).toBe(true);
    expect(api.metronomeVolume).toBe(0.6);
    expect((api as any).customCursorHandler).toBeTruthy();
    expect((api as any).customScrollHandler).toBeTruthy();
  });

  it('switches between available comparison sound banks', async () => {
    const injected = availableSoundFonts.length < 2;
    if (injected) availableSoundFonts.push({ id: 'test-bank', label: 'Test bank', filename: 'test-bank.sf2', description: 'Unit test bank' });
    try {
      readyPlayer();
      const option = availableSoundFonts[1];
      const select = screen.getByLabelText('Sound bank');
      fireEvent.change(select, { target: { value: option.id } });
      await waitFor(() => expect(alphaTab.FakeAlphaTabApi.latest.settings).toMatchObject({ player: { soundFont: `/notation/soundfont/${option.filename}` } }));
    } finally {
      if (injected) availableSoundFonts.pop();
    }
  });

  it('prefers Philharmonia Banjo-F when the optional bank is available', () => {
    const injected = !availableSoundFonts.some(option => option.id === 'philharmonia-banjo-f');
    if (injected) availableSoundFonts.push({ id: 'philharmonia-banjo-f', label: 'Philharmonia Banjo-F', filename: 'philharmonia-banjo-f.sf2', description: 'Dedicated banjo bank' });
    try {
      const api = readyPlayer();
      expect((screen.getByLabelText('Sound bank') as HTMLSelectElement).value).toBe('philharmonia-banjo-f');
      expect((api.settings as any).player.soundFont).toBe('/notation/soundfont/philharmonia-banjo-f.sf2');
    } finally {
      if (injected) availableSoundFonts.pop();
    }
  });

  it('exports native files and prints a native score', () => {
    const api = readyPlayer();
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    exportScore('txt');
    exportScore('json');
    exportScore('midi');
    exportScore('pdf');
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(api.downloadMidi).toHaveBeenCalledOnce();
    expect(api.print).toHaveBeenCalledOnce();
    vi.runAllTimers();
  });

  it('uses native dialog methods when the browser provides them', () => {
    const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
    try {
      readyPlayer();
      exportScore('txt');
      expect(document.querySelector('.export-dialog')).toBeTruthy();
    } finally {
      if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
      else delete (HTMLDialogElement.prototype as any).showModal;
      if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
      else delete (HTMLDialogElement.prototype as any).close;
    }
  });

  it('exports imported MusicXML, configures lyrics, and reports blocked print windows', () => {
    let api = readyPlayer(preview);
    expect((screen.getByLabelText('Measures per line') as HTMLSelectElement).value).toBe('4');
    expect(screen.queryByLabelText('Lyrics columns')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Lyrics & chords' })).toBeTruthy();
    expect((screen.getByLabelText('Lyrics and chords') as HTMLElement).hidden).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Lyrics & chords' }));
    expect((screen.getByLabelText('Banjo tablature') as HTMLElement).hidden).toBe(true);
    expect((screen.getByLabelText('Lyrics and chords') as HTMLElement).hidden).toBe(false);
    expect(screen.queryByLabelText('Measures per line')).toBeNull();
    expect(screen.queryByLabelText('Score view')).toBeNull();
    expect(screen.queryByLabelText('Scroll direction')).toBeNull();
    expect(screen.queryByLabelText('Hide TAB labels')).toBeNull();
    expect((screen.getByLabelText('Lyrics columns') as HTMLSelectElement).value).toBe('2');
    expect(screen.getByText('Column')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Lyrics columns'), { target: { value: '3' } });
    expect((screen.getByLabelText('Lyrics columns') as HTMLSelectElement).value).toBe('3');
    fireEvent.click(screen.getByRole('tab', { name: 'Tablature' }));
    expect(screen.queryByLabelText('Lyrics columns')).toBeNull();
    expect(screen.getByLabelText('Measures per line')).toBeTruthy();
    const createObjectURL = vi.fn(() => 'blob:musicxml');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    fireEvent.change(screen.getByLabelText('Playback speed'), { target: { value: '0.75' } });
    expect(api.playbackSpeed).toBe(0.75);
    fireEvent.change(screen.getByLabelText('Measures per line'), { target: { value: '4' } });
    api = alphaTab.FakeAlphaTabApi.latest;
    act(() => {
      api.playerReady.emit();
      api.renderFinished.emit();
    });
    exportScore('musicxml');
    expect(createObjectURL).toHaveBeenCalledOnce();
    vi.spyOn(window, 'open').mockReturnValue(null);
    exportScore('pdf');
    expect(screen.getByRole('alert').textContent).toContain('print preview window was blocked');
  });

  it('offers chord diagrams separately from imported chord names', () => {
    const chordPreview = { ...preview, chordDiagrams: [{ name: 'C', strings: [0, 0, 0, 2, 0], firstFret: 1, barreFrets: [] }] };
    const api = readyPlayer(chordPreview);
    const toggle = screen.getByLabelText('Show chord diagrams');
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    expect((screen.getByLabelText('Show chord diagrams') as HTMLInputElement).checked).toBe(true);
    expect(alphaTab.FakeAlphaTabApi.latest).not.toBe(api);
    expect(alphaTab.FakeAlphaTabApi.latest.renderScore).toHaveBeenCalled();
  });

  it('can hide repeated TAB labels without using the worker renderer', () => {
    const api = readyPlayer();
    const toggle = screen.getByLabelText('Hide TAB labels');
    fireEvent.click(toggle);
    const updatedApi = alphaTab.FakeAlphaTabApi.latest;
    expect(updatedApi).not.toBe(api);
    expect((updatedApi.settings as any).core).toMatchObject({ useWorkers: false, enableLazyLoading: false });
    expect(updatedApi.renderScore).toHaveBeenCalledWith(expect.objectContaining({ stylesheet: expect.objectContaining({ playtabHideTabClef: true }) }));
  });

  it('exports TEF2 and TEF3 downloads and shows server loss warnings', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ filename: 'Imported-tune.tef', content: btoa('TEF'), warnings: ['Lyrics are not represented.'] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:tef');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    readyPlayer(preview);

    exportScore('tef2');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ version: 'tef2' });
    expect(screen.getByRole('status').textContent).toContain('Lyrics are not represented.');

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ filename: 'tune.tef', content: btoa('TEF3'), warnings: [] }) });
    exportScore('tef3');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status').textContent).toContain('TEF export completed.');
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    vi.useFakeTimers();
    downloadBytes(btoa('timer'), 'timer.tef');
    vi.runAllTimers();
  });

  it('reports TEF export request and response failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: 'TEF2 cannot represent this score.' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('not json'); } });
    vi.stubGlobal('fetch', fetchMock);
    readyPlayer();
    exportScore('tef2');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('TEF2 cannot represent this score.'));
    exportScore('tef3');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('TEF export returned an invalid file.'));
  });

  it('prints a lyrics preview after fitting wide notation to the popup page', async () => {
    const api = readyPlayer(preview);
    const cursor = document.createElement('div');
    cursor.className = 'at-cursors';
    document.querySelector('.score-paper')?.appendChild(cursor);
    const style = document.createElement('style');
    style.textContent = '.score-paper {}';
    document.head.appendChild(style);
    const surface = { style: {} as Record<string, string>, dataset: {} as Record<string, string>, parentNode: { replaceChild: vi.fn() } };
    Object.assign(surface, { querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 200, height: 100 }) });
    const paper = { querySelector: () => surface, getBoundingClientRect: () => ({ width: 100 }) };
    const popup = {
      closed: false,
      document: {
        write: vi.fn(), close: vi.fn(), title: '',
        fonts: { ready: Promise.resolve() },
        querySelector: () => paper,
        createElement: () => ({ style: {}, appendChild: vi.fn() }),
      },
      getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0', borderLeftWidth: '0', borderRightWidth: '0' }),
      focus: vi.fn(), print: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as any);
    vi.useFakeTimers();
    exportScore('pdf');
    await Promise.resolve();
    vi.runAllTimers();
    expect(popup.document.write).toHaveBeenCalled();
    expect(popup.focus).toHaveBeenCalled();
    expect(popup.print).toHaveBeenCalled();
    expect(api.print).not.toHaveBeenCalled();
  });

  it('leaves notation at its original size when it already fits the page', async () => {
    readyPlayer(preview);
    const surface = { style: { width: '100px', height: '50px' } as Record<string, string>, dataset: {} as Record<string, string>, parentNode: { replaceChild: vi.fn() } };
    const paper = { querySelector: () => surface, getBoundingClientRect: () => ({ width: 200 }) };
    const popup = {
      closed: false,
      document: {
        write: vi.fn(), close: vi.fn(), title: '', fonts: { ready: Promise.resolve() },
        querySelector: () => paper, createElement: vi.fn(),
      },
      getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0', borderLeftWidth: '0', borderRightWidth: '0' }),
      focus: vi.fn(), print: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as any);
    vi.useFakeTimers();
    exportScore('pdf');
    await Promise.resolve();
    vi.runAllTimers();
    expect(surface.dataset.printFit).toBe('true');
    expect(surface.parentNode.replaceChild).not.toHaveBeenCalled();
  });

  it('prints when the popup has no notation surface to fit', async () => {
    readyPlayer(preview);
    const popup = {
      closed: false,
      document: { write: vi.fn(), close: vi.fn(), title: '', fonts: { ready: Promise.resolve() }, querySelector: () => ({ querySelector: () => null }) },
      focus: vi.fn(), print: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as any);
    vi.useFakeTimers();
    exportScore('pdf');
    await Promise.resolve();
    vi.runAllTimers();
    expect(popup.print).toHaveBeenCalled();
  });
});
