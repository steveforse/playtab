import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlphaTabApi, PlayerOutputMode, model } from '@coderline/alphatab';
import { toAlphaTab } from './music/alphatab';
import { exportAscii } from './music/ascii';
import type { Score } from './music/score';
import { configureChordDiagrams, toImportedScoreDocument, type MusicXmlPreview } from './music/musicxml';
import { PlaybackTransport } from './PlaybackTransport';

export type SoundFontOption = PlaytabSoundFontOption;
const bundledSoundFont: SoundFontOption = {
  id: 'musescore-general-lite', label: 'MuseScore General Lite', filename: 'musescore-general-lite.sf3', description: 'Bundled General MIDI baseline',
};
export const availableSoundFonts: SoundFontOption[] = typeof __PLAYTAB_SOUNDFONTS__ === 'undefined' ? [bundledSoundFont] : __PLAYTAB_SOUNDFONTS__;
const preferredSoundFontId = 'philharmonia-banjo-f';
const MAX_PLAYBACK_BPM = 200;
const DEFAULT_MAX_PLAYBACK_SPEED = 1.5;
const PLAYBACK_SPEED_STEP = 0.01;
export type ScoreView = 'continuous' | 'a4-portrait' | 'a4-landscape' | 'letter-portrait' | 'letter-landscape';
export type ScrollDirection = 'vertical' | 'horizontal';
export type PlayerPreferences = {
  speed: number;
  loop: boolean;
  metronome: boolean;
  barsPerRow: number;
  lyricsColumns: number;
  scoreView: ScoreView;
  scrollDirection: ScrollDirection;
  showChordDiagrams: boolean;
  hideTabClef: boolean;
  soundFontId: string;
};
const scoreViews: Record<ScoreView, { label: string; width?: string; height?: string; pageSize?: string }> = {
  continuous: { label: 'Continuous' },
  'a4-portrait': { label: 'A4 · Portrait', width: '210mm', height: '297mm', pageSize: 'A4 portrait' },
  'a4-landscape': { label: 'A4 · Landscape', width: '297mm', height: '210mm', pageSize: 'A4 landscape' },
  'letter-portrait': { label: 'Letter · Portrait', width: '8.5in', height: '11in', pageSize: 'letter portrait' },
  'letter-landscape': { label: 'Letter · Landscape', width: '11in', height: '8.5in', pageSize: 'letter landscape' },
};

export function cssLengthInPixels(value: string) {
  const match = value.match(/^([\d.]+)(mm|in|px)$/);
  if (!match) return Number.parseFloat(value) || 0;
  const amount = Number(match[1]);
  return match[2] === 'mm' ? amount * 96 / 25.4 : match[2] === 'in' ? amount * 96 : amount;
}

export function defaultPlayerPreferences(): PlayerPreferences {
  return {
    speed: 1,
    loop: false,
    metronome: false,
    barsPerRow: 4,
    lyricsColumns: 2,
    scoreView: 'continuous',
    scrollDirection: 'vertical',
    showChordDiagrams: false,
    hideTabClef: false,
    soundFontId: availableSoundFonts.find(option => option.id === preferredSoundFontId)?.id || availableSoundFonts[0]?.id || 'musescore-general-lite',
  };
}

