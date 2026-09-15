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
    renderFinished = new EventBus<void>();
    error = new EventBus<{ message?: string }>();
    playbackSpeed = 1;
    isLooping = false;
    metronomeVolume = 0;
    renderScore = vi.fn();
    destroy = vi.fn();
    stop = vi.fn();
    playPause = vi.fn();
    downloadMidi = vi.fn();
    print = vi.fn();
    constructor(_element: unknown, settings: unknown) { this.settings = settings; FakeAlphaTabApi.latest = this; }
  }
  return { FakeAlphaTabApi, toAlphaTab: vi.fn(() => ({ tracks: [] })) };
});

vi.mock('@coderline/alphatab', () => ({
  AlphaTabApi: alphaTab.FakeAlphaTabApi,
  PlayerOutputMode: { WebAudioAudioWorklets: 0, WebAudioScriptProcessor: 1 },
}));
vi.mock('../../app/frontend/music/alphatab', () => ({ toAlphaTab: alphaTab.toAlphaTab }));

import { availableSoundFonts, Player, downloadBytes } from '../../app/frontend/Player';

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

describe('notation player', () => {
  it('initializes alphaTab, drives transport, speed, loop and metronome controls', () => {
    const api = readyPlayer();
    expect(alphaTab.toAlphaTab).toHaveBeenCalledWith(demo);
    expect((api.settings as any).player.soundFont).toBe(`/notation/soundfont/${availableSoundFonts[0].filename}`);
    expect((api.settings as any).display.barsPerRow).toBe(4);
    if (availableSoundFonts.length > 1) expect(screen.getByLabelText('Sound bank')).toBeTruthy();
    expect((screen.getByLabelText('Hide TAB labels') as HTMLInputElement).checked).toBe(false);
    expect(api.renderScore).toHaveBeenCalled();
    expect(screen.getAllByText('Ready when you are')).toHaveLength(2);

    act(() => {
      api.playerStateChanged.emit({ state: 1 });
      api.playerPositionChanged.emit({ currentTime: 61_000, endTime: 125_000 });
    });
    expect(screen.getAllByText('Playing')).toHaveLength(2);
    expect(screen.getAllByText('1:01 / 2:05')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(api.stop).toHaveBeenCalledOnce();
    expect(api.playPause).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByLabelText('Playback speed'), { target: { value: '1.25' } });
    fireEvent.click(screen.getByRole('button', { name: /Loop/ }));
    fireEvent.click(screen.getByRole('button', { name: /Click/ }));
    expect(api.playbackSpeed).toBe(1.25);
    expect(api.isLooping).toBe(true);
    expect(api.metronomeVolume).toBe(0.6);

    act(() => api.error.emit({ message: '' }));
    expect(screen.getByRole('alert').textContent).toContain('Notation or audio could not load.');
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

  it('exports native files and prints a native score', () => {
    const api = readyPlayer();
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const select = screen.getByLabelText('Export score');
    fireEvent.change(select, { target: { value: 'txt' } });
    fireEvent.change(select, { target: { value: 'json' } });
    fireEvent.change(select, { target: { value: 'midi' } });
    fireEvent.change(select, { target: { value: 'pdf' } });
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(api.downloadMidi).toHaveBeenCalledOnce();
    expect(api.print).toHaveBeenCalledOnce();
    vi.runAllTimers();
  });

  it('exports imported MusicXML, configures lyrics, and reports blocked print windows', () => {
    let api = readyPlayer(preview);
    expect((screen.getByLabelText('Measures per line') as HTMLSelectElement).value).toBe('4');
    expect((screen.getByLabelText('Lyrics columns') as HTMLSelectElement).value).toBe('2');
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
    fireEvent.change(screen.getByLabelText('Lyrics columns'), { target: { value: '3' } });
    expect((screen.getByLabelText('Lyrics columns') as HTMLSelectElement).value).toBe('3');

    const select = screen.getByLabelText('Export score');
    fireEvent.change(select, { target: { value: 'musicxml' } });
    expect(createObjectURL).toHaveBeenCalledOnce();
    vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.change(select, { target: { value: 'pdf' } });
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

    const select = screen.getByLabelText('Export score');
    fireEvent.change(select, { target: { value: 'tef2' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ version: 'tef2' });
    expect(screen.getByRole('status').textContent).toContain('Lyrics are not represented.');

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ filename: 'tune.tef', content: btoa('TEF3'), warnings: [] }) });
    fireEvent.change(select, { target: { value: 'tef3' } });
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
    const select = screen.getByLabelText('Export score');
    fireEvent.change(select, { target: { value: 'tef2' } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('TEF2 cannot represent this score.'));
    fireEvent.change(select, { target: { value: 'tef3' } });
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
    fireEvent.change(screen.getByLabelText('Export score'), { target: { value: 'pdf' } });
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
    fireEvent.change(screen.getByLabelText('Export score'), { target: { value: 'pdf' } });
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
    fireEvent.change(screen.getByLabelText('Export score'), { target: { value: 'pdf' } });
    await Promise.resolve();
    vi.runAllTimers();
    expect(popup.print).toHaveBeenCalled();
  });
});
