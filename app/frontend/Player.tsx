import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlphaTabApi, PlayerOutputMode, model } from '@coderline/alphatab';
import { toAlphaTab } from './music/alphatab';
import { exportAscii } from './music/ascii';
import type { Score } from './music/score';
import { configureChordDiagrams, toImportedScoreDocument, type MusicXmlPreview } from './music/musicxml';
import { PlaybackTransport } from './PlaybackTransport';
import { linearAuditionMidi, scoreHasRepeats, writtenPlaybackRange, type PlaybackEndpoints } from './editor/audition';

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

function renderDocument(instance: AlphaTabApi, score: Score, preview: MusicXmlPreview | null, showChordDiagrams: boolean, hideTabClef: boolean, reuseViewport = false) {
  const renderedScore = preview ? preview.score : toAlphaTab(score);
  if (preview) configureChordDiagrams(renderedScore, showChordDiagrams);
  const stylesheet = renderedScore.stylesheet ?? (renderedScore.stylesheet = {} as typeof renderedScore.stylesheet);
  (stylesheet as typeof stylesheet & { playtabHideTabClef?: boolean }).playtabHideTabClef = hideTabClef;
  if (reuseViewport) instance.renderScore(renderedScore, undefined, { reuseViewport: true });
  else instance.renderScore(renderedScore);
}

export type ScoreSelectionKind = 'note' | 'rest' | 'empty';
export type ScoreSelection = {
  noteId: number | null;
  track: number;
  staff: number;
  measure: number;
  event: number;
  voice: number;
  string: number | null;
  fret: number | null;
  kind: ScoreSelectionKind;
  graceIndex: number | null;
  graceGroupId: string | null;
  mappingReason?: string;
  sourceId?: string;
  sourceEventId?: string;
  sourceMeasureId?: string;
};

type SelectionTarget = { selection: ScoreSelection; beat: model.Beat; note: model.Note | null };

function beatEventNumber(beat: model.Beat) {
  if (Number.isInteger(beat.index) && beat.index >= 0) return beat.index + 1;
  return Math.max(1, beat.voice.beats.indexOf(beat) + 1);
}

function locationForBeat(beat: model.Beat) {
  const bar = beat.voice.bar;
  const staff = bar.staff;
  return {
    track: staff.track.index + 1,
    staff: staff.index + 1,
    measure: bar.index + 1,
    event: beatEventNumber(beat),
    voice: beat.voice.index + 1,
    graceIndex: Number(beat.graceType ?? 0) === 0 ? null : beat.graceIndex,
    graceGroupId: beat.graceGroup?.id ?? null,
  };
}

export function selectionFromNote(note: model.Note, mappingReason?: string): ScoreSelection {
  const location = locationForBeat(note.beat);
  const modelString = note.string;
  const string = modelString >= 1 && modelString <= 5 ? 6 - modelString : null;
  return {
    ...location,
    noteId: note.id,
    string,
    fret: note.fret,
    kind: 'note',
    mappingReason,
  };
}

export function selectionFromBeat(beat: model.Beat, kind: ScoreSelectionKind = beat.isRest ? 'rest' : 'empty', string: number | null = null): ScoreSelection {
  return { ...locationForBeat(beat), noteId: null, string, fret: null, kind };
}

function uniqueBeats(voice: model.Voice) {
  const beats: model.Beat[] = [];
  const seen = new Set<model.Beat>();
  const add = (beat: model.Beat) => { if (!seen.has(beat)) { seen.add(beat); beats.push(beat); } };
  voice.beats.forEach(beat => {
    add(beat);
    beat.graceGroup?.beats.forEach(add);
  });
  return beats;
}

export function buildSelectionTargets(score: model.Score): SelectionTarget[] {
  const targets: SelectionTarget[] = [];
  score.tracks.forEach(track => track.staves.forEach(staff => staff.bars.forEach(bar => bar.voices.forEach(voice => {
    uniqueBeats(voice).forEach(beat => {
      const occupiedStrings = new Set<number>();
      beat.notes.forEach(note => {
        const selection = selectionFromNote(note);
        if (selection.string !== null) occupiedStrings.add(selection.string);
        targets.push({ selection, beat, note });
      });
      // Every beat exposes all five tab-string positions as navigation and
      // insertion targets. A missing note is still a real place in the grid.
      for (let string = 1; string <= 5; string++) {
        if (!occupiedStrings.has(string)) targets.push({ selection: selectionFromBeat(beat, beat.isRest ? 'rest' : 'empty', string), beat, note: null });
      }
    });
  }))));
  return targets;
}

function sameLocation(a: ScoreSelection, b: ScoreSelection) {
  return a.track === b.track && a.staff === b.staff && a.measure === b.measure && a.event === b.event && a.voice === b.voice && a.graceIndex === b.graceIndex;
}

function sameSelectionIdentity(a: ScoreSelection, b: ScoreSelection) {
  return sameLocation(a, b) && a.string === b.string && a.kind === b.kind;
}