export function paginateAlphaTabSurface(surface: HTMLElement, view: ScoreView, horizontal = false) {
  const direction = horizontal ? 'horizontal' : 'vertical';
  if (!scoreViews[view].height || surface.dataset.playtabPaginated === view && surface.dataset.playtabPaginationDirection === direction) return;
  const systems = Array.from(surface.children).filter(child => child instanceof HTMLElement) as HTMLElement[];
  if (systems.length === 0) return;

  const pageGap = 24;
  const pageHeight = Math.max(300, cssLengthInPixels(scoreViews[view].height!) - 48);
  const pages: HTMLElement[][] = [[]];
  const pageTops = [0];
  let pageTop = 0;
  for (const system of systems) {
    const top = Number.parseFloat(system.style.top) || system.offsetTop;
    const height = Number.parseFloat(system.style.height) || system.offsetHeight;
    if (pages[pages.length - 1].length > 0 && top + height > pageTop + pageHeight) {
      // The wrapper supplies the visual page gap. Keep the systems' local
      // coordinates relative to the first system on this page so the spacing
      // between rows remains exactly what alphaTab rendered.
      pageTop = top;
      pages.push([]);
      // Keep the original alphaTab coordinate of the first system on this
      // page. It is also the local layout origin for systems in this wrapper.
      pageTops.push(top);
    }
    system.dataset.playtabPage = String(pages.length);
    system.style.top = `${Math.max(0, top - pageTop)}px`;
    pages[pages.length - 1].push(system);
  }

  const pageElements = pages.map((pageSystems, index) => {
    const page = document.createElement('div');
    page.className = 'score-page';
    page.dataset.pageNumber = String(index + 1);
    page.style.height = `${pageHeight}px`;
    const surfaceWidth = surface.style.width.endsWith('px') ? Number.parseFloat(surface.style.width) : surface.getBoundingClientRect().width;
    if (surfaceWidth > 0) page.style.width = `${surfaceWidth + 54}px`;
    pageSystems.forEach(system => page.append(system));
    return page;
  });
  surface.replaceChildren(...pageElements);
  surface.style.height = horizontal ? `${pageHeight}px` : `${pages.length * pageHeight + (pages.length - 1) * pageGap}px`;
  surface.dataset.playtabPaginated = view;
  surface.dataset.playtabPaginationDirection = direction;
  surface.dataset.playtabOriginalPageTops = JSON.stringify(pageTops);
}

export function paginatedPageForY(root: HTMLElement, originalY: number) {
  const surface = root.matches('.at-surface') ? root : root.querySelector<HTMLElement>('.at-surface');
  if (!surface) return { page: undefined, pageIndex: 0, pageTops: [] as number[] };
  const pages = Array.from(surface.querySelectorAll<HTMLElement>('.score-page'));
  const pageTops = JSON.parse(surface.dataset.playtabOriginalPageTops || '[]') as number[];
  if (pages.length === 0 || pageTops.length === 0) return { page: undefined, pageIndex: 0, pageTops };
  let pageIndex = 0;
  for (let index = 1; index < pageTops.length; index++) {
    if (originalY >= pageTops[index]) pageIndex = index;
    else break;
  }
  const page = pages[pageIndex] ?? pages[pages.length - 1];
  return { page, pageIndex, pageTops };
}

export function paginatedCursorPosition(root: HTMLElement, originalY: number) {
  const { page, pageIndex, pageTops } = paginatedPageForY(root, originalY);
  if (!page) return { x: 0, y: originalY };
  const surface = page.parentElement;
  const surfaceMarginLeft = surface ? Number.parseFloat(getComputedStyle(surface).marginLeft) || 0 : 0;
  return {
    x: page.offsetLeft + surfaceMarginLeft,
    y: page.offsetTop + Math.max(0, originalY - (pageTops[pageIndex] ?? 0)),
  };
}

export function paginatedPoint(root: HTMLElement, event: MouseEvent) {
  const surface = root.matches('.at-surface') ? root : root.querySelector<HTMLElement>('.at-surface');
  if (!surface) return null;
  const pages = Array.from(surface.querySelectorAll<HTMLElement>('.score-page'));
  const pageTops = JSON.parse(surface.dataset.playtabOriginalPageTops || '[]') as number[];
  const pageIndex = pages.findIndex(page => {
    const bounds = page.getBoundingClientRect();
    return event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
  });
  if (pageIndex < 0 || pageIndex >= pageTops.length) return null;
  const page = pages[pageIndex];
  const bounds = page.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left - page.clientLeft,
    y: pageTops[pageIndex] + event.clientY - bounds.top - page.clientTop,
    pageIndex,
  };
}