export function resolveSelectionTarget(score: model.Score, selection: ScoreSelection | null): SelectionTarget | null {
  if (!selection) return null;
  const targets = buildSelectionTargets(score);
  const exact = targets.find(target => {
    if (!sameLocation(target.selection, selection)) return false;
    if (selection.string !== null && target.selection.string !== selection.string) return false;
    if (selection.kind === 'note') return target.selection.kind === 'note';
    return target.selection.kind === selection.kind || target.selection.kind === 'note';
  });
  if (exact) return exact;
  const locationTarget = targets.find(target => sameLocation(target.selection, selection));
  if (!locationTarget) return null;
  if (selection.kind === 'empty') return { selection: { ...selection, noteId: null, fret: null }, beat: locationTarget.beat, note: null };
  return locationTarget;
}

function selectionSortKey(selection: ScoreSelection) {
  return [selection.track, selection.staff, selection.measure, selection.event, selection.voice, selection.graceIndex ?? -1];
}

function compareSelections(a: ScoreSelection, b: ScoreSelection) {
  const left = selectionSortKey(a); const right = selectionSortKey(b);
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return left[index] - right[index];
  return (a.string ?? 0) - (b.string ?? 0);
}
export type PlayerPreferences = {
  speed: number;
  volume: number;
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
    volume: 1,
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
  const point = elementPoint(page, event);
  return {
    x: point.x - page.clientLeft,
    y: pageTops[pageIndex] + point.y - page.clientTop,
    pageIndex,
  };
}

function elementPoint(element: HTMLElement, event: MouseEvent) {
  const bounds = element.getBoundingClientRect();
  // Browser zoom and CSS transforms change screen coordinates, while
  // alphaTab's bounds lookup stays in the element's layout coordinates.
  const scaleX = bounds.width / (element.offsetWidth || bounds.width) || 1;
  const scaleY = bounds.height / (element.offsetHeight || bounds.height) || 1;
  return { x: (event.clientX - bounds.left) / scaleX, y: (event.clientY - bounds.top) / scaleY };
}

function scorePoint(root: HTMLElement, event: MouseEvent, view: ScoreView) {
  if (view !== 'continuous') return paginatedPoint(root, event);
  const surface = root.querySelector<HTMLElement>('.at-surface');
  if (!surface) return null;
  return elementPoint(surface, event);
}

function clampTabString(value: number) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function editingStringRows(lookup: NonNullable<AlphaTabApi['boundsLookup']>, beat: model.Beat) {
  const samples: Array<{ string: number; y: number }> = [];
  const staff = beat.voice.bar.staff;
  for (const system of lookup.staffSystems) {
    // A model staff spans every system in the score; only the rendered row
    // containing this beat can supply its string coordinates.
    if (!system.bars.some(masterBar => masterBar.bars.some(bar => bar.beats.some(bounds => bounds.beat === beat)))) continue;
    for (const masterBar of system.bars) {
      for (const bar of masterBar.bars) {
        for (const beatBounds of bar.beats) {
          if (beatBounds.beat.voice.bar.staff !== staff || !beatBounds.notes) continue;
          for (const noteBounds of beatBounds.notes) {
            const modelString = noteBounds.note.string;
            if (modelString < 1 || modelString > 5) continue;
            samples.push({ string: 6 - modelString, y: noteBounds.noteHeadBounds.y + noteBounds.noteHeadBounds.h / 2 });
          }
        }
      }
    }
  }

  const rows = new Map<number, number[]>();
  samples.forEach(sample => rows.set(sample.string, [...(rows.get(sample.string) ?? []), sample.y]));
  const rowCenters = Array.from(rows, ([string, values]) => ({ string, y: values.reduce((sum, value) => sum + value, 0) / values.length }));
  if (rowCenters.length >= 2) {
    const meanString = rowCenters.reduce((sum, row) => sum + row.string, 0) / rowCenters.length;
    const meanY = rowCenters.reduce((sum, row) => sum + row.y, 0) / rowCenters.length;
    const denominator = rowCenters.reduce((sum, row) => sum + (row.string - meanString) ** 2, 0);
    const slope = denominator === 0 ? 0 : rowCenters.reduce((sum, row) => sum + (row.string - meanString) * (row.y - meanY), 0) / denominator;
    const intercept = meanY - slope * meanString;
    if (slope > 0.1) return { top: intercept + slope, spacing: slope };
  }
  if (rowCenters.length === 1) {
    // A single visible note still gives us a useful row origin. AlphaTab's
    // tab staff uses a stable line spacing, so extrapolate the other strings.
    const row = rowCenters[0];
    const beatBounds = lookup.findBeat(beat);
    const spacing = beatBounds && beatBounds.visualBounds.h > 0 ? beatBounds.visualBounds.h / 4 : 14;
    return { top: row.y - (row.string - 1) * spacing, spacing };
  }
  const beatBounds = lookup.findBeat(beat);
  if (beatBounds && beatBounds.visualBounds.h > 0) {
    const spacing = beatBounds.visualBounds.h / 4;
    return { top: beatBounds.visualBounds.y, spacing };
  }
  return { top: 0, spacing: 14 };
}

function editingStringAtY(lookup: NonNullable<AlphaTabApi['boundsLookup']>, beat: model.Beat, y: number) {
  const rows = editingStringRows(lookup, beat);
  return clampTabString((y - rows.top) / rows.spacing + 1);
}

export function createEditingStaffInteractionHandler(root: HTMLElement, api: AlphaTabApi, view: ScoreView, onSelection: (selection: ScoreSelection, extend: boolean) => void) {
  let dragStart: { x: number; y: number } | null = null;
  const selectionAt = (event: MouseEvent): ScoreSelection | null => {
    const point = scorePoint(root, event, view);
    const lookup = api.boundsLookup;
    if (!point || !lookup) return null;
    const beat = lookup.getBeatAtPos(point.x, point.y);
    if (!beat || !lookup.findBeat(beat)) return null;
    const note = lookup.getNoteAtPos(beat, point.x, point.y);
    if (note) {
      const source = note as model.Note & { playtabMappingReason?: string };
      return selectionFromNote(note, source.playtabMappingReason);
    }
    const string = editingStringAtY(lookup, beat, point.y);
    return selectionFromBeat(beat, beat.isRest ? 'rest' : 'empty', string);
  };
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const selection = selectionAt(event);
    if (!selection) return;
    event.preventDefault();
    // Resolve populated note heads here as well as through alphaTab's event.
    // SVG glyphs (clefs, stems, and labels) can sit above a note's text in the
    // DOM, so relying only on alphaTab's noteMouseDown event leaves real mouse
    // clicks unable to select an otherwise valid note.
    dragStart = { x: event.clientX, y: event.clientY };
    onSelection(selection, event.shiftKey);
  };
  const onMouseMove = (event: MouseEvent) => {
    if (!dragStart || (event.buttons & 1) === 0 || Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) < 6) return;
    const selection = selectionAt(event);
    if (!selection) return;
    event.preventDefault();
    onSelection(selection, true);
  };
  const onMouseUp = () => { dragStart = null; };
  root.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('mousemove', onMouseMove, true);
  window.addEventListener('mouseup', onMouseUp, true);
  return () => {
    root.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);
  };
}