export function createPaginatedInteractionHandlers(root: HTMLElement, api: AlphaTabApi) {
  let selectionStart: model.Beat | null = null;
  let interactionActive = false;

  const stopEvent = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const beatAt = (event: MouseEvent) => {
    const point = paginatedPoint(root, event);
    return point ? api.boundsLookup?.getBeatAtPos(point.x, point.y) ?? null : null;
  };
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || !paginatedPoint(root, event)) return;
    stopEvent(event);
    interactionActive = true;
    selectionStart = beatAt(event);
    if (selectionStart) api.highlightPlaybackRange(selectionStart, selectionStart);
  };
  const onMouseMove = (event: MouseEvent) => {
    if (!interactionActive) return;
    stopEvent(event);
    const beat = beatAt(event);
    if (selectionStart && beat) api.highlightPlaybackRange(selectionStart, beat);
  };
  const onMouseUp = (event: MouseEvent) => {
    if (!interactionActive) return;
    stopEvent(event);
    const beat = beatAt(event);
    if (selectionStart) {
      if (beat) api.highlightPlaybackRange(selectionStart, beat);
      api.applyPlaybackRangeFromHighlight();
    }
    selectionStart = null;
    interactionActive = false;
  };
  root.addEventListener('mousedown', onMouseDown, true);
  root.addEventListener('mousemove', onMouseMove, true);
  window.addEventListener('mouseup', onMouseUp, true);
  return () => {
    root.removeEventListener('mousedown', onMouseDown, true);
    root.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);
  };
}

export function mapPaginatedSelection(root: HTMLElement, blocks: Array<{ x: number; y: number }>) {
  const overlays = Array.from(root.querySelectorAll<HTMLElement>('.at-selection > *'));
  blocks.forEach((block, index) => {
    const overlay = overlays[index];
    if (!overlay) return;
    const position = paginatedCursorPosition(root, block.y);
    overlay.style.left = `${block.x + position.x}px`;
    overlay.style.top = `${position.y}px`;
    // alphaTab's selection element stores the original bounds in both its
    // `left`/`top` properties and a translate transform. The page translation
    // belongs in one place only after the row has been moved into a wrapper.
    const scale = overlay.style.transform.match(/scale\([^)]*\)/)?.[0];
    overlay.style.transform = scale ?? 'none';
  });
}

export function createPaginatedCursorHandler(root: HTMLElement) {
  const handler: NonNullable<AlphaTabApi['customCursorHandler']> = {
    onAttach: () => {},
    onDetach: () => {},
    placeBarCursor: (barCursor, beatBounds) => {
      const bounds = beatBounds.barBounds.masterBarBounds.visualBounds;
      const position = paginatedCursorPosition(root, bounds.y);
      barCursor.setBounds(bounds.x + position.x, position.y, bounds.w, bounds.h);
    },
    placeBeatCursor: (beatCursor, beatBounds, startBeatX) => {
      const bounds = beatBounds.barBounds.masterBarBounds.visualBounds;
      const position = paginatedCursorPosition(root, bounds.y);
      const x = startBeatX + position.x;
      beatCursor.transitionToX(0, x);
      beatCursor.setBounds(x, position.y, 1, bounds.h);
    },
    transitionBeatCursor: (beatCursor, beatBounds, _startBeatX, nextBeatX, duration, _cursorMode) => {
      const bounds = beatBounds.barBounds.masterBarBounds.visualBounds;
      const position = paginatedCursorPosition(root, bounds.y);
      beatCursor.transitionToX(duration, nextBeatX + position.x);
    },
  };
  return handler;
}

export function createHorizontalPageScrollHandler(root: HTMLElement, viewport: HTMLElement) {
  let lastPageIndex: number | undefined;
  const scrollToBeat = (beatBounds: { barBounds: { masterBarBounds: { visualBounds: { x: number; y: number } } } }, force = false) => {
    const bounds = beatBounds.barBounds.masterBarBounds.visualBounds;
    const { page, pageIndex } = paginatedPageForY(root, bounds.y);
    if (!force && pageIndex === lastPageIndex) return;
    lastPageIndex = pageIndex;
    const pageLeft = page?.getBoundingClientRect().left ?? viewport.getBoundingClientRect().left;
    const viewportLeft = viewport.getBoundingClientRect().left;
    // Fixed-page mode changes pages as a unit. Align the new page with the
    // viewport instead of following the beat within that page.
    const target = viewport.scrollLeft + pageLeft - viewportLeft;
    viewport.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  };
  const handler: NonNullable<AlphaTabApi['customScrollHandler']> = {
    [Symbol.dispose]: () => {},
    forceScrollTo: beatBounds => scrollToBeat(beatBounds, true),
    onBeatCursorUpdating: startBeat => scrollToBeat(startBeat),
  };
  return handler;
}