export function createPaginatedInteractionHandlers(root: HTMLElement, api: AlphaTabApi, isEditing: () => boolean = () => false) {
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
    if (isEditing()) return;
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

export function Player({ score, preview, preferences, onPreferencesChange, editing = false, selection = null, passage = null, onSelectionChange, onPassageChange, onFretInput, onSelectionDelete, historyRevision = 0, sessionKey = 0, exportBlockedReason = null }: {
  score: Score;
  preview?: MusicXmlPreview | null;
  preferences?: PlayerPreferences;
  onPreferencesChange?: (changes: Partial<PlayerPreferences>) => void;
  editing?: boolean;
  selection?: ScoreSelection | null;
  passage?: PlaybackEndpoints | null;
  onSelectionChange?: (selection: ScoreSelection | null) => void;
  onPassageChange?: (passage: PlaybackEndpoints | null) => void;
  onFretInput?: (selection: ScoreSelection, fret: number, group?: string) => void;
  exportBlockedReason?: string | null;
  onSelectionDelete?: (selection: ScoreSelection) => void;
  historyRevision?: number;
  sessionKey?: number;
}) {
  const defaults = preferences ?? defaultPlayerPreferences();
  const element = useRef<HTMLDivElement>(null);
  const scoreViewport = useRef<HTMLDivElement>(null);
  const scorePaper = useRef<HTMLElement>(null);
  const lyricsSection = useRef<HTMLElement>(null);
  const exportDialog = useRef<HTMLDialogElement>(null);
  const api = useRef<AlphaTabApi | null>(null);
  const renderedDocument = useRef<{ score: Score; preview: MusicXmlPreview | null } | null>(null);
  const editingRef = useRef(editing);
  const selectionRef = useRef<ScoreSelection | null>(selection);
  const passageRef = useRef<PlaybackEndpoints | null>(passage);
  const selectionCallbackRef = useRef(onSelectionChange);
  const passageCallbackRef = useRef(onPassageChange);
  const fretInputCallbackRef = useRef(onFretInput);
  const selectionDeleteCallbackRef = useRef(onSelectionDelete);
  const fretInputRef = useRef('');
  const fretInputSelectionRef = useRef('');
  const fretGroup = useRef(0);
  const previousHistoryRevision = useRef(historyRevision);
  const previousSessionKey = useRef(sessionKey);
  const [playbackEndpoints, setPlaybackEndpoints] = useState<PlaybackEndpoints | null>(null);
  const playbackEndpointsRef = useRef<PlaybackEndpoints | null>(null);
  const usingLinearMidi = useRef(false);
  const [updatingScore, setUpdatingScore] = useState(false);
  const [playbackMessage, setPlaybackMessage] = useState('');
  playbackEndpointsRef.current = playbackEndpoints;
  if (previousHistoryRevision.current !== historyRevision) {
    previousHistoryRevision.current = historyRevision;
    fretInputRef.current = '';
    fretInputSelectionRef.current = '';
    fretGroup.current++;
  }
  editingRef.current = editing;
  selectionRef.current = selection;
  passageRef.current = passage;
  selectionCallbackRef.current = onSelectionChange;
  passageCallbackRef.current = onPassageChange;
  fretInputCallbackRef.current = onFretInput;
  selectionDeleteCallbackRef.current = onSelectionDelete;
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [audioRetryRevision, setAudioRetryRevision] = useState(0);
  const [exportNotice, setExportNotice] = useState('');
  const [speed, setSpeed] = useState(defaults.speed);
  const [volume, setVolume] = useState(defaults.volume);
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
  const currentPreview = preview ?? null;
  const previewMode = currentPreview !== null;
  useEffect(() => {
    if (previousSessionKey.current === sessionKey) return;
    previousSessionKey.current = sessionKey;
    playbackEndpointsRef.current = null;
    usingLinearMidi.current = false;
    setPlaybackEndpoints(null);
    setPlaybackMessage('');
  }, [sessionKey]);
  useLayoutEffect(() => {
    const narrowScreen = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 800px)').matches;
    setPlaybackHost(narrowScreen ? null : document.getElementById('playback-controls'));
  }, []);
  // Renderer configuration changes need a new instance; score edits do not.
  useEffect(() => {
    setReady(false); setPlaying(false); setRendered(false); setError(''); setExportNotice('');
    setPosition({ currentTime: 0, endTime: 0 });
    const base = '/notation/';
    const layoutMode = scoreView !== 'continuous' || scrollDirection !== 'horizontal' ? 'page' : 'horizontal';
    const instance = new AlphaTabApi(element.current!, {
      core: { fontDirectory: `${base}font/`, includeNoteBounds: true, useWorkers: !previewMode && !hideTabClef, enableLazyLoading: !previewMode && !hideTabClef },
      display: { scale: 1.1, barsPerRow, layoutMode },
      player: {
        enablePlayer: true, soundFont: `${base}soundfont/${soundFont.filename}`,
        // alphaTab's AudioWorklet output now passes the start/pause smoke
        // tests and avoids the legacy ScriptProcessor scheduling path.
        outputMode: PlayerOutputMode.WebAudioAudioWorklets,
        enableCursor: true, enableUserInteraction: !editingRef.current,
        scrollElement: scrollDirection === 'horizontal' ? (scoreViewport.current ?? 'html') : 'html',
      },
    });
    api.current = instance;
    const selectNote = (note: model.Note) => {
      if (editingRef.current) {
        fretInputRef.current = '';
        element.current?.focus({ preventScroll: true });
        const source = note as model.Note & { playtabMappingReason?: string };
        selectionCallbackRef.current?.(selectionFromNote(note, source.playtabMappingReason));
      }
    };
    const selectBeat = (beat: model.Beat) => {
      if (editingRef.current && beat.notes.length === 0) {
        element.current?.focus({ preventScroll: true });
        selectionCallbackRef.current?.(selectionFromBeat(beat));
      }
    };
    const detachNoteMouseDown = instance.noteMouseDown?.on(selectNote);
    const detachBeatMouseDown = instance.beatMouseDown?.on(selectBeat);
    const detachEditingStaffInteraction = createEditingStaffInteractionHandler(element.current!, instance, scoreView, (selection, extend) => {
      if (editingRef.current) {
        fretInputRef.current = '';
        element.current?.focus({ preventScroll: true });
        if (extend && selectionRef.current) {
          const anchor = passageRef.current?.start ?? selectionRef.current;
          passageCallbackRef.current?.(compareSelections(anchor, selection) <= 0 ? { start: anchor, end: selection } : { start: selection, end: anchor });
        } else passageCallbackRef.current?.(null);
        selectionCallbackRef.current?.(selection);
      }
    });
    let detachPaginatedInteraction: (() => void) | undefined;
    let detachPaginatedSelection: (() => void) | undefined;
    if (scoreView !== 'continuous') {
      instance.customCursorHandler = createPaginatedCursorHandler(element.current!);
      detachPaginatedInteraction = createPaginatedInteractionHandlers(element.current!, instance, () => editingRef.current);
      detachPaginatedSelection = instance.playbackRangeHighlightChanged.on(event => {
        mapPaginatedSelection(element.current!, event.highlightBlocks ?? []);
      });
    }
    if (scoreView !== 'continuous' && scrollDirection === 'horizontal') instance.customScrollHandler = createHorizontalPageScrollHandler(element.current!, scoreViewport.current!);
    instance.playbackSpeed = speed;
    instance.masterVolume = volume;
    instance.isLooping = loop;
    instance.metronomeVolume = metronome ? 0.6 : 0;
    instance.playerReady.on(() => setReady(true));
    instance.playerStateChanged.on(event => setPlaying(event.state === 1));
    instance.playerPositionChanged.on(event => setPosition({ currentTime: event.currentTime, endTime: event.endTime }));
    instance.renderFinished.on(() => {
      setRendered(true);
      const activeRange = playbackEndpointsRef.current;
      if (activeRange && instance.score) {
        const ticks = writtenPlaybackRange(instance.score, activeRange);
        if (ticks) {
          usingLinearMidi.current = scoreHasRepeats(instance.score);
          if (usingLinearMidi.current) instance.player?.loadMidiFile(linearAuditionMidi(instance.score));
          instance.playbackRange = ticks;
          instance.tickPosition = ticks.startTick;
        } else {
          playbackEndpointsRef.current = null;
          setPlaybackEndpoints(null);
          instance.playbackRange = null;
        }
      }
      setUpdatingScore(false);
      const surface = element.current?.querySelector('.at-surface');
      const finishLayout = () => {
        if (scoreView !== 'continuous' && surface instanceof HTMLElement) paginateAlphaTabSurface(surface, scoreView, scrollDirection === 'horizontal');
        renderSelectionOverlay();
      };
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(finishLayout);
      else finishLayout();
    });
    instance.error.on(error => setError(error.message || 'Notation or audio could not load.'));
    renderDocument(instance, score, currentPreview, showChordDiagrams, hideTabClef);
    renderedDocument.current = { score, preview: currentPreview };
    return () => {
      if (typeof detachNoteMouseDown === 'function') detachNoteMouseDown();
      if (typeof detachBeatMouseDown === 'function') detachBeatMouseDown();
      detachEditingStaffInteraction();
      detachPaginatedInteraction?.();
      detachPaginatedSelection?.();
      instance.destroy();
      api.current = null;
      renderedDocument.current = null;
    };
  }, [previewMode, scoreView, barsPerRow, scrollDirection, showChordDiagrams, hideTabClef, soundFont, audioRetryRevision]);

  // Keep the existing surface mounted so the document height cannot collapse on each edit.
  useLayoutEffect(() => {
    const instance = api.current;
    const previous = renderedDocument.current;
    if (!instance || (previous?.score === score && previous.preview === currentPreview)) return;
    instance.pause();
    instance.stop();
    setPlaying(false);
    setUpdatingScore(true);
    setPlaybackMessage('Score updated. Press Play to listen.');
    renderDocument(instance, score, currentPreview, showChordDiagrams, hideTabClef, true);
    renderedDocument.current = { score, preview: currentPreview };
  }, [score, currentPreview, showChordDiagrams, hideTabClef]);

  useEffect(() => {
    if (api.current) api.current.settings.player.enableUserInteraction = !editing;
  }, [editing]);

  function renderRangeOverlay(endpoints: PlaybackEndpoints | null, className: string) {
    const root = element.current;
    if (!root) return;
    root.querySelectorAll(`.${className}`).forEach(node => node.remove());
    const instance = api.current;
    if (!editingRef.current || !instance?.score || !endpoints || !instance.boundsLookup) return;
    const range = writtenPlaybackRange(instance.score, endpoints);
    const surface = root.querySelector<HTMLElement>('.at-surface');
    if (!range || !surface) return;
    const seen = new Set<number>();
    for (const bar of instance.score.tracks[0]?.staves[0]?.bars ?? []) {
      for (const voice of bar.voices) for (const beat of voice.beats) {
        if (seen.has(beat.id)) continue;
        seen.add(beat.id);
        const start = instance.score.masterBars[bar.index].start + beat.playbackStart;
        if (start >= range.endTick || start + beat.playbackDuration <= range.startTick) continue;
        const bounds = instance.boundsLookup.findBeat(beat)?.visualBounds;
        if (!bounds) continue;
        const page = scoreView === 'continuous' ? { x: 0, y: bounds.y } : paginatedCursorPosition(root, bounds.y);
        const overlay = document.createElement('div');
        overlay.className = className;
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.left = `${bounds.x + page.x}px`;
        overlay.style.top = `${page.y}px`;
        overlay.style.width = `${bounds.w}px`;
        overlay.style.height = `${bounds.h}px`;
        surface.append(overlay);
      }
    }
  }

  function renderSelectionOverlay() {
    const root = element.current;
    const currentApi = api.current;
    const currentSelection = selectionRef.current;
    if (!root) return;
    renderRangeOverlay(playbackEndpointsRef.current, 'editor-playback-selection');
    renderRangeOverlay(passageRef.current, 'editor-passage-selection');
    root.querySelectorAll('.editor-note-selection').forEach(node => node.remove());
    if (!editingRef.current || !currentApi || !currentSelection) return;
    const renderedScore = currentApi.score;
    const target = renderedScore ? resolveSelectionTarget(renderedScore, currentSelection) : null;
    if (!target) return;
    const lookup = currentApi.boundsLookup;
    const beatBounds = lookup?.findBeat(target.beat);
    if (!beatBounds) return;
    const noteBounds = target.note && beatBounds.notes?.find(item => item.note === target.note || item.note.id === target.note?.id);
    const bounds = noteBounds?.noteHeadBounds ?? { ...beatBounds.visualBounds };
    if (!noteBounds && currentSelection.string !== null && lookup) {
      const rows = editingStringRows(lookup, target.beat);
      const cellHeight = Math.max(12, rows.spacing - 2);
      bounds.y = rows.top + (currentSelection.string - 1) * rows.spacing - cellHeight / 2;
      bounds.h = cellHeight;
      bounds.x = beatBounds.onNotesX;
      bounds.w = 14;
    }
    const surface = root.querySelector<HTMLElement>('.at-surface') ?? root;
    const position = scoreView === 'continuous' ? { x: 0, y: bounds.y } : paginatedCursorPosition(root, bounds.y);
    if (noteBounds && target.note) {
      // The rendered SVG text, not alphaTab's shared chord bounds, determines
      // the actual white interruption in the staff line for each fret.
      const surfaceRect = surface.getBoundingClientRect();
      const scaleX = surfaceRect.width / (surface.offsetWidth || surfaceRect.width) || 1;
      const scaleY = surfaceRect.height / (surface.offsetHeight || surfaceRect.height) || 1;
      const expectedX = surfaceRect.left + (beatBounds.onNotesX + position.x) * scaleX;
      const expectedY = surfaceRect.top + (position.y + bounds.h / 2) * scaleY;
      const selectedFret = String(target.note.fret);
      const glyph = Array.from(surface.querySelectorAll<SVGTextElement>('svg text'))
        .filter(item => item.textContent?.trim() === selectedFret)
        .map(item => ({ item, rect: item.getBoundingClientRect() }))
        .sort((a, b) => Math.abs(a.rect.x + a.rect.width / 2 - expectedX) + Math.abs(a.rect.y + a.rect.height / 2 - expectedY)
          - Math.abs(b.rect.x + b.rect.width / 2 - expectedX) - Math.abs(b.rect.y + b.rect.height / 2 - expectedY))[0];
      if (glyph && Math.abs(glyph.rect.x + glyph.rect.width / 2 - expectedX) < 20 * scaleX
        && Math.abs(glyph.rect.y + glyph.rect.height / 2 - expectedY) < 10 * scaleY) {
        const textBounds = glyph.item.getBBox();
        const frame = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        frame.setAttribute('class', 'editor-note-selection editor-note-selection-svg');
        frame.setAttribute('aria-hidden', 'true');
        frame.setAttribute('data-note-id', String(target.note.id));
        frame.setAttribute('x', String(textBounds.x - 2));
        frame.setAttribute('y', String(textBounds.y - 1));
        frame.setAttribute('width', String(textBounds.width + 4));
        frame.setAttribute('height', String(textBounds.height + 2));
        frame.setAttribute('rx', '2');
        glyph.item.parentNode?.insertBefore(frame, glyph.item.parentNode.firstChild);
        return;
      }
    }
    const overlay = document.createElement('div');
    overlay.className = `editor-note-selection editor-note-selection-html${noteBounds ? ' editor-note-selection-html-note' : ' editor-note-selection-empty'}`;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.dataset.noteId = String(target.note?.id ?? '');
    overlay.style.left = `${bounds.x + position.x - (noteBounds ? 2 : bounds.w / 2)}px`;
    overlay.style.top = `${position.y - (noteBounds ? 1 : 0)}px`;
    overlay.style.width = `${noteBounds ? bounds.w + 4 : bounds.w}px`;
    overlay.style.height = `${noteBounds ? bounds.h + 2 : bounds.h}px`;
    surface.append(overlay);
  }

  function selectionTargetsForNavigation() {
    return api.current?.score ? buildSelectionTargets(api.current.score).sort((a, b) => compareSelections(a.selection, b.selection)) : [];
  }

  function navigateSelection(direction: 'left' | 'right' | 'up' | 'down') {
    fretInputRef.current = '';
    const current = selectionRef.current;
    if (!editingRef.current || !current) return;
    const targets = selectionTargetsForNavigation();
    if (targets.length === 0) return;
    const sameEvent = (target: SelectionTarget) => sameLocation(target.selection, current);
    if (direction === 'up' || direction === 'down') {
      const currentString = current.string ?? 1;
      const nextString = Math.max(1, Math.min(5, currentString + (direction === 'up' ? -1 : 1)));
      const candidates = targets.filter(target => sameEvent(target) && target.selection.string === nextString);
      const nearest = candidates[0] ?? targets.filter(target => sameEvent(target) && target.selection.string !== null)
        .sort((a, b) => Math.abs((a.selection.string ?? 1) - nextString) - Math.abs((b.selection.string ?? 1) - nextString))[0];
      selectionCallbackRef.current?.(nearest?.selection ?? { ...current, noteId: null, fret: null, string: nextString, kind: 'empty' });
      return;
    }
    const orderedLocations = targets.filter(target => target.selection.track === current.track && target.selection.staff === current.staff && target.selection.voice === current.voice)
      .reduce<SelectionTarget[]>((events, target) => {
        if (!events.some(existing => sameLocation(existing.selection, target.selection))) events.push(target);
        return events;
      }, []);
    const currentIndex = orderedLocations.findIndex(target => sameLocation(target.selection, current));
    const step = direction === 'right' ? 1 : -1;
    const nextLocation = orderedLocations[currentIndex + step];
    if (!nextLocation) return;
    const sameString = current.string === null ? null : targets.find(target => sameLocation(target.selection, nextLocation.selection) && target.selection.string === current.string);
    selectionCallbackRef.current?.((sameString ?? nextLocation).selection);
  }

  function handleEditorKeyDown(event: { key: string; preventDefault: () => void }) {
    if (!editingRef.current) return;
    const key = event.key.toLowerCase();
    if (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown') {
      event.preventDefault();
      navigateSelection(key.slice(5) as 'left' | 'right' | 'up' | 'down');
      return;
    }
    if (key === 'backspace' || key === 'delete') {
      const current = selectionRef.current;
      if (!current) return;
      event.preventDefault();
      fretInputRef.current = '';
      fretInputSelectionRef.current = '';
      selectionDeleteCallbackRef.current?.(current);
      return;
    }
    if (/^[0-9]$/.test(event.key)) {
      const current = selectionRef.current;
      if (!current || current.string === null) return;
      event.preventDefault();
      const identity = `${current.track}:${current.staff}:${current.measure}:${current.event}:${current.voice}:${current.graceIndex ?? ''}:${current.string}`;
      if (fretInputSelectionRef.current !== identity || fretInputRef.current.length === 2) fretInputRef.current = '';
      if (!fretInputRef.current) fretGroup.current++;
      const nextBuffer = `${fretInputRef.current}${event.key}`.slice(0, 2);
      const fret = Number(nextBuffer);
      if (fret <= 22) {
        fretInputRef.current = nextBuffer;
        fretInputSelectionRef.current = identity;
        fretInputCallbackRef.current?.(current, fret, `fret-${fretGroup.current}`);
      }
    }
  }

  useEffect(() => {
    // Capture before alphaTab's canvas handlers so a redraw or canvas focus
    // cannot swallow the selected target's editing keys.
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!editingRef.current) return;
      const target = event.target instanceof HTMLElement ? event.target : document.activeElement;
      if (target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return;
      handleEditorKeyDown(event);
    };
    document.addEventListener('keydown', onDocumentKeyDown, true);
    return () => document.removeEventListener('keydown', onDocumentKeyDown, true);
  }, []);

  useEffect(() => {
    if (editing && selection && api.current?.score) {
      const target = resolveSelectionTarget(api.current.score, selection);
      if (target && !sameSelectionIdentity(selection, target.selection)) selectionCallbackRef.current?.(target.selection);
    }
    if (!editing || !selection) {
      renderSelectionOverlay();
      return;
    }
    const update = () => renderSelectionOverlay();
    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(update);
      return () => window.cancelAnimationFrame(frame);
    }
    update();
  }, [editing, selection, passage, playbackEndpoints, scoreView, scrollDirection]);

  const baseTempo = preview?.score.tempo ?? score.tempo;
  const maxPlaybackSpeed = Math.max(
    DEFAULT_MAX_PLAYBACK_SPEED,
    Math.ceil((MAX_PLAYBACK_BPM / baseTempo) / PLAYBACK_SPEED_STEP) * PLAYBACK_SPEED_STEP,
  );
  function playSelection() {
    const instance = api.current;
    const endpoints = passage ?? (selection ? { start: selection, end: selection } : null);
    if (!instance?.score || !endpoints || !ready || updatingScore) return;
    const ticks = writtenPlaybackRange(instance.score, endpoints);
    if (!ticks) { setError('The selected passage cannot be mapped to playable score events.'); return; }
    if (playing) instance.stop();
    usingLinearMidi.current = scoreHasRepeats(instance.score);
    if (usingLinearMidi.current) instance.player?.loadMidiFile(linearAuditionMidi(instance.score));
    instance.playbackRange = ticks;
    instance.tickPosition = ticks.startTick;
    playbackEndpointsRef.current = endpoints;
    setPlaybackEndpoints(endpoints);
    setPlaybackMessage('');
    instance.play();
  }
  function clearPlaybackRange() {
    const instance = api.current;
    if (instance) {
      if (usingLinearMidi.current) instance.stop();
      instance.playbackRange = null;
      if (usingLinearMidi.current) instance.loadMidiForScore();
    }
    usingLinearMidi.current = false;
    playbackEndpointsRef.current = null;
    setPlaybackEndpoints(null);
  }
  function restartPlayback() {
    const instance = api.current;
    if (!instance) return;
    instance.stop();
    const ticks = playbackEndpoints && instance.score ? writtenPlaybackRange(instance.score, playbackEndpoints) : null;
    instance.tickPosition = ticks?.startTick ?? 0;
  }
  const transport = { ready: ready && !error, updating: updatingScore, playing, ...position, onRestart: restartPlayback,
    onPlayPause: () => updatingScore ? api.current?.pause() : api.current?.playPause() };
  const playbackPanel = <section className="playback-panel" aria-label="Playback settings">
    <div className="sidebar-section playback-heading">PLAYBACK</div>
    <PlaybackTransport {...transport} ariaLabel="Playback controls" />
    {editing && <div className="audition-controls" aria-label="Selection playback">
      <button type="button" disabled={!selection || !ready || updatingScore || Boolean(error)} onClick={playSelection}>Play selection</button>
      <button type="button" disabled={!playbackEndpoints} onClick={clearPlaybackRange}>Clear playback range</button>
      {passage && <span className="audition-range">Passage: M{passage.start.measure} E{passage.start.event}–M{passage.end.measure} E{passage.end.event}</span>}
      {playbackEndpoints && <span className="audition-range">Playing range: M{playbackEndpoints.start.measure} E{playbackEndpoints.start.event}–M{playbackEndpoints.end.measure} E{playbackEndpoints.end.event}</span>}
      {updatingScore && <span role="status">Updating score</span>}
      {playbackMessage && <span role="status">{playbackMessage}</span>}
    </div>}
    {error && <button type="button" className="retry-audio" onClick={() => { setError(''); setAudioRetryRevision(value => value + 1); }}>Retry audio</button>}
    <label className="speed-control">
      <span className="speed-value">{Math.round(baseTempo * speed)} <span>BPM</span></span>
      <input aria-label="Playback speed" type="range" min="0.25" max={maxPlaybackSpeed} step={PLAYBACK_SPEED_STEP} value={speed} onChange={e => { const value = Number(e.target.value); setSpeed(value); onPreferencesChange?.({ speed: value }); if (api.current) api.current.playbackSpeed = value; }} />
      <small>{Math.round(speed * 100)}%</small>
    </label>
    <label className="volume-control">
      <span className="volume-value">Volume <small>{Math.round(volume * 100)}%</small></span>
      <input aria-label="Playback volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={e => { const value = Number(e.target.value); setVolume(value); onPreferencesChange?.({ volume: value }); if (api.current) api.current.masterVolume = value; }} />
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
  // Exports always come from the current rendered draft, so they wait for
  // a finished render and for any pending input to be applied.
  const exportBlocked = exportBlockedReason ?? (rendered ? null : 'Export is available once the score finishes rendering.');
  function confirmExport() {
    closeExportDialog();
    if (exportBlocked) { setError(exportBlocked); return; }
    exportFile(exportFormat);
  }
  function exportFile(format: string) {
    setError(''); setExportNotice('');
    if (format === 'tef2' || format === 'tef3') {
      void exportTef(format).catch(e => setError((e as Error).message));
      return;
    }
    try {
      // alphaTab stores titles with non-breaking spaces; filenames use plain ones.
      if (preview && format === 'musicxml') download(preview.source, `${preview.score.title.replaceAll('\u00a0', ' ')}.musicxml`, 'application/vnd.recordare.musicxml+xml');
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
        {exportBlocked && <span className="export-blocked" id="export-blocked-reason">{exportBlocked}</span>}
        <button type="button" className="primary export-button" aria-haspopup="dialog" disabled={Boolean(exportBlocked)}
          aria-describedby={exportBlocked ? 'export-blocked-reason' : undefined} onClick={openExportDialog}>Export</button>
      </div>
    </div>
    {error && <p className="alert" role="alert">{error}</p>}
    {exportNotice && <p className="success export-notice" role="status">{exportNotice}</p>}
    <div ref={scoreViewport} className={`score-viewport score-viewport-${scrollDirection}`}>
    <section ref={scorePaper} id="tab-score" role="tabpanel" aria-labelledby="tab-tablature" className={`score-paper score-paper-${scoreView} score-paper-${scrollDirection}${scoreView !== 'continuous' ? ' score-paper-paginated' : ''}`} aria-label="Banjo tablature" hidden={activeView !== 'tablature'}>
      <div className="paper-topline"><span>PLAYTAB / {preview ? 'IMPORT PREVIEW' : 'PRACTICE SERIES'}</span><span>{preview ? preview.tuningLabel : 'OPEN G · 4/4'}</span></div>
      {!rendered && <p className="loading">Setting out your music…</p>}
      <div ref={element} data-testid="notation" tabIndex={editing ? 0 : -1} />
      <div className="paper-footer">Take it slowly. Let every note ring.</div>
    </section>
    </div>
    {preview?.lyricsSection && <section ref={lyricsSection} id="tab-lyrics-content" role="tabpanel" aria-labelledby="tab-lyrics" className="lyrics-section" aria-label="Lyrics and chords" hidden={activeView !== 'lyrics'}>
      <h2>Lyrics &amp; chords</h2>
      <pre style={{ columnCount: lyricsColumns }}>{preview.lyricsSection}</pre>
    </section>}
    {showPlayerTips && <aside className="player-tips" role="note" aria-label="Playback tips">
      <p className="player-hint">{editing ? 'Click a note or empty string position to select it. Use the arrow keys to move, numbers to enter a fret, and Backspace to remove a note.' : 'Click a note to seek. Drag across notes to select a practice range, then turn on Loop.'}</p>
      {preview && <p className="player-hint">Audio preview: imported hammer-ons and pull-offs use held-note articulation; slides and bends retain their pitch movement.</p>}
      <button type="button" className="tip-dismiss" aria-label="Dismiss playback tips" onClick={() => setShowPlayerTips(false)}>×</button>
    </aside>}
    <dialog ref={exportDialog} className="export-dialog" aria-labelledby="export-dialog-title">
      <div className="dialog-heading"><div><div className="eyebrow">SAVE OR SHARE YOUR TAB</div><h2 id="export-dialog-title">Export score</h2></div><button type="button" className="icon-button" aria-label="Close export" onClick={closeExportDialog}>×</button></div>
      <p>Choose an output format. The current view and layout settings will be used for PDF export.</p>
      <label className="export-format-label">Format<select aria-label="Export format" value={exportFormat} onChange={e => setExportFormat(e.target.value)}>
        <option value="pdf">Print / save PDF</option><option value="midi">MIDI (.mid)</option><option value="tef2">TEF2 (.tef)</option><option value="tef3">TablEdit TEF3 (.tef)</option>{preview ? <option value="musicxml">MusicXML (.musicxml)</option> : <><option value="txt">Plaintext (.txt)</option><option value="json">Playtab (.json)</option></>}
      </select></label>
      <div className="dialog-footer"><button type="button" onClick={closeExportDialog}>Cancel</button><button type="button" className="primary" disabled={Boolean(exportBlocked)} onClick={confirmExport}>Export file</button></div>
    </dialog>
  </>;
}