export function download(text: string, filename: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBytes(encoded: string, filename: string, type = 'application/octet-stream') {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Player({ score, preview, preferences, onPreferencesChange }: {
  score: Score;
  preview?: MusicXmlPreview | null;
  preferences?: PlayerPreferences;
  onPreferencesChange?: (changes: Partial<PlayerPreferences>) => void;
}) {
  const defaults = preferences ?? defaultPlayerPreferences();
  const element = useRef<HTMLDivElement>(null);
  const scoreViewport = useRef<HTMLDivElement>(null);
  const scorePaper = useRef<HTMLElement>(null);
  const lyricsSection = useRef<HTMLElement>(null);
  const exportDialog = useRef<HTMLDialogElement>(null);
  const api = useRef<AlphaTabApi | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const [speed, setSpeed] = useState(defaults.speed);
  const [loop, setLoop] = useState(defaults.loop);
  const [metronome, setMetronome] = useState(defaults.metronome);
  const [position, setPosition] = useState({ currentTime: 0, endTime: 0 });
  const [rendered, setRendered] = useState(false);
  const [showPlayerTips, setShowPlayerTips] = useState(true);
  const [barsPerRow, setBarsPerRow] = useState(defaults.barsPerRow);
  const [lyricsColumns, setLyricsColumns] = useState(defaults.lyricsColumns);
  const [scoreView, setScoreView] = useState<ScoreView>(defaults.scoreView);
  const [scrollDirection, setScrollDirection] = useState<ScrollDirection>(defaults.scrollDirection);
  const [activeView, setActiveView] = useState<'tablature' | 'lyrics'>('tablature');
  const [exportFormat, setExportFormat] = useState('pdf');
  const [showChordDiagrams, setShowChordDiagrams] = useState(defaults.showChordDiagrams);
  const [hideTabClef, setHideTabClef] = useState(defaults.hideTabClef);
  const [soundFontId, setSoundFontId] = useState(defaults.soundFontId);
  const [playbackHost, setPlaybackHost] = useState<HTMLElement | null>(null);
  const soundFont = availableSoundFonts.find(option => option.id === soundFontId) ?? availableSoundFonts[0] ?? bundledSoundFont;
  useLayoutEffect(() => {
    const narrowScreen = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 800px)').matches;
    setPlaybackHost(narrowScreen ? null : document.getElementById('playback-controls'));
  }, []);
  useEffect(() => {
    setReady(false); setPlaying(false); setRendered(false); setError(''); setExportNotice('');
    setPosition({ currentTime: 0, endTime: 0 });
    const base = '/notation/';
    const layoutMode = scoreView !== 'continuous' || scrollDirection !== 'horizontal' ? 'page' : 'horizontal';
    const instance = new AlphaTabApi(element.current!, {
      core: { fontDirectory: `${base}font/`, useWorkers: !preview && !hideTabClef, enableLazyLoading: !preview && !hideTabClef },
      display: { scale: 1.1, barsPerRow, layoutMode },
      player: {
        enablePlayer: true, soundFont: `${base}soundfont/${soundFont.filename}`,
        // alphaTab's AudioWorklet output now passes the start/pause smoke
        // tests and avoids the legacy ScriptProcessor scheduling path.
        outputMode: PlayerOutputMode.WebAudioAudioWorklets,
        enableCursor: true, enableUserInteraction: true,
        scrollElement: scrollDirection === 'horizontal' ? (scoreViewport.current ?? 'html') : 'html',
      },
    });
    api.current = instance;
    let detachPaginatedInteraction: (() => void) | undefined;
    let detachPaginatedSelection: (() => void) | undefined;
    if (scoreView !== 'continuous') {
      instance.customCursorHandler = createPaginatedCursorHandler(element.current!);
      detachPaginatedInteraction = createPaginatedInteractionHandlers(element.current!, instance);
      detachPaginatedSelection = instance.playbackRangeHighlightChanged.on(event => {
        mapPaginatedSelection(element.current!, event.highlightBlocks ?? []);
      });
    }
    if (scoreView !== 'continuous' && scrollDirection === 'horizontal') instance.customScrollHandler = createHorizontalPageScrollHandler(element.current!, scoreViewport.current!);
    instance.playbackSpeed = speed;
    instance.isLooping = loop;
    instance.metronomeVolume = metronome ? 0.6 : 0;
    instance.playerReady.on(() => setReady(true));
    instance.playerStateChanged.on(event => setPlaying(event.state === 1));
    instance.playerPositionChanged.on(event => setPosition({ currentTime: event.currentTime, endTime: event.endTime }));
    instance.renderFinished.on(() => {
      setRendered(true);
      const surface = element.current?.querySelector('.at-surface');
      if (scoreView === 'continuous' || !(surface instanceof HTMLElement)) return;
      const paginate = () => paginateAlphaTabSurface(surface, scoreView, scrollDirection === 'horizontal');
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(paginate);
      else paginate();
    });
    instance.error.on(error => setError(error.message || 'Notation or audio could not load.'));
    const renderedScore = preview ? preview.score : toAlphaTab(score);
    if (preview) configureChordDiagrams(renderedScore, showChordDiagrams);
    const stylesheet = renderedScore.stylesheet ?? (renderedScore.stylesheet = {} as typeof renderedScore.stylesheet);
    (stylesheet as typeof stylesheet & { playtabHideTabClef?: boolean }).playtabHideTabClef = hideTabClef;
    instance.renderScore(renderedScore);
    return () => {
      detachPaginatedInteraction?.();
      detachPaginatedSelection?.();
      instance.destroy();
      api.current = null;
    };
  }, [score, preview, scoreView, barsPerRow, scrollDirection, showChordDiagrams, hideTabClef, soundFont]);
  const baseTempo = preview?.score.tempo ?? score.tempo;
  const maxPlaybackSpeed = Math.max(
    DEFAULT_MAX_PLAYBACK_SPEED,
    Math.ceil((MAX_PLAYBACK_BPM / baseTempo) / PLAYBACK_SPEED_STEP) * PLAYBACK_SPEED_STEP,
  );
  const transport = { ready, playing, ...position, onRestart: () => api.current?.stop(), onPlayPause: () => api.current?.playPause() };
  const playbackPanel = <section className="playback-panel" aria-label="Playback settings">
    <div className="sidebar-section playback-heading">PLAYBACK</div>
    <PlaybackTransport {...transport} ariaLabel="Playback controls" />
    <label className="speed-control">
      <span className="speed-value">{Math.round(baseTempo * speed)} <span>BPM</span></span>
      <input aria-label="Playback speed" type="range" min="0.25" max={maxPlaybackSpeed} step={PLAYBACK_SPEED_STEP} value={speed} onChange={e => { const value = Number(e.target.value); setSpeed(value); onPreferencesChange?.({ speed: value }); if (api.current) api.current.playbackSpeed = value; }} />
      <small>{Math.round(speed * 100)}%</small>
    </label>
    <div className="player-toggles">
      <button aria-pressed={loop} onClick={() => { const value = !loop; setLoop(value); onPreferencesChange?.({ loop: value }); if (api.current) api.current.isLooping = value; }}>↻ Loop</button>
      <button aria-pressed={metronome} onClick={() => { const value = !metronome; setMetronome(value); onPreferencesChange?.({ metronome: value }); if (api.current) api.current.metronomeVolume = value ? 0.6 : 0; }}>♩ Click</button>
    </div>
    {availableSoundFonts.length > 1 && <label className="soundfont-control">Sound bank
      <select aria-label="Sound bank" value={soundFont.id} onChange={e => { setSoundFontId(e.target.value); onPreferencesChange?.({ soundFontId: e.target.value }); }}>
        {availableSoundFonts.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>}
  </section>;
  const playbackControls = playbackHost ? createPortal(playbackPanel, playbackHost) : <div className="playback-inline-fallback">{playbackPanel}</div>;
  function printPreviewWithLyrics() {
    const paper = scorePaper.current!;
    const lyrics = lyricsSection.current!;
    const popup = window.open('', '_blank', 'width=1200,height=900');
    if (!popup) throw new Error('The print preview window was blocked by the browser.');

    const printablePaper = paper.cloneNode(true) as HTMLElement;
    printablePaper.hidden = false;
    printablePaper.querySelectorAll('.at-cursors').forEach(node => node.remove());
    const printableLyrics = lyrics.cloneNode(true) as HTMLElement;
    printableLyrics.hidden = false;
    const view = scoreViews[scoreView];
    const printWidth = view.width ?? '100%';
    const pageSize = view.pageSize ?? 'auto';
    const styles = Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'))
      .map(node => node.outerHTML).join('');
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Playtab</title>${styles}<style>
      body { margin: 0; background: white; }
      .print-root { width: ${printWidth}; max-width: 100%; margin: 0 auto; }
      .score-paper, .lyrics-section { box-shadow: none; border-radius: 0; }
      .score-paper { border: 0; }
      .lyrics-section { break-before: page; page-break-before: always; margin-top: 0; }
      @page { size: ${pageSize}; margin: 12mm; }
    </style></head><body><main class="print-root">${printablePaper.outerHTML}${printableLyrics.outerHTML}</main></body></html>`);
    popup.document.close();
    popup.document.title = preview?.score.title || score.title;

    const fitNotationToPage = () => {
      const printPaper = popup.document.querySelector('.score-paper');
      const surface = printPaper?.querySelector('.at-surface') as HTMLElement | null;
      if (!printPaper || !surface || surface.dataset.printFit) return;
      const surfaceWidth = Number.parseFloat(surface.style.width) || surface.getBoundingClientRect().width;
      const surfaceHeight = Number.parseFloat(surface.style.height) || surface.getBoundingClientRect().height;
      const paperStyle = popup.getComputedStyle(printPaper);
      const paperWidth = printPaper.getBoundingClientRect().width;
      const horizontalPadding = Number.parseFloat(paperStyle.paddingLeft) + Number.parseFloat(paperStyle.paddingRight);
      const horizontalBorder = Number.parseFloat(paperStyle.borderLeftWidth) + Number.parseFloat(paperStyle.borderRightWidth);
      const availableWidth = paperWidth - horizontalPadding - horizontalBorder;
      const scale = Math.min(1, availableWidth / surfaceWidth);
      if (scale >= 1) {
        surface.dataset.printFit = 'true';
        return;
      }
      const wrapper = popup.document.createElement('div');
      wrapper.style.width = `${surfaceWidth * scale}px`;
      wrapper.style.height = `${surfaceHeight * scale}px`;
      wrapper.style.overflow = 'visible';
      surface.parentNode?.replaceChild(wrapper, surface);
      wrapper.appendChild(surface);
      surface.style.transformOrigin = 'top left';
      surface.style.transform = `scale(${scale})`;
      surface.dataset.printFit = 'true';
    };

    let printed = false;
    const print = () => {
      if (printed || popup.closed) return;
      fitNotationToPage();
      printed = true;
      popup.focus();
      popup.print();
    };
    void popup.document.fonts.ready.then(print);
    setTimeout(print, 1000);
  }
  async function exportTef(version: 'tef2' | 'tef3') {
    const payload = preview ? toImportedScoreDocument(preview, []) : score;
    const response = await fetch('/api/tef_exports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '',
      },
      body: JSON.stringify({ score: payload, version }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `TEF export failed (${response.status}).`);
    if (typeof body.content !== 'string' || typeof body.filename !== 'string') throw new Error('TEF export returned an invalid file.');
    downloadBytes(body.content, body.filename);
    const warnings = Array.isArray(body.warnings) ? body.warnings.filter((warning: unknown): warning is string => typeof warning === 'string') : [];
    setExportNotice(warnings.length > 0 ? `TEF export completed with warnings:\n${warnings.join('\n')}` : 'TEF export completed.');
  }
  function openExportDialog() {
    setError(''); setExportNotice('');
    if (exportDialog.current && typeof exportDialog.current.showModal === 'function') exportDialog.current.showModal();
    else if (exportDialog.current) exportDialog.current.open = true;
  }
  function closeExportDialog() {
    if (exportDialog.current && typeof exportDialog.current.close === 'function') exportDialog.current.close();
    else if (exportDialog.current) exportDialog.current.open = false;
  }
  function confirmExport() {
    closeExportDialog();
    exportFile(exportFormat);
  }
  function exportFile(format: string) {
    setError(''); setExportNotice('');
    if (format === 'tef2' || format === 'tef3') {
      void exportTef(format).catch(e => setError((e as Error).message));
      return;
    }
    try {
      if (preview && format === 'musicxml') download(preview.source, `${preview.score.title}.musicxml`, 'application/vnd.recordare.musicxml+xml');
      if (format === 'json') download(JSON.stringify(score, null, 2), `${score.title}.playtab.json`, 'application/json');
      if (format === 'txt') download(exportAscii(score), `${score.title}.txt`);
      if (format === 'midi') api.current?.downloadMidi();
      if (format === 'pdf') {
        if (preview?.lyricsSection) printPreviewWithLyrics();
        else api.current?.print(scoreViews[scoreView].width, {
          core: preview ? { useWorkers: false } : undefined,
            display: { barsPerRow, layoutMode: scoreView !== 'continuous' || scrollDirection !== 'horizontal' ? 'page' : 'horizontal' },
        });
      }
    } catch (e) { setError((e as Error).message); }
  }
  return <>
    {playbackControls}
    <div className="score-toolbar">
      <div className="segmented" role="tablist" aria-label="Score views">
        <button id="tab-tablature" type="button" role="tab" aria-selected={activeView === 'tablature'} aria-controls="tab-score" className={activeView === 'tablature' ? 'selected' : ''} onClick={() => setActiveView('tablature')}>Tablature</button>
        {preview?.lyricsSection && <button id="tab-lyrics" type="button" role="tab" aria-selected={activeView === 'lyrics'} aria-controls="tab-lyrics-content" className={activeView === 'lyrics' ? 'selected' : ''} onClick={() => setActiveView('lyrics')}>Lyrics &amp; chords</button>}
      </div>
      <div className="score-toolbar-actions">
        <div className="layout-controls" aria-label="Layout settings">
          {activeView === 'tablature' && <>
            <label>View <select aria-label="Score view" value={scoreView} onChange={e => { const value = e.target.value as ScoreView; setScoreView(value); onPreferencesChange?.({ scoreView: value }); }}>
              {Object.entries(scoreViews).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
            </select></label>
            <label>Scroll <select aria-label="Scroll direction" value={scrollDirection} onChange={e => { const value = e.target.value as ScrollDirection; setScrollDirection(value); onPreferencesChange?.({ scrollDirection: value }); }}>
              <option value="vertical">Vertical</option><option value="horizontal">Horizontal</option>
            </select></label>
            <label>Measures / line <select aria-label="Measures per line" value={barsPerRow} onChange={e => { const value = Number(e.target.value); setBarsPerRow(value); onPreferencesChange?.({ barsPerRow: value }); }}>
              {[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <label className="layout-checkbox"><input aria-label="Hide TAB labels" type="checkbox" checked={hideTabClef} onChange={e => { const value = e.target.checked; setHideTabClef(value); onPreferencesChange?.({ hideTabClef: value }); }} /> Hide TAB labels</label>
            {(preview?.chordDiagrams?.length ?? 0) > 0 && <label className="layout-checkbox"><input aria-label="Show chord diagrams" type="checkbox" checked={showChordDiagrams} onChange={e => { const value = e.target.checked; setShowChordDiagrams(value); onPreferencesChange?.({ showChordDiagrams: value }); }} /> Chord diagrams</label>}
          </>}
          {activeView === 'lyrics' && preview?.lyricsSection && <label>Column <select aria-label="Lyrics columns" value={lyricsColumns} onChange={e => { const value = Number(e.target.value); setLyricsColumns(value); onPreferencesChange?.({ lyricsColumns: value }); }}>
            {[1, 2, 3].map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>}
        </div>
        <button type="button" className="primary export-button" aria-haspopup="dialog" disabled={!rendered} onClick={openExportDialog}>Export</button>
      </div>
    </div>
    {error && <p className="alert" role="alert">{error}</p>}
    {exportNotice && <p className="success export-notice" role="status">{exportNotice}</p>}
    <div ref={scoreViewport} className={`score-viewport score-viewport-${scrollDirection}`}>
    <section ref={scorePaper} id="tab-score" role="tabpanel" aria-labelledby="tab-tablature" className={`score-paper score-paper-${scoreView} score-paper-${scrollDirection}${scoreView !== 'continuous' ? ' score-paper-paginated' : ''}`} aria-label="Banjo tablature" hidden={activeView !== 'tablature'}>
      <div className="paper-topline"><span>PLAYTAB / {preview ? 'IMPORT PREVIEW' : 'PRACTICE SERIES'}</span><span>{preview ? preview.tuningLabel : 'OPEN G · 4/4'}</span></div>
      {!rendered && <p className="loading">Setting out your music…</p>}
      <div ref={element} data-testid="notation" />
      <div className="paper-footer">Take it slowly. Let every note ring.</div>
    </section>
    </div>
    {preview?.lyricsSection && <section ref={lyricsSection} id="tab-lyrics-content" role="tabpanel" aria-labelledby="tab-lyrics" className="lyrics-section" aria-label="Lyrics and chords" hidden={activeView !== 'lyrics'}>
      <h2>Lyrics &amp; chords</h2>
      <pre style={{ columnCount: lyricsColumns }}>{preview.lyricsSection}</pre>
    </section>}
    {showPlayerTips && <aside className="player-tips" role="note" aria-label="Playback tips">
      <p className="player-hint">Click a note to seek. Drag across notes to select a practice range, then turn on Loop.</p>
      {preview && <p className="player-hint">Audio preview: imported hammer-ons and pull-offs use held-note articulation; slides and bends retain their pitch movement.</p>}
      <button type="button" className="tip-dismiss" aria-label="Dismiss playback tips" onClick={() => setShowPlayerTips(false)}>×</button>
    </aside>}
    <dialog ref={exportDialog} className="export-dialog" aria-labelledby="export-dialog-title">
      <div className="dialog-heading"><div><div className="eyebrow">SAVE OR SHARE YOUR TAB</div><h2 id="export-dialog-title">Export score</h2></div><button type="button" className="icon-button" aria-label="Close export" onClick={closeExportDialog}>×</button></div>
      <p>Choose an output format. The current view and layout settings will be used for PDF export.</p>
      <label className="export-format-label">Format<select aria-label="Export format" value={exportFormat} onChange={e => setExportFormat(e.target.value)}>
        <option value="pdf">Print / save PDF</option><option value="midi">MIDI (.mid)</option><option value="tef2">TEF2 (.tef)</option><option value="tef3">TablEdit TEF3 (.tef)</option>{preview ? <option value="musicxml">Original MusicXML</option> : <><option value="txt">Plaintext (.txt)</option><option value="json">Playtab (.json)</option></>}
      </select></label>
      <div className="dialog-footer"><button type="button" onClick={closeExportDialog}>Cancel</button><button type="button" className="primary" disabled={!rendered} onClick={confirmExport}>Export file</button></div>
    </dialog>
  </>;
}
