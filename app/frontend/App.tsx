import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { defaultPlayerPreferences, Player, type ContextMenuRequest, type PlayerControls, type PlayerPreferences, type ScoreSelection } from './Player';
import { demo, isImportedScoreDocument, validateScore, validateStoredScore, type ImportedScoreDocument, type Score, type StoredScore } from './music/score';
import { exportAscii, parseAscii } from './music/ascii';
import { createBlankMusicXml, OPEN_G_TUNING, promoteNativeScore, readMusicXml, toImportedScoreDocument, type MusicXmlPreview } from './music/musicxml';
import { addMusicXmlEndings, cutMusicXmlMeasures, copyMusicXmlMeasures, pasteMusicXmlMeasures, connectMusicXmlTransition, inspectMusicXmlTransitions, removeMusicXmlTransition, applyMusicXmlScoreSettings, inspectMusicXmlScoreSettings, inspectMusicXmlTempo, setMusicXmlLocalTempo, TEMPO_LIMITS, TUNING_LIMITS, inspectMusicXmlLyrics, LYRIC_VERSES, setMusicXmlLyric, setMusicXmlStandaloneLyrics, STANDALONE_LYRICS_LIMIT, ANCHOR_TEXT_LIMIT, changeMusicXmlAnchor, chordSpellingName, inspectMusicXmlAnchor, inspectMusicXmlNoteTechniques, setMusicXmlBend, setMusicXmlHand, applyMusicXmlGraceGroup, inspectMusicXmlGraceGroup, removeMusicXmlGraceGroup, addMusicXmlNote, addMusicXmlRepeat, applyMusicXmlEdits, removeMusicXmlGrace, changeMusicXmlDuration, changeMusicXmlMeter, changeMusicXmlPickup, connectMusicXmlTie, createMusicXmlTriplet, insertMusicXmlEvent,
  deleteMusicXmlMeasure, duplicateMusicXmlMeasure, inspectMusicXmlDuration, inspectMusicXmlMeterRange, inspectMusicXmlRepeatEndings, inspectMusicXmlRepeats, inspectMusicXmlTie, inspectMusicXmlTriplet, insertMusicXmlMeasure, musicXmlEditorState,
  removeMusicXmlNotes, removeMusicXmlRepeat, removeMusicXmlTie, removeMusicXmlTriplet, sourceTabNoteRecords,
  type MeasureClipboard, type MeasureCut, type PasteMode, type NoteTransition, type TransitionKind, type LocalTempoInfo, type ScoreSettingsInfo, type TuningMode, type EventLyric, type LyricSyllabic, type AnchorItem, type AnchorKind, type ChordQuality, type ChordRoot, type ChordSpelling, type BendAmount, type FrettingHand, type NoteBend, type NoteTechniqueInfo, type PickingHand, type GraceEventSpec, type GraceTransition, type RepeatEndings, type RepeatRegion, type TiePosition } from './music/musicxml-editor';
import { documentKey, emptyHistory, record, travel, type Snapshot } from './editor/history';
import { DURATION_DENOMINATORS, type DurationDenominator } from './editor/rhythm';
import type { PlaybackEndpoints } from './editor/audition';
import { sourceEventCount, type IdentityCarry, type SourceIdentityMap } from './music/source-identity';
import { readSourceDocument } from './music/xml-cache';

function rangeDescription(passage: PlaybackEndpoints, whole: { first: number; last: number } | null) {
  if (whole) return whole.first === whole.last ? `Measure ${whole.first} selected` : `Measures ${whole.first}–${whole.last} selected`;
  const { start, end } = passage;
  return `M${start.measure} E${start.event} – M${end.measure} E${end.event} selected`;
}

type LibraryItem = { id: number; title: string; revision?: number };
type RemovalMode = 'note' | 'rest' | 'grace';
type PendingRemoval = { beforeSource: string; afterSource: string; selection: ScoreSelection; mode: RemovalMode; dependencies: string[] };
type PendingDuplication = { originalKey: string; base: MusicXmlPreview; source: string; measureIndex: number;
  excluded: string[]; noteCount: number; restCount: number };
type PendingMeasureDeletion = { originalKey: string; base: MusicXmlPreview; source: string; measureIndex: number;
  noteCount: number; restCount: number; labelCount: number };
type MeterTarget = { originalKey: string; base: MusicXmlPreview; measureIndex: number };
type PickupTarget = { originalKey: string; base: MusicXmlPreview };
type RepeatTarget = { originalKey: string; base: MusicXmlPreview; measure: number };
type RepeatRemoval = RepeatTarget & { region: RepeatRegion; endings: RepeatEndings | null };
type GraceTarget = { originalKey: string; base: MusicXmlPreview; selection: ScoreSelection; destination: number; first: number;
  existing: boolean; readOnly: string[]; connections: string[]; initialEvents: GraceEventSpec[] };
type BendTarget = { originalKey: string; selection: ScoreSelection; existing: NoteBend | 'none' | null; reason?: string };
type AnchorTarget = { originalKey: string; base: MusicXmlPreview; selection: ScoreSelection; kind: AnchorKind; items: AnchorItem[] };
type LyricTarget = { originalKey: string; base: MusicXmlPreview; selection: ScoreSelection; lyrics: EventLyric[] };
type StandaloneTarget = { originalKey: string; base: MusicXmlPreview };
type SettingsTarget = { originalKey: string; base: MusicXmlPreview; info: ScoreSettingsInfo };
type TempoTarget = { originalKey: string; base: MusicXmlPreview; selection: ScoreSelection; info: LocalTempoInfo };
type PasteTarget = { originalKey: string; base: MusicXmlPreview; measure: number; replaceFrom: number | null; replaceCount: number };
type CutTarget = { originalKey: string; base: MusicXmlPreview; first: number; last: number; cut: Pick<MeasureCut, 'source' | 'notes' | 'labels' | 'lyrics' | 'spans'> & { clipboard?: MeasureClipboard };
  mode?: 'cut' | 'clear'; label?: string };
type PendingTie = { originalKey: string; base: MusicXmlPreview; origin: ScoreSelection; kind: TransitionKind };
type SessionSnapshot = { document: StoredScore; original: string | null; diagnostics: string[]; id: number | null; revision: number | null };
import { AnchorDialog } from './editor/dialogs/AnchorDialog';
import { DeleteMeasureDialog, DuplicateMeasureDialog, RepeatRemovalDialog } from './editor/dialogs/ConfirmMeasureDialogs';
import { MeterDialog, type MeterCandidate } from './editor/dialogs/MeterDialog';
import { PickupDialog } from './editor/dialogs/PickupDialog';
import { RepeatDialog, type RepeatDraft } from './editor/dialogs/RepeatDialog';
import { GraceDialog } from './editor/dialogs/GraceDialog';
import { NewScoreDialog, type NewScoreDraft } from './editor/dialogs/NewScoreDialog';
import { PasteDialog } from './editor/dialogs/PasteDialog';
import { SettingsDialog, type SettingsDraft } from './editor/dialogs/SettingsDialog';
import { BendDialog } from './editor/dialogs/BendDialog';
import { LyricDialog } from './editor/dialogs/LyricDialog';
import { CutDialog } from './editor/dialogs/CutDialog';
import { KeyboardHelpDialog } from './editor/dialogs/KeyboardHelpDialog';
import { StandaloneTextDialog } from './editor/dialogs/StandaloneTextDialog';
import { TempoDialog } from './editor/dialogs/TempoDialog';
import { CommandGroup, type EditorCommand, type EditorCommands } from './editor/commands';
import { SelectionInspector } from './editor/sidebar/SelectionInspector';
import { ContextMenu, type MenuEntry } from './editor/ContextMenu';
import { EditorToolbar } from './editor/EditorToolbar';
import { DURATION_COMMANDS, RhythmTools } from './editor/sidebar/RhythmTools';
import { TechniqueTools, TRANSITION_COMMANDS } from './editor/sidebar/TechniqueTools';
import { InsertEventDialog, type InsertEventDraft } from './editor/dialogs/InsertEventDialog';
import { ConflictDialog, DiscardDialog, LeaveDialog, RemovalDialog, SaveCopyDialog } from './editor/dialogs/SessionDialogs';
import { ANCHOR_NAMES, BEND_LABELS, capitalized, CHORD_QUALITIES, CHORD_STEPS, DEFAULT_CHORD, midiName, TRANSITION_NAMES } from './editor/labels';
class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
const initialText = exportAscii(demo);
const userEmail = () => document.getElementById('playtab-root')?.dataset.userEmail ?? '';
function withPreviewTitle(preview: MusicXmlPreview, title: string): MusicXmlPreview {
  return { ...preview, score: Object.assign(Object.create(Object.getPrototypeOf(preview.score)), preview.score, { title }) };
}
function readImportedDocument(document: ImportedScoreDocument, sourceIdentity?: SourceIdentityMap) {
  return withPreviewTitle(readMusicXml(document.source, document.sourceName, document.sourceFormat,
    sourceIdentity ? { source: document.source, map: sourceIdentity } : undefined), document.title);
}
function structuralCarries(preview: MusicXmlPreview, selection: ScoreSelection, carryEvent = true): IdentityCarry[] {
  const measure = selection.measure - 1;
  const address = `${measure}:${selection.voice}:${selection.event - 1}`;
  const measureId = selection.sourceMeasureId ?? preview.sourceIdentity?.measureIds[measure];
  const eventId = selection.sourceEventId ?? preview.sourceEventIdByAddress?.get(address);
  return [
    ...(measureId ? [{ kind: 'measure' as const, id: measureId, address: String(measure) }] : []),
    ...(carryEvent && eventId ? [{ kind: 'event' as const, id: eventId, address }] : []),
  ];
}
function readdressMeasureCarries(preview: MusicXmlPreview, addressFor: (index: number) => number | null): IdentityCarry[] {
  if (!preview.sourceIdentity) return [];
  const measures: IdentityCarry[] = preview.sourceIdentity.measureIds.flatMap((id, index) => {
    const next = addressFor(index);
    return next === null ? [] : [{ kind: 'measure', id, address: String(next) }];
  });
  const events: IdentityCarry[] = [...(preview.sourceEventIdByAddress ?? new Map<string, string>())].flatMap(([address, id]) => {
    const separator = address.indexOf(':');
    const next = addressFor(Number(address.slice(0, separator)));
    return next === null ? [] : [{ kind: 'event', id, address: `${next}${address.slice(separator)}` }];
  });
  const notes = sourceTabNoteRecords(readSourceDocument(preview.source));
  const noteCarries: IdentityCarry[] = notes.flatMap((record, index) => {
    const next = addressFor(record.measure);
    return next === null ? [] : [{ kind: 'note', id: preview.sourceIdentity!.noteIds[index],
      address: record.id.replace(/^\d+:/, `${next}:`) }];
  });
  return [...measures, ...events, ...noteCarries];
}
function shiftedMeasureCarries(preview: MusicXmlPreview, insertionIndex: number): IdentityCarry[] {
  return readdressMeasureCarries(preview, index => index >= insertionIndex ? index + 1 : index);
}
function deletedMeasureCarries(preview: MusicXmlPreview, deletedIndex: number): IdentityCarry[] {
  return readdressMeasureCarries(preview, index => index === deletedIndex ? null : index > deletedIndex ? index - 1 : index);
}
function tiePosition(selection: ScoreSelection): TiePosition {
  return { measure: selection.measure - 1, beat: selection.event - 1, voice: selection.voice,
    string: selection.string!, fret: selection.fret! };
}
function refreshStructuralSelection(selection: ScoreSelection, preview: MusicXmlPreview) {
  selection.sourceMeasureId = preview.sourceIdentity?.measureIds[selection.measure - 1];
  selection.sourceEventId = preview.sourceEventIdByAddress?.get(`${selection.measure - 1}:${selection.voice}:${selection.event - 1}`);
}
function selectionAtPosition(current: ScoreSelection, score: Score, preview: MusicXmlPreview | null,
  changes: Partial<Pick<ScoreSelection, 'measure' | 'event' | 'voice' | 'string'>>): ScoreSelection {
  const measure = Math.max(1, Math.min(changes.measure ?? current.measure, preview?.score.masterBars.length ?? score.measures.length));
  const voice = changes.voice ?? current.voice;
  const importedBeats = preview?.score.tracks?.[0]?.staves?.[0]?.bars?.[measure - 1]?.voices?.[voice - 1]?.beats;
  const nativeBeats = preview ? undefined : score.measures[measure - 1]?.beats;
  const event = Math.max(1, Math.min(changes.event ?? current.event, importedBeats?.length ?? nativeBeats?.length ?? 1));
  const string = changes.string === undefined ? current.string : changes.string;
  const importedBeat = importedBeats?.[event - 1];
  const nativeBeat = nativeBeats?.[event - 1];
  const importedNote = importedBeat?.notes.find(item => string !== null && 6 - item.string === string);
  const nativeNote = nativeBeat?.notes.find(item => item.string === string);
  const kind = importedNote || nativeNote ? 'note' : importedBeat?.isRest || nativeBeat?.notes.length === 0 ? 'rest' : 'empty';
  const noteId = importedNote?.id ?? null;
  return { ...current, measure, event, voice, string, kind, noteId, fret: importedNote?.fret ?? nativeNote?.fret ?? null,
    graceIndex: importedBeat?.graceType ? importedBeat.graceIndex : null,
    graceGroupId: importedBeat?.graceGroup?.id ?? null,
    mappingReason: undefined,
    sourceId: noteId === null ? undefined : preview?.sourceIdByModelNoteId?.get(noteId),
    sourceMeasureId: preview?.sourceIdentity?.measureIds[measure - 1],
    sourceEventId: preview?.sourceEventIdByAddress?.get(`${measure - 1}:${voice}:${event - 1}`),
  };
}
async function apiRequest(path: string, options?: RequestInit) {
  const response = await fetch(path, { ...options, headers: {
    ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    'X-CSRF-Token': document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '',
    ...options?.headers,
  } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(typeof body.error === 'string' ? body.error : `Request failed (${response.status}).`, response.status);
  }
  return response.json();
}

export function App() {
  const [score, setScore] = useState<Score>(demo);
  const [preview, setPreview] = useState<MusicXmlPreview | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [conflicted, setConflicted] = useState(false);
  const [failedCopyName, setFailedCopyName] = useState<string | null>(null);
  const [copyTitle, setCopyTitle] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showWarnings, setShowWarnings] = useState(false);
  const [showPracticeTip, setShowPracticeTip] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [selection, setSelection] = useState<ScoreSelection | null>(null);
  const [passage, setPassage] = useState<PlaybackEndpoints | null>(null);
  // A fret draft belongs to the selection it was typed for. Keying it this
  // way means a new selection never inherits the previous note's draft, even
  // for the render before any effect runs.
  const selectionFretKey = selection ? `${selection.measure}:${selection.event}:${selection.voice}:${selection.graceIndex ?? ''}:${selection.string}:${selection.noteId}:${selection.fret}` : '';
  const selectionFretText = selection?.fret === null || selection?.fret === undefined ? '' : String(selection.fret);
  const [fretEdit, setFretEdit] = useState<{ key: string; value: string; buffer: boolean } | null>(null);
  const fretDraft = fretEdit?.key === selectionFretKey ? fretEdit.value : selectionFretText;
  const surfaceBuffer = fretEdit?.key === selectionFretKey && fretEdit.buffer;
  const setFretDraft = (value: string, buffer = false) => setFretEdit({ key: selectionFretKey, value, buffer });
  const [moveString, setMoveString] = useState('');
  const [moveMode, setMoveMode] = useState<'fret' | 'pitch'>('fret');
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [pendingDuplication, setPendingDuplication] = useState<PendingDuplication | null>(null);
  const [pendingMeasureDeletion, setPendingMeasureDeletion] = useState<PendingMeasureDeletion | null>(null);
  const [meterTarget, setMeterTarget] = useState<MeterTarget | null>(null);
  const meterOpener = useRef<HTMLElement | null>(null);
  const [repeatTarget, setRepeatTarget] = useState<RepeatTarget | null>(null);
  const [repeatRemovalError, setRepeatRemovalError] = useState('');
  const [repeatRemoval, setRepeatRemoval] = useState<RepeatRemoval | null>(null);
  const repeatOpener = useRef<HTMLElement | null>(null);
  const [graceTarget, setGraceTarget] = useState<GraceTarget | null>(null);
  const [anchorTarget, setAnchorTarget] = useState<AnchorTarget | null>(null);
  const anchorOpener = useRef<HTMLElement | null>(null);
  const [lyricTarget, setLyricTarget] = useState<LyricTarget | null>(null);
  const [standaloneTarget, setStandaloneTarget] = useState<StandaloneTarget | null>(null);
  const textOpener = useRef<HTMLElement | null>(null);
  const [newScoreOpen, setNewScoreOpen] = useState(false);
  const newScoreOpener = useRef<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 800px)').matches);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuRequest | null>(null);
  const playerControls = useRef<PlayerControls | null>(null);
  const [sheetTransportHost, setSheetTransportHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 800px)');
    const update = () => setNarrow(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  const [clipboard, setClipboard] = useState<MeasureClipboard | null>(null);
  const [pasteTarget, setPasteTarget] = useState<PasteTarget | null>(null);
  const [cutTarget, setCutTarget] = useState<CutTarget | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<SettingsTarget | null>(null);
  const [tempoTarget, setTempoTarget] = useState<TempoTarget | null>(null);
  const [bendTarget, setBendTarget] = useState<BendTarget | null>(null);
  const bendOpener = useRef<HTMLElement | null>(null);
  const graceOpener = useRef<HTMLElement | null>(null);
  const [pickupTarget, setPickupTarget] = useState<PickupTarget | null>(null);
  const [pendingTie, setPendingTie] = useState<PendingTie | null>(null);
  const pickupOpener = useRef<HTMLElement | null>(null);
  const duplicateOpener = useRef<HTMLElement | null>(null);
  const deleteMeasureOpener = useRef<HTMLElement | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const insertOpener = useRef<HTMLElement | null>(null);
  const leaveAction = useRef<(() => void | Promise<void>) | null>(null);
  const leaveOpener = useRef<HTMLElement | null>(null);
  const discardAction = useRef<(() => void | Promise<void>) | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [guardError, setGuardError] = useState('');
  const removalOpener = useRef<HTMLElement | null>(null);
  const [history, setHistory] = useState(emptyHistory);
  const [historyRevision, setHistoryRevision] = useState(0);
  const savedBaseline = useRef<string | null>(null);
  const initialSnapshot = useRef<SessionSnapshot>({ document: demo, original: null, diagnostics: [], id: null, revision: null });
  const savedSnapshot = useRef<SessionSnapshot | null>(null);
  const session = useRef(0);
  const saveInFlight = useRef<number | null>(null);
  const saveSequence = useRef(0);
  const currentDocument = preview ? toImportedScoreDocument(preview, warnings) : score;
  const currentDocumentRef = useRef(currentDocument);
  currentDocumentRef.current = currentDocument;
  const hasDocumentEdits = documentKey(currentDocument) !== (savedBaseline.current ?? documentKey(initialSnapshot.current.document));
  const pendingFret = editMode && selection?.string !== null && selection?.string !== undefined && fretDraft !== (selection.fret === null ? '' : String(selection.fret));
  const pendingFretRef = useRef<{ selection: ScoreSelection; value: string } | null>(null);
  pendingFretRef.current = pendingFret && selection ? { selection, value: fretDraft } : null;
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(initialText);
  const [title, setTitle] = useState('My banjo tab');
  const [duration, setDuration] = useState<4 | 8 | 16>(8);
  const [importError, setImportError] = useState('');
  const [reading, setReading] = useState(false);
  const [playerPreferences, setPlayerPreferences] = useState<PlayerPreferences>(defaultPlayerPreferences);

  async function signOut() {
    setClipboard(null);
    const response = await fetch('/session', {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '' },
    });
    if (!response.ok) throw new Error('Could not sign out.');
    window.location.assign('/session/new');
  }

  useEffect(() => { apiRequest('/api/songs').then(setLibrary).catch(e => setError(e.message)); }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (documentKey(currentDocumentRef.current) === (savedBaseline.current ?? documentKey(initialSnapshot.current.document)) && !pendingFretRef.current) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  function load(next: Score, original: string | null, diagnostics: string[] = [], id: number | null = null, revision: number | null = null) {
    session.current++;
    const snapshot = { document: next, original, diagnostics, id, revision };
    initialSnapshot.current = snapshot; savedSnapshot.current = id === null ? null : snapshot;
    saveInFlight.current = null; setSaving(false); setSaveError(''); setConflicted(false); setFailedCopyName(null);
    savedBaseline.current = id === null ? null : documentKey(next);
    setHistory(emptyHistory()); setHistoryRevision(value => value + 1);
    setPreview(null);
    setEditMode(false); setLibraryCollapsed(false);
    setSelection(null);
    setPassage(null);
    setPendingRemoval(null);
    setPendingTie(null);
    setScore(next); setSource(original); setWarnings(diagnostics); setShowWarnings(diagnostics.length > 0); setSavedId(id); setSavedRevision(revision); setDirty(id === null); setMessage(''); setError('');
  }
  function loadPreview(next: MusicXmlPreview, diagnostics: string[] = [], id: number | null = null, revision: number | null = null, original: string | null = null) {
    session.current++;
    const snapshot = { document: toImportedScoreDocument(next, diagnostics), original, diagnostics, id, revision };
    initialSnapshot.current = snapshot; savedSnapshot.current = id === null ? null : snapshot;
    saveInFlight.current = null; setSaving(false); setSaveError(''); setConflicted(false); setFailedCopyName(null);
    savedBaseline.current = id === null ? null : documentKey(toImportedScoreDocument(next, diagnostics));
    setHistory(emptyHistory()); setHistoryRevision(value => value + 1);
    setEditMode(false); setLibraryCollapsed(false);
    setSelection(null);
    setPassage(null);
    setPendingRemoval(null);
    setPendingTie(null);
    setPreview(next); setScore(demo); setSource(original); setWarnings(diagnostics); setShowWarnings(diagnostics.length > 0); setSavedId(id); setSavedRevision(revision); setDirty(id === null); setMessage(''); setError('');
  }
  function toggleEditMode() {
    if (editMode) setPendingTie(null);
    setHistoryRevision(value => value + 1);
    setEditMode(current => {
      const next = !current;
      setLibraryCollapsed(next);
      return next;
    });
  }
  // Digits typed on the score build a visible buffer; nothing changes until
  // Enter, Tab, navigation or another editor action commits it.
  const fretDraftRef = useRef(fretDraft);
  fretDraftRef.current = fretDraft;
  useEffect(() => {
    setMoveString(selection?.string ? String(selection.string) : '');
  }, [selection?.noteId, selection?.measure, selection?.event, selection?.string, selection?.fret]);
  function handleFretKey(target: ScoreSelection, key: string): boolean {
    const original = target.fret === null ? '' : String(target.fret);
    if (/^[0-9]$/.test(key)) {
      if (!surfaceBuffer) { setFretDraft(key, true); setError(''); return true; }
      if (fretDraftRef.current.length >= 2) { setMessage('Use a fret from 0 to 36.'); return true; }
      setFretDraft(fretDraftRef.current + key, true);
      return true;
    }
    if (key === 'Escape') {
      if (!surfaceBuffer && fretDraftRef.current === original) return false;
      setFretEdit(null); setMessage('Fret entry cancelled.');
      return true;
    }
    if (key === 'Backspace') {
      if (!surfaceBuffer) return false;
      const shorter = fretDraftRef.current.slice(0, -1);
      if (shorter) setFretDraft(shorter, true); else setFretEdit(null);
      return true;
    }
    if (key === 'Enter' || key === 'Tab') {
      if (fretDraftRef.current === original) return false;
      const value = fretDraftRef.current;
      setFretDraft(value);
      updateSelectionFret(target, Number(value));
      return true;
    }
    return false;
  }
  function remember(after: Snapshot, description: string, group?: string) {
    setHistory(current => record(current, { before: { document: currentDocument, selection, sourceIdentity: preview?.sourceIdentity }, after, description, group }));
    setDirty(documentKey(after.document) !== savedBaseline.current);
    setFretEdit(null);
  }
  // The newest revision that the notation actually rendered. A revision that
  // fails to render is undone so the draft, playback and exports stay usable.
  const lastRenderedKey = useRef<string | null>(null);
  function handleRenderResult(result: { ok: true } | { ok: false; message: string }) {
    const key = documentKey(currentDocumentRef.current);
    if (result.ok) { lastRenderedKey.current = key; return; }
    if (lastRenderedKey.current !== null && key !== lastRenderedKey.current && history.undo.length) {
      const description = history.undo.at(-1)!.description;
      moveHistory('undo');
      setMessage('');
      setError(`“${description}” could not be displayed, so it was undone: ${result.message}`);
      return;
    }
    setError(result.message);
  }
  function moveHistory(direction: 'undo' | 'redo') {
    const result = travel(history, direction);
    if (!result) return;
    try {
      const document = result.snapshot.document;
      // Parse before publishing; a failed restoration keeps the current draft.
      const restored = isImportedScoreDocument(document) ? readImportedDocument(document, result.snapshot.sourceIdentity) : null;
      setPreview(restored);
      if (!isImportedScoreDocument(document)) setScore(document);
      else setWarnings(document.warnings);
      setSelection(result.snapshot.selection);
      setPendingRemoval(null);
      setPendingTie(null);
      setHistory(result.history);
      setHistoryRevision(value => value + 1);
      setFretEdit(null);
      setDirty(documentKey(document) !== savedBaseline.current);
      setError(''); setMessage(result.description);
      documentRefocus();
    } catch (error) { setError((error as Error).message); }
  }
  function focusFretEntry() {
    if (narrow) setToolsOpen(true);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Fret"]');
      input?.focus({ preventScroll: true });
      input?.select();
    });
  }
  function documentRefocus() { document.querySelector<HTMLElement>('[data-testid="notation"]')?.focus({ preventScroll: true }); }
  const historyAction = useRef(moveHistory);
  historyAction.current = moveHistory;
  // Ctrl/Cmd+C, X and V act on the editing range and Playtab's measure
  // clipboard; without a range they leave the browser's own behaviour alone.
  const clipboardAction = useRef<(key: 'c' | 'x' | 'v') => boolean>(() => false);
  clipboardAction.current = key => {
    const active = document.activeElement;
    const opener = (active instanceof HTMLElement && active !== document.body ? active : document.querySelector<HTMLElement>('[data-testid="notation"]')) ?? document.body;
    if (key === 'c') { if (!passage) return false; copyPassage(); return true; }
    if (key === 'x') { if (!passage) return false; openCutDialog(opener); return true; }
    if (!clipboard || !selection) return false;
    openPasteDialog(opener);
    return true;
  };
  const saveShortcut = useRef<() => void>(() => undefined);
  saveShortcut.current = () => { void saveCurrent(); };
  useEffect(() => {
    // Ctrl/Cmd+S saves the workspace draft (committing a valid pending fret)
    // instead of opening the browser's save-page dialog.
    const keydown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      saveShortcut.current();
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, []);
  useEffect(() => {
    if (!editMode) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if ((key === 'c' || key === 'x' || key === 'v') && !event.shiftKey) {
        if (target instanceof HTMLElement && target.closest('dialog')) return;
        if (clipboardAction.current(key)) event.preventDefault();
        return;
      }
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      historyAction.current(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [editMode]);
  function updateSelectedScore(selectionToEdit: ScoreSelection, editNative: (notes: { string: number; fret: number }[]) => void, editImported: (note: ReturnType<typeof musicXmlEditorState>['notes'][number]) => void, afterSelection: ScoreSelection, description: string, group?: string, movedToString?: number) {
    if (preview) {
      if (selectionToEdit.string === null) return false;
      try {
        if (selectionToEdit.kind === 'note' && selectionToEdit.noteId !== null && !selectionToEdit.sourceId) {
          setError('This rendered note has no unique source identity. Its original MusicXML is preserved; select another note to edit.');
          return false;
        }
        const state = musicXmlEditorState(preview.source, preview.score, preview.sourceIdentity);
        const note = selectionToEdit.sourceId
          ? state.notes.find(candidate => candidate.sourceIdentity?.id === selectionToEdit.sourceId)
          : state.notes.find(candidate => candidate.measure === selectionToEdit.measure - 1 && candidate.beat === selectionToEdit.event - 1
            && candidate.voice === selectionToEdit.voice - 1 && candidate.string === selectionToEdit.string);
        if (!note) {
          setError(selectionToEdit.sourceId ? 'The selected source note is no longer available. Select it again before editing.' : 'This imported position has no source note to edit yet.');
          return false;
        }
        editImported(note);
        const nextSource = applyMusicXmlEdits(preview.source, state, [note.index]);
        const carries: IdentityCarry[] = note.sourceIdentity?.address && preview.sourceIdentity
          ? [...structuralCarries(preview, selectionToEdit), { id: note.sourceIdentity.id, address: movedToString === undefined
            ? note.sourceIdentity.address
            : `${note.sourceIdentity.address.slice(0, note.sourceIdentity.address.lastIndexOf(':') + 1)}${movedToString}` }]
          : [];
        const nextPreview = withPreviewTitle(readMusicXml(nextSource, preview.filename, preview.sourceFormat,
          preview.sourceIdentity ? { source: preview.source, map: preview.sourceIdentity, carries } : undefined), preview.score.title);
        if (note.sourceIdentity) {
          afterSelection.sourceId = note.sourceIdentity.id;
          const location = nextPreview.sourceLocationById?.get(note.sourceIdentity.id);
          if (location) Object.assign(afterSelection, location);
        }
        refreshStructuralSelection(afterSelection, nextPreview);
        remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: afterSelection, sourceIdentity: nextPreview.sourceIdentity }, description, group);
        setPreview(nextPreview);
        setError('');
        return true;
      } catch (error) {
        setError((error as Error).message);
        return false;
      }
    }
    if (selectionToEdit.string === null) return false;
    const measureIndex = selectionToEdit.measure - 1;
    const beatIndex = selectionToEdit.event - 1;
    const measure = score.measures[measureIndex];
    if (!measure?.beats[beatIndex]) return false;
    const next = {
      ...score,
      measures: score.measures.map((currentMeasure, currentMeasureIndex) => currentMeasureIndex === measureIndex ? {
        ...currentMeasure,
        beats: currentMeasure.beats.map((currentBeat, currentBeatIndex) => currentBeatIndex === beatIndex ? { ...currentBeat, notes: currentBeat.notes.map(note => ({ ...note })) } : currentBeat),
      } : currentMeasure),
    };
    const nextBeat = next.measures[measureIndex].beats[beatIndex];
    editNative(nextBeat.notes);
    try { validateScore(next); } catch (error) { setError((error as Error).message); return false; }
    setScore(next);
    remember({ document: next, selection: afterSelection }, description, group);
    setError('');
    return true;
  }
  function updateSelectionFret(selectionToEdit: ScoreSelection, fret: number, group?: string) {
    if (!Number.isInteger(fret) || fret < 0 || fret > 36) {
      setError('Frets must be whole numbers from 0 to 36.');
      return;
    }
    if (selectionToEdit.string === null) return;
    if (selectionToEdit.kind === 'note' && selectionToEdit.fret === fret) return;
    const after: ScoreSelection = { ...selectionToEdit, kind: 'note', noteId: null, fret };
    if (!preview && fret > 22) {
      try {
        validateScore(score);
        const filename = `${score.title.slice(0, 148)}.musicxml`;
        const promoted = withPreviewTitle(readMusicXml(promoteNativeScore(score), filename), score.title);
        let nextSource: string;
        if (selectionToEdit.kind === 'note') {
          const state = musicXmlEditorState(promoted.source, promoted.score, promoted.sourceIdentity);
          const note = state.notes.find(candidate => candidate.measure === selectionToEdit.measure - 1 && candidate.beat === selectionToEdit.event - 1 && candidate.string === selectionToEdit.string);
          if (!note) throw new Error('The selected note could not be matched after promotion.');
          note.fret = fret;
          nextSource = applyMusicXmlEdits(promoted.source, state, [note.index]);
        } else nextSource = addMusicXmlNote(promoted.source, promoted.score, {
          measure: selectionToEdit.measure - 1, beat: selectionToEdit.event - 1,
          voice: selectionToEdit.voice - 1, string: selectionToEdit.string, fret,
        });
        const nextPreview = withPreviewTitle(readMusicXml(nextSource, filename, 'musicxml',
          promoted.sourceIdentity ? { source: promoted.source, map: promoted.sourceIdentity } : undefined), score.title);
        after.sourceId = nextPreview.sourceIdByLocation?.get(`${after.measure}:${after.event}:${after.voice}:${after.string}:${fret}`);
        refreshStructuralSelection(after, nextPreview);
        remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after, sourceIdentity: nextPreview.sourceIdentity }, `Promote score and change fret to ${fret}`);
        setPreview(nextPreview); setSelection(after); setError('');
      } catch (error) { setError((error as Error).message); }
      return;
    }
    if (preview && selectionToEdit.kind !== 'note') {
      try {
        const nextSource = addMusicXmlNote(preview.source, preview.score, {
          measure: selectionToEdit.measure - 1, beat: selectionToEdit.event - 1,
          voice: selectionToEdit.voice - 1, string: selectionToEdit.string, fret,
        });
        const nextPreview = withPreviewTitle(readMusicXml(nextSource, preview.filename, preview.sourceFormat,
          preview.sourceIdentity ? { source: preview.source, map: preview.sourceIdentity,
            carries: structuralCarries(preview, selectionToEdit) } : undefined), preview.score.title);
        after.sourceId = nextPreview.sourceIdByLocation?.get(`${after.measure}:${after.event}:${after.voice}:${after.string}:${fret}`);
        refreshStructuralSelection(after, nextPreview);
        remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after, sourceIdentity: nextPreview.sourceIdentity }, `Add fret ${fret}`, group);
        setPreview(nextPreview);
        setSelection(after);
        setError('');
      } catch (error) { setError((error as Error).message); }
      return;
    }
    if (!updateSelectedScore(selectionToEdit, notes => {
      const existing = notes.find(note => note.string === selectionToEdit.string);
      if (existing) existing.fret = fret;
      else notes.push({ string: selectionToEdit.string!, fret });
      notes.sort((left, right) => left.string - right.string);
    }, note => { note.fret = fret; }, after, `Change fret to ${fret}`, group)) return;
    setSelection(after);
  }
  function changeSelectedDuration(denominator: DurationDenominator, dotted: boolean) {
    if (!selection) return;
    if (pendingFret) { setError('Apply the pending fret before changing this event.'); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      const nextSource = changeMusicXmlDuration(base.source, base.score,
        { measure: selection.measure - 1, beat: selection.event - 1, voice: selection.voice - 1 }, denominator, dotted);
      if (nextSource === base.source && preview) return;
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity,
          carries: structuralCarries(base, selection) } : undefined), base.score.title);
      const after = selectionAtPosition(selection, score, nextPreview, {});
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after,
        sourceIdentity: nextPreview.sourceIdentity }, `${dotted ? 'Dotted ' : ''}${denominator === 1 ? 'whole' : `1/${denominator}`} duration`);
      setPreview(nextPreview); setSelection(after); setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function changeSelectedTriplet(remove: boolean) {
    if (!selection) return;
    if (pendingFret) { setError('Apply the pending fret before changing this event.'); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      const position = { measure: selection.measure - 1, beat: selection.event - 1, voice: selection.voice - 1 };
      const nextSource = remove ? removeMusicXmlTriplet(base.source, base.score, position)
        : createMusicXmlTriplet(base.source, base.score, position);
      const firstEvent = remove ? inspectMusicXmlTriplet(base.source, position).start ?? position.beat : position.beat;
      const eventId = base.sourceEventIdByAddress?.get(`${position.measure}:${selection.voice}:${firstEvent}`)
        ?? (firstEvent === position.beat ? selection.sourceEventId : undefined);
      const carries: IdentityCarry[] = [...structuralCarries(base, selection, false),
        ...(eventId ? [{ kind: 'event' as const, id: eventId, address: `${position.measure}:${selection.voice}:${firstEvent}` }] : [])];
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity, carries } : undefined), base.score.title);
      const after = selectionAtPosition(selection, score, nextPreview, { event: firstEvent + 1 });
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after,
        sourceIdentity: nextPreview.sourceIdentity }, remove ? 'Remove triplet' : 'Create triplet');
      setPreview(nextPreview); setSelection(after); setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function openInsertEvent(opener: HTMLElement) {
    if (!selection) return;
    if (pendingFret) { setError('Apply the pending fret before inserting an event.'); return; }
    insertOpener.current = opener;
    setError('');
    setInsertOpen(true);
  }
  function confirmInsertEvent(insertDraft: InsertEventDraft) {
    if (!selection) return;
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      const position = { measure: selection.measure - 1, beat: selection.event - 1, voice: selection.voice - 1 };
      const nextSource = insertMusicXmlEvent(base.source, base.score, { ...position, ...insertDraft });
      const eventId = selection.sourceEventId ?? base.sourceEventIdByAddress?.get(`${position.measure}:${selection.voice}:${position.beat}`);
      const carries: IdentityCarry[] = [
        ...structuralCarries(base, selection, false),
        ...(eventId ? [{ kind: 'event' as const, id: eventId,
          address: `${position.measure}:${selection.voice}:${position.beat + (insertDraft.placement === 'before' ? 1 : 0)}` }] : []),
      ];
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity, carries } : undefined), base.score.title);
      const insertedEvent = selection.event + (insertDraft.placement === 'after' ? 1 : 0);
      const after = selectionAtPosition(selection, score, nextPreview, { event: insertedEvent,
        string: insertDraft.kind === 'note' ? insertDraft.string! : selection.string });
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after,
        sourceIdentity: nextPreview.sourceIdentity }, `Insert ${insertDraft.kind} ${insertDraft.placement} event`);
      setPreview(nextPreview); setSelection(after); setInsertOpen(false); setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function insertSelectedMeasure(placement: 'before' | 'after') {
    if (!selection) return;
    if (pendingFret) { setError('Apply the pending fret before inserting a measure.'); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      const selectedIndex = selection.measure - 1;
      const nextSource = insertMusicXmlMeasure(base.source, base.score, selectedIndex, placement);
      const carries = shiftedMeasureCarries(base, selectedIndex + (placement === 'after' ? 1 : 0));
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity, carries } : undefined), base.score.title);
      const insertedMeasure = selectedIndex + (placement === 'after' ? 2 : 1);
      const after = selectionAtPosition(selection, score, nextPreview,
        { measure: insertedMeasure, event: 1 });
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after,
        sourceIdentity: nextPreview.sourceIdentity }, `Insert measure ${placement} selected`);
      setPreview(nextPreview); setSelection(after);
      if (passage) { setPassage(null); setMessage('Playback selection cleared after inserting a measure.'); }
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function previewDuplicateMeasure(opener: HTMLElement) {
    if (!selection) return;
    if (pendingFret) { setError('Apply the pending fret before duplicating a measure.'); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      const measureIndex = selection.measure - 1;
      const candidate = duplicateMusicXmlMeasure(base.source, base.score, measureIndex);
      const parsed = readSourceDocument(base.source);
      const part = Array.from(parsed.getElementsByTagName('*')).find(element => element.localName === 'part');
      const measure = part && Array.from(part.children).filter(element => element.localName === 'measure')[measureIndex];
      const notes = measure ? Array.from(measure.children).filter(element => element.localName === 'note') : [];
      duplicateOpener.current = opener;
      setPendingDuplication({ originalKey: documentKey(currentDocument), base, source: candidate.source,
        measureIndex, excluded: candidate.excluded,
        noteCount: notes.filter(note => !Array.from(note.children).some(element => element.localName === 'rest')).length,
        restCount: notes.filter(note => Array.from(note.children).some(element => element.localName === 'rest')).length });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function confirmDuplicateMeasure() {
    if (!pendingDuplication || !selection) return;
    if (pendingDuplication.originalKey !== documentKey(currentDocument)) {
      setPendingDuplication(null); setError('The score changed since this duplication preview. Open it again.'); return;
    }
    try {
      const { base, source: nextSource, measureIndex } = pendingDuplication;
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity,
          carries: shiftedMeasureCarries(base, measureIndex + 1) } : undefined), base.score.title);
      const after = selectionAtPosition(selection, score, nextPreview, { measure: measureIndex + 2, event: 1 });
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after,
        sourceIdentity: nextPreview.sourceIdentity }, `Duplicate measure ${measureIndex + 1}`);
      setPreview(nextPreview); setSelection(after); setPendingDuplication(null);
      if (passage) { setPassage(null); setMessage('Playback selection cleared after duplicating a measure.'); }
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function previewDeleteMeasure(opener: HTMLElement) {
    if (!selection) return;
    if (pendingFret) { setError('Apply the pending fret before deleting a measure.'); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      const measureIndex = selection.measure - 1;
      const candidate = deleteMusicXmlMeasure(base.source, base.score, measureIndex);
      deleteMeasureOpener.current = opener;
      setPendingMeasureDeletion({ originalKey: documentKey(currentDocument), base, source: candidate.source,
        measureIndex, noteCount: candidate.noteCount, restCount: candidate.restCount, labelCount: candidate.labelCount });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function confirmDeleteMeasure() {
    if (!pendingMeasureDeletion || !selection) return;
    if (pendingMeasureDeletion.originalKey !== documentKey(currentDocument)) {
      setPendingMeasureDeletion(null); setError('The score changed since this deletion preview. Open it again.'); return;
    }
    try {
      const { base, source: nextSource, measureIndex } = pendingMeasureDeletion;
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity,
          carries: deletedMeasureCarries(base, measureIndex) } : undefined), base.score.title);
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: null,
        sourceIdentity: nextPreview.sourceIdentity }, `Delete measure ${measureIndex + 1}`);
      setPreview(nextPreview); setSelection(null); setPendingMeasureDeletion(null);
      if (passage) {
        const endpointsDeleted = [passage.start, passage.end].some(endpoint => endpoint.measure === measureIndex + 1);
        if (endpointsDeleted) setPassage(null);
        else setPassage({ start: selectionAtPosition(passage.start, score, nextPreview,
          { measure: passage.start.measure > measureIndex + 1 ? passage.start.measure - 1 : passage.start.measure }),
        end: selectionAtPosition(passage.end, score, nextPreview,
          { measure: passage.end.measure > measureIndex + 1 ? passage.end.measure - 1 : passage.end.measure }) });
        setMessage(endpointsDeleted ? 'Playback selection cleared because it touched the deleted measure.'
          : 'Measure deleted. Playback selection moved with surviving measures.');
      } else setMessage('Measure deleted. Edit selection cleared.');
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function openMeterDialog(opener: HTMLElement) {
    if (!selection) return;
    if (pendingFret) { setError('Apply the pending fret before changing the time signature.'); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      const measureIndex = selection.measure - 1;
      const master = base.score.masterBars[measureIndex];
      if (!master) throw new Error('The selected measure cannot be identified safely.');
      meterOpener.current = opener;
      setMeterTarget({ originalKey: documentKey(currentDocument), base, measureIndex });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function confirmMeterChange(candidate: MeterCandidate): string | null {
    if (!meterTarget || !selection) return null;
    if (meterTarget.originalKey !== documentKey(currentDocument)) {
      setMeterTarget(null); setError('The score changed since this meter preview. Open it again.'); return null;
    }
    try {
      const { base } = meterTarget;
      const nextPreview = withPreviewTitle(readMusicXml(candidate.source, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), base.score.title);
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: null,
        sourceIdentity: nextPreview.sourceIdentity }, `Change time signature in measures ${candidate.firstMeasure}–${candidate.lastMeasure}`);
      setPreview(nextPreview); setSelection(null); setMeterTarget(null); setPassage(null);
      setMessage(`Time signature changed in measures ${candidate.firstMeasure}–${candidate.lastMeasure}. Edit and playback selections cleared.`);
      setError('');
      return null;
    } catch (failure) { return (failure as Error).message; }
  }
  function openRepeatDialog(opener: HTMLElement) {
    if (!selection) return;
    if (pendingFret) { setError('Apply the pending fret before editing repeats.'); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      repeatOpener.current = opener;
      setRepeatTarget({ originalKey: documentKey(currentDocument), base, measure: selection.measure }); setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function commitRepeatChange(target: RepeatTarget, candidate: string, description: string, status: string): string | null {
    if (target.originalKey !== documentKey(currentDocument)) {
      setRepeatTarget(null); setRepeatRemoval(null);
      setError('The score changed since this repeat preview. Open it again.'); return null;
    }
    try {
      const { base } = target;
      const nextPreview = withPreviewTitle(readMusicXml(candidate, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), base.score.title);
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection,
        sourceIdentity: nextPreview.sourceIdentity }, description);
      setPreview(nextPreview); setRepeatTarget(null); setRepeatRemoval(null); setError(''); setMessage(status);
      return null;
    } catch (failure) { return (failure as Error).message; }
  }
  function confirmRepeat(candidate: string, repeatDraft: RepeatDraft): string | null {
    return repeatTarget ? commitRepeatChange(repeatTarget, candidate,
      `Repeat measures ${repeatDraft.start}–${repeatDraft.end} ×${repeatDraft.count}`,
      `Repeat added: measures ${repeatDraft.start}–${repeatDraft.end}, ${repeatDraft.count} plays.`) : null;
  }
  function addRepeatEndings(candidate: string, region: RepeatRegion): string | null {
    return repeatTarget ? commitRepeatChange(repeatTarget, candidate,
      `Add endings to measures ${region.start + 1}–${region.end + 1}`,
      `First and second endings added to measures ${region.start + 1}–${region.end + 1}.`) : null;
  }
  function previewRepeatRemoval(region: RepeatRegion): string | null {
    if (!repeatTarget) return null;
    try {
      const endings = inspectMusicXmlRepeatEndings(repeatTarget.base.source, region.start, region.end);
      removeMusicXmlRepeat(repeatTarget.base.source, repeatTarget.base.score, region.start, region.end);
      setRepeatRemoval({ ...repeatTarget, region, endings }); setRepeatTarget(null); setRepeatRemovalError('');
      return null;
    } catch (failure) { return (failure as Error).message; }
  }
  function confirmRepeatRemoval() {
    if (!repeatRemoval) return;
    try {
      const { region, base } = repeatRemoval;
      const candidate = removeMusicXmlRepeat(base.source, base.score, region.start, region.end);
      setRepeatRemovalError(commitRepeatChange(repeatRemoval, candidate, `Remove repeat measures ${region.start + 1}–${region.end + 1}`,
        `Repeat in measures ${region.start + 1}–${region.end + 1} removed with its dependent endings.`) ?? '');
    } catch (failure) { setRepeatRemovalError((failure as Error).message); }
  }
  function openGraceDialog(opener: HTMLElement) {
    if (!selection || selection.kind !== 'note' || selection.string === null || selection.fret === null) {
      setError('Select a note to add or edit its grace group.'); return;
    }
    if (pendingFret) { setError('Apply the pending fret before editing grace notes.'); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      const info = inspectMusicXmlGraceGroup(base.source, base.score, { measure: selection.measure - 1, beat: selection.event - 1, voice: selection.voice - 1 });
      const existing = info.events.length > 0;
      graceOpener.current = opener;
      setGraceTarget({ originalKey: documentKey(currentDocument), base, selection, destination: info.destination,
        first: info.destination - info.events.length, existing, readOnly: info.readOnly, connections: info.connections,
        initialEvents: existing ? info.events : [{ denominator: 16, notes: [{ string: selection.string, fret: selection.fret, transition: 'none' }] }] });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function commitGraceSource(candidate: string, description: string, message: string, event: number, string: number | null): string | null {
    if (!graceTarget) return null;
    if (graceTarget.originalKey !== documentKey(currentDocument)) {
      setGraceTarget(null); setError('The score changed since this grace preview. Open it again.'); return null;
    }
    try {
      const { base, selection: opened } = graceTarget;
      const nextPreview = withPreviewTitle(readMusicXml(candidate, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), base.score.title);
      const after = selectionAtPosition(opened, score, nextPreview, { event, string });
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after, sourceIdentity: nextPreview.sourceIdentity }, description);
      setPreview(nextPreview); setSelection(after); setGraceTarget(null); setError(''); setMessage(message);
      return null;
    } catch (failure) { return (failure as Error).message; }
  }
  function confirmGrace(candidate: string, graceEvents: GraceEventSpec[]): string | null {
    if (!graceTarget) return null;
    const { selection: opened, first, existing } = graceTarget;
    return commitGraceSource(candidate, `${existing ? 'Edit' : 'Add'} grace group in measure ${opened.measure}`,
      existing ? 'Grace group updated.' : 'Grace group added before the selected event.', first + 1, graceEvents[0].notes[0].string);
  }
  function removeGraceGroup(): string | null {
    if (!graceTarget) return null;
    const { base, selection: opened, first } = graceTarget;
    try {
      const removed = removeMusicXmlGraceGroup(base.source, base.score, { measure: opened.measure - 1, beat: graceTarget.destination, voice: opened.voice - 1 });
      return commitGraceSource(removed.source, `Remove grace group in measure ${opened.measure}`, 'Grace group removed.', first + 1, opened.string);
    } catch (failure) { return (failure as Error).message; }
  }

  // Hand annotations and bends are note-local source edits; a native score
  // is promoted first, exactly like other imported-only techniques.
  function changeNoteTechnique(target: ScoreSelection, change: (base: MusicXmlPreview, position: TiePosition) => string,
    description: string, message: string) {
    if (target.kind !== 'note' || target.string === null || target.fret === null) return false;
    if (pendingFret) { setError('Apply the pending fret before changing this note’s techniques.'); return false; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      const nextSource = change(base, tiePosition(target));
      if (nextSource === base.source && preview) return true;
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), base.score.title);
      const after = selectionAtPosition(target, score, nextPreview, {});
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after, sourceIdentity: nextPreview.sourceIdentity }, description);
      setPreview(nextPreview); setSelection(after); setError(''); setMessage(message);
      return true;
    } catch (failure) { setError((failure as Error).message); return false; }
  }
  function changeHand(hand: 'picking' | 'fretting', value: PickingHand | FrettingHand) {
    if (!selection) return;
    const label = hand === 'picking' ? 'Picking hand' : 'Fretting hand';
    const shown = value === 'none' ? 'None' : value === 'T' ? 'Thumb' : value;
    changeNoteTechnique(selection, (base, position) => setMusicXmlHand(base.source, base.score, position, hand, value),
      `${label}: ${shown}`, `${label} set to ${shown}.`);
  }
  function openBendDialog(opener: HTMLElement) {
    if (!selection || selection.kind !== 'note') return;
    if (pendingFret) { setError('Apply the pending fret before changing this note’s techniques.'); return; }
    bendOpener.current = opener;
    const existing = selectedTechniques ? selectedTechniques.bend : 'none';
    setBendTarget({ originalKey: documentKey(currentDocument), selection, existing, reason: selectedTechniques?.bendReason });
  }
  function applyBend(bend: NoteBend | null) {
    if (!bendTarget) return;
    if (bendTarget.originalKey !== documentKey(currentDocument)) { setBendTarget(null); setError('The score changed since this bend was opened. Open it again.'); return; }
    const shape = bend ? `${bend.shape === 'release' ? 'Bend and release' : 'Bend'} ${BEND_LABELS[bend.amount]}` : '';
    if (changeNoteTechnique(bendTarget.selection, (base, position) => setMusicXmlBend(base.source, base.score, position, bend),
      bend ? shape : 'Remove bend', bend ? `${shape} applied.` : 'Bend removed.')) setBendTarget(null);
  }
  function anchorPosition(target: ScoreSelection) {
    return { measure: target.measure - 1, beat: target.event - 1, voice: target.voice - 1 };
  }
  function openAnchorDialog(kind: AnchorKind, opener: HTMLElement) {
    if (!selection || selection.graceIndex !== null) { setError('Select an ordinary event to anchor text to it.'); return; }
    if (pendingFret) { setError('Apply the pending fret before editing text.'); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      const info = inspectMusicXmlAnchor(base.source, base.score, anchorPosition(selection));
      const items = kind === 'chord' ? info.chords : kind === 'words' ? info.words : info.sections;
      anchorOpener.current = opener;
      setAnchorTarget({ originalKey: documentKey(currentDocument), base, selection, kind, items });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function applyAnchor(anchorChoice: number | 'new', value: ChordSpelling | string | null): string | null {
    if (!anchorTarget) return null;
    const { base, selection: target, kind, items } = anchorTarget;
    if (anchorTarget.originalKey !== documentKey(currentDocument)) { setAnchorTarget(null); setError('The score changed since this text was opened. Open it again.'); return null; }
    const name = ANCHOR_NAMES[kind].item;
    const remove = value === null;
    const shown = value === null ? items[anchorChoice as number].text : typeof value === 'string' ? value.trim() : chordSpellingName(value);
    const where = kind === 'section' ? `measure ${target.measure}` : `measure ${target.measure}, event ${target.event}`;
    try {
      const nextSource = changeMusicXmlAnchor(base.source, base.score, anchorPosition(target), kind, anchorChoice === 'new' ? null : anchorChoice, value);
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), base.score.title);
      const after = selectionAtPosition(target, score, nextPreview, {});
      const verb = remove ? 'Remove' : anchorChoice === 'new' ? 'Add' : 'Change';
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after, sourceIdentity: nextPreview.sourceIdentity },
        `${verb} ${name} “${shown}” at ${where}`);
      setPreview(nextPreview); setSelection(after); setAnchorTarget(null); setError('');
      setMessage(`${name[0].toUpperCase()}${name.slice(1)} “${shown}” ${remove ? 'removed from' : anchorChoice === 'new' ? 'added at' : 'updated at'} ${where}.`);
      return null;
    } catch (failure) { return (failure as Error).message; }
  }
  function textBase() {
    return preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
  }
  function commitText(base: MusicXmlPreview, target: ScoreSelection | null, nextSource: string, description: string, message: string) {
    const nextPreview = withPreviewTitle(readMusicXml(nextSource, base.filename, base.sourceFormat,
      base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), base.score.title);
    const after = target ? selectionAtPosition(target, score, nextPreview, {}) : selection;
    remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after, sourceIdentity: nextPreview.sourceIdentity }, description);
    setPreview(nextPreview); setSelection(after); setError(''); setMessage(message);
  }
  function openLyricDialog(opener: HTMLElement) {
    if (!selection || selection.graceIndex !== null) { setError('Select an ordinary event to edit its lyric.'); return; }
    if (pendingFret) { setError('Apply the pending fret before editing text.'); return; }
    try {
      const base = textBase();
      const lyrics = inspectMusicXmlLyrics(base.source, base.score, anchorPosition(selection));
      textOpener.current = opener;
      setLyricTarget({ originalKey: documentKey(currentDocument), base, selection, lyrics });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function applyLyric(verse: number, value: { text: string; syllabic: LyricSyllabic } | null): string | null {
    if (!lyricTarget) return null;
    const { base, selection: target } = lyricTarget;
    const remove = value === null;
    if (lyricTarget.originalKey !== documentKey(currentDocument)) { setLyricTarget(null); setError('The score changed since this lyric was opened. Open it again.'); return null; }
    try {
      const nextSource = setMusicXmlLyric(base.source, base.score, anchorPosition(target), verse, value);
      const where = `measure ${target.measure}, event ${target.event}`;
      commitText(base, target, nextSource, `${remove ? 'Remove' : 'Set'} verse ${verse} lyric at ${where}`,
        remove ? `Verse ${verse} lyric removed from ${where}.` : `Verse ${verse} lyric “${value.text.trim()}” applied at ${where}.`);
      setLyricTarget(null);
      return null;
    } catch (failure) { return (failure as Error).message; }
  }
  function openStandaloneDialog(opener: HTMLElement) {
    if (pendingFret) { setError('Apply the pending fret before editing text.'); return; }
    try {
      const base = textBase();
      textOpener.current = opener;
      setStandaloneTarget({ originalKey: documentKey(currentDocument), base });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function applyStandalone(text: string): string | null {
    if (!standaloneTarget) return null;
    const { base } = standaloneTarget;
    if (standaloneTarget.originalKey !== documentKey(currentDocument)) { setStandaloneTarget(null); setError('The score changed since this text was opened. Open it again.'); return null; }
    try {
      const nextSource = setMusicXmlStandaloneLyrics(base.source, text);
      if (nextSource === base.source && preview) { setStandaloneTarget(null); return null; }
      const removed = !text.trim();
      commitText(base, null, nextSource, removed ? 'Remove Lyrics & chords text' : 'Edit Lyrics & chords text',
        removed ? 'Lyrics & chords text removed.' : 'Lyrics & chords text updated.');
      setStandaloneTarget(null);
      return null;
    } catch (failure) { return (failure as Error).message; }
  }
  function openSettingsDialog(opener: HTMLElement) {
    if (pendingFret) { setError('Apply the pending fret before changing score settings.'); return; }
    try {
      const base = textBase();
      const info = inspectMusicXmlScoreSettings(base.source, base.score);
      textOpener.current = opener;
      setSettingsTarget({ originalKey: documentKey(currentDocument), base, info });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function applySettings(candidate: { source: string; tuningRange: { first: number; last: number } }, settingsDraft: SettingsDraft): string | null {
    if (!settingsTarget) return null;
    const { base, info } = settingsTarget;
    if (settingsTarget.originalKey !== documentKey(currentDocument)) { setSettingsTarget(null); setError('The score changed since settings were opened. Open them again.'); return null; }
    try {
      const title = settingsDraft.title.trim();
      const tuningChanged = settingsDraft.tuning.some((value, index) => Number(value) !== info.tuning[index]);
      const nextPreview = withPreviewTitle(readMusicXml(candidate.source, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), title);
      const after = selection ? selectionAtPosition(selection, score, nextPreview, {}) : null;
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after, sourceIdentity: nextPreview.sourceIdentity }, 'Change score settings');
      setPreview(nextPreview); setSelection(after); setSettingsTarget(null); setError('');
      setMessage(tuningChanged ? `Score settings applied. Tuning changed for measures ${candidate.tuningRange.first}–${candidate.tuningRange.last}.` : 'Score settings applied.');
      return null;
    } catch (failure) { return (failure as Error).message; }
  }
  function openTempoDialog(opener: HTMLElement) {
    if (!selection || selection.graceIndex !== null) { setError('Select an ordinary event to set its tempo.'); return; }
    if (pendingFret) { setError('Apply the pending fret before changing the tempo.'); return; }
    try {
      const base = textBase();
      const info = inspectMusicXmlTempo(base.source, base.score, anchorPosition(selection));
      textOpener.current = opener;
      setTempoTarget({ originalKey: documentKey(currentDocument), base, selection, info });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function applyTempo(tempo: number | null): string | null {
    if (!tempoTarget) return null;
    const { base, selection: target } = tempoTarget;
    const remove = tempo === null;
    if (tempoTarget.originalKey !== documentKey(currentDocument)) { setTempoTarget(null); setError('The score changed since this tempo was opened. Open it again.'); return null; }
    try {
      const nextSource = setMusicXmlLocalTempo(base.source, base.score, anchorPosition(target), tempo);
      const where = `measure ${target.measure}, event ${target.event}`;
      commitText(base, target, nextSource, remove ? `Remove local tempo at ${where}` : `Set tempo ${tempo} BPM at ${where}`,
        remove ? `Local tempo removed at ${where}; ${tempoTarget.info.inherited} BPM continues.` : `Tempo ${tempo} BPM set at ${where}.`);
      setTempoTarget(null);
      return null;
    } catch (failure) { return (failure as Error).message; }
  }
  function measureEventCount(measure: number, voice: number) {
    return preview ? preview.score.tracks?.[0]?.staves?.[0]?.bars?.[measure - 1]?.voices?.[voice - 1]?.beats?.length ?? 0
      : score.measures[measure - 1]?.beats.length ?? 0;
  }
  function selectWholeMeasure() {
    if (!selection) return;
    const last = measureEventCount(selection.measure, selection.voice);
    setPassage({ start: selectionAtPosition(selection, score, preview, { event: 1 }), end: selectionAtPosition(selection, score, preview, { event: Math.max(1, last) }) });
    setMessage(`Measure ${selection.measure} selected as a passage.`); setError('');
  }
  function wholeMeasurePassage() {
    if (!passage) return null;
    const { start, end } = passage;
    return start.voice === end.voice && start.event === 1 && end.event === measureEventCount(end.measure, end.voice) ? { first: start.measure, last: end.measure } : null;
  }
  function openCutDialog(opener: HTMLElement) {
    const range = wholeMeasurePassage();
    if (!range) { setError('Select whole measures to cut. Use Select measure, or set the range from a first event to a last event.'); return; }
    if (pendingFret) { setError('Apply the pending fret before cutting.'); return; }
    try {
      const base = textBase();
      const cut = cutMusicXmlMeasures(base.source, base.score, range.first - 1, range.last - 1);
      textOpener.current = opener;
      setCutTarget({ originalKey: documentKey(currentDocument), base, first: range.first, last: range.last, cut });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  // Clears the selected range to rests after the Cut-style confirmation:
  // whole measures through the measure cut, partial ranges event by event.
  function openClearRange(opener: HTMLElement | null) {
    if (!passage) return;
    if (pendingFret) { setError('Apply the pending fret before clearing the range.'); return; }
    textOpener.current = opener;
    try {
      const base = textBase();
      const whole = wholeMeasurePassage();
      if (whole) {
        const cut = cutMusicXmlMeasures(base.source, base.score, whole.first - 1, whole.last - 1);
        setCutTarget({ originalKey: documentKey(currentDocument), base, first: whole.first, last: whole.last, cut, mode: 'clear' });
        setError(''); return;
      }
      const { start, end } = passage;
      let current = base;
      let notes = 0;
      const dependencies = new Set<string>();
      for (let measure = start.measure; measure <= end.measure; measure++) {
        const count = current.score.tracks[0]?.staves[0]?.bars[measure - 1]?.voices[start.voice - 1]?.beats.length ?? 0;
        const last = measure === end.measure ? end.event : count;
        for (let event = measure === start.measure ? start.event : 1; event <= last; event++) {
          const beat = current.score.tracks[0]?.staves[0]?.bars[measure - 1]?.voices[start.voice - 1]?.beats[event - 1];
          if (!beat || beat.isRest || beat.notes.length === 0 || beat.graceType) continue;
          const result = removeMusicXmlNotes(current.source, current.score, { measure: measure - 1, beat: event - 1, voice: start.voice - 1 });
          if (!result) continue;
          notes += beat.notes.length;
          result.dependencies.forEach(item => dependencies.add(item));
          current = readMusicXml(result.source, base.filename, base.sourceFormat);
        }
      }
      if (!notes) { setMessage('The selected range already holds only rests.'); setError(''); return; }
      setCutTarget({ originalKey: documentKey(currentDocument), base, first: start.measure, last: end.measure, mode: 'clear',
        label: `M${start.measure} E${start.event} – M${end.measure} E${end.event}`,
        cut: { source: current.source, notes, labels: 0, lyrics: 0, spans: [...dependencies] } });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function confirmCut() {
    if (!cutTarget) return;
    const { base, first, last, cut } = cutTarget;
    const clearing = cutTarget.mode === 'clear';
    setCutTarget(null);
    if (cutTarget.originalKey !== documentKey(currentDocument)) { setError('The score changed since Cut was opened. Select the measures again.'); return; }
    try {
      const nextPreview = withPreviewTitle(readMusicXml(cut.source, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), base.score.title);
      const after = selection ? selectionAtPosition(selection, score, nextPreview, {}) : null;
      const range = cutTarget.label ?? (first === last ? `measure ${first}` : `measures ${first}–${last}`);
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after, sourceIdentity: nextPreview.sourceIdentity }, `${clearing ? 'Clear' : 'Cut'} ${range}`);
      if (!clearing && cut.clipboard) setClipboard({ ...cut.clipboard, title: base.score.title });
      setPreview(nextPreview); setSelection(after); setPassage(null); setError('');
      setMessage(clearing ? `Cleared ${range}; it now holds rests.` : `Cut ${range} to the clipboard; the measures now hold rests.`);
    } catch (failure) { setError((failure as Error).message); }
  }
  function copyPassage() {
    if (!passage) return;
    const { start, end } = passage;
    if (!wholeMeasurePassage()) {
      setError('Select whole measures to copy. Use Select measure, or set the range from a first event to a last event.'); return;
    }
    try {
      const base = textBase();
      const copied = copyMusicXmlMeasures(base.source, base.score, start.measure - 1, end.measure - 1);
      setClipboard({ ...copied, title: base.score.title });
      const count = copied.measures.length;
      setMessage(`Copied ${count} measure${count === 1 ? '' : 's'} (${start.measure}${count > 1 ? `–${end.measure}` : ''}).`); setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function openPasteDialog(opener: HTMLElement) {
    if (!clipboard || !selection) return;
    if (pendingFret) { setError('Apply the pending fret before pasting.'); return; }
    try {
      textOpener.current = opener;
      const range = wholeMeasurePassage();
      setPasteTarget({ originalKey: documentKey(currentDocument), base: textBase(), measure: selection.measure,
        replaceFrom: range?.first ?? null, replaceCount: range ? range.last - range.first + 1 : 0 });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function applyPaste(candidate: string, replacing: boolean): string | null {
    if (!pasteTarget || !clipboard) return null;
    const { base } = pasteTarget;
    const measure = replacing ? pasteTarget.replaceFrom! : pasteTarget.measure;
    if (pasteTarget.originalKey !== documentKey(currentDocument)) { setPasteTarget(null); setError('The score changed since paste was opened. Open it again.'); return null; }
    try {
      const count = clipboard.measures.length;
      const nextPreview = withPreviewTitle(readMusicXml(candidate, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity, carries: replacing ? [] : shiftedMeasureCarries(base, measure - 1) } : undefined), base.score.title);
      const first = selectionAtPosition({ ...(selection ?? passage!.start), measure, event: 1 }, score, nextPreview, { measure, event: 1 });
      const plural = `${count} measure${count === 1 ? '' : 's'}`;
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: first, sourceIdentity: nextPreview.sourceIdentity },
        replacing ? `Paste ${plural} over measure ${measure}` : `Paste ${plural} before measure ${measure}`);
      setPreview(nextPreview); setSelection(first); setPassage(null); setPasteTarget(null); setError('');
      setMessage(replacing ? `Replaced measures ${measure}–${measure + count - 1} with the copied ${plural}.`
        : `Pasted ${plural} before measure ${measure}; they are now measures ${measure}–${measure + count - 1}.`);
      return null;
    } catch (failure) { return (failure as Error).message; }
  }
  function openNewScoreDialog(opener: HTMLElement) {
    newScoreOpener.current = opener;
    setNewScoreOpen(true);
  }
  function createNewScore(newScoreDraft: NewScoreDraft): string | null {
    let source: string;
    const title = newScoreDraft.title.trim();
    try {
      source = createBlankMusicXml({ title, tempo: Number(newScoreDraft.tempo), numerator: Number(newScoreDraft.numerator),
        denominator: Number(newScoreDraft.denominator), measures: Number(newScoreDraft.measures),
        tuning: newScoreDraft.tuningPreset === 'open-g' ? OPEN_G_TUNING : newScoreDraft.tuning.map(Number) });
    } catch (failure) { return (failure as Error).message; }
    setNewScoreOpen(false);
    requestLeave(() => {
      try {
        const created = withPreviewTitle(readMusicXml(source, `${title.slice(0, 148)}.musicxml`, 'musicxml'), title);
        loadPreview(created, [], null, null, source);
        setEditMode(true);
        setSelection(selectionAtPosition({ track: 1, staff: 1, measure: 1, event: 1, voice: 1, string: 1, kind: 'empty', noteId: null, fret: null,
          graceIndex: null, graceGroupId: null }, demo, created, {}));
        setMessage(`New score “${title}” created. It is not saved until you choose Save to library.`);
      } catch (failure) { setError((failure as Error).message); }
    }, newScoreOpener.current);
    return null;
  }
  function openPickupDialog(opener: HTMLElement) {
    if (!selection || selection.measure !== 1) return;
    if (pendingFret) { setError('Apply the pending fret before changing the pickup.'); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      pickupOpener.current = opener;
      setPickupTarget({ originalKey: documentKey(currentDocument), base });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function confirmPickupChange(nextSource: string): string | null {
    if (!pickupTarget) return null;
    if (pickupTarget.originalKey !== documentKey(currentDocument)) {
      setPickupTarget(null); setError('The score changed since this pickup preview. Open it again.'); return null;
    }
    try {
      const { base } = pickupTarget;
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), base.score.title);
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: null,
        sourceIdentity: nextPreview.sourceIdentity }, 'Change pickup length');
      setPreview(nextPreview); setSelection(null); setPickupTarget(null); setPassage(null);
      setMessage('Pickup length changed. Edit and playback selections cleared.'); setError('');
      return null;
    } catch (failure) { return (failure as Error).message; }
  }
  function beginTransition(kind: TransitionKind) {
    const name = TRANSITION_NAMES[kind];
    if (!selection || selection.kind !== 'note' || selection.string === null || selection.fret === null) {
      setError(`Select a pitched note as the ${name} origin.`); return;
    }
    if (pendingFret) { setError(`Apply the pending fret before starting a ${name}.`); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      if (kind === 'tie' && inspectMusicXmlTie(base.source, base.score, tiePosition(selection)).canRemove) {
        throw new Error('This note already has a tie. Remove it before starting another.');
      }
      if (kind !== 'tie' && inspectMusicXmlTransitions(base.source, base.score, tiePosition(selection)).some(item => item.direction === 'outgoing')) {
        throw new Error(`This note already starts a tie or transition. Remove it before starting a ${name}.`);
      }
      setPendingTie({ originalKey: documentKey(currentDocument), base, origin: selection, kind });
      setMessage(kind === 'tie' ? 'Choose the following same-string, same-pitch note, or navigate and use selected note.'
        : `Choose the next note on string ${selection.string}, or navigate and use selected note.`); setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function completeTransition(destination: ScoreSelection) {
    if (!pendingTie) return;
    const name = TRANSITION_NAMES[pendingTie.kind];
    if (destination.kind !== 'note' || destination.string === null || destination.fret === null) {
      setError(`${capitalized(name)} destination must be a pitched note. Choose another note or cancel.`); return;
    }
    if (pendingTie.originalKey !== documentKey(currentDocument)) {
      setPendingTie(null); setError(`The score changed since the ${name} origin was selected. Start again.`); return;
    }
    try {
      const { base, origin, kind } = pendingTie;
      const nextSource = connectMusicXmlTransition(base.source, base.score, kind, tiePosition(origin), tiePosition(destination));
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), base.score.title);
      const after = selectionAtPosition(destination, score, nextPreview, {});
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after,
        sourceIdentity: nextPreview.sourceIdentity }, `Add ${name}`);
      setPreview(nextPreview); setSelection(after); setPendingTie(null); setPassage(null);
      setMessage(`${capitalized(name)} added between the selected notes.`); setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function removeTransition(transition: NoteTransition) {
    if (!preview || !selection || selection.kind !== 'note' || selection.string === null || selection.fret === null) return;
    const name = TRANSITION_NAMES[transition.kind];
    if (pendingFret) { setError(`Apply the pending fret before removing a ${name}.`); return; }
    try {
      const nextSource = removeMusicXmlTransition(preview.source, preview.score, tiePosition(selection), transition.kind, transition.direction);
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, preview.filename, preview.sourceFormat,
        preview.sourceIdentity ? { source: preview.source, map: preview.sourceIdentity } : undefined), preview.score.title);
      const after = selectionAtPosition(selection, score, nextPreview, {});
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after,
        sourceIdentity: nextPreview.sourceIdentity }, `Remove ${name}`);
      setPreview(nextPreview); setSelection(after); setPassage(null); setMessage(`${capitalized(name)} removed.`); setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function removeSelectedTie() {
    if (!preview || !selection || selection.kind !== 'note' || selection.string === null || selection.fret === null) return;
    if (pendingFret) { setError('Apply the pending fret before removing a tie.'); return; }
    try {
      const nextSource = removeMusicXmlTie(preview.source, preview.score, tiePosition(selection));
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, preview.filename, preview.sourceFormat,
        preview.sourceIdentity ? { source: preview.source, map: preview.sourceIdentity } : undefined), preview.score.title);
      const after = selectionAtPosition(selection, score, nextPreview, {});
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after,
        sourceIdentity: nextPreview.sourceIdentity }, 'Remove tie');
      setPreview(nextPreview); setSelection(after); setPassage(null); setMessage('Tie removed.'); setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function moveSelectedString() {
    if (!selection || selection.kind !== 'note' || selection.string === null) return;
    const destination = Number(moveString);
    if (!Number.isInteger(destination) || destination < 1 || destination > 5 || destination === selection.string) return;
    if (!moveOutcome || moveOutcome.reason) { if (moveOutcome?.reason) setError(moveOutcome.reason); return; }
    const fret = moveOutcome.fret;
    const after = { ...selection, string: destination, fret };
    if (!updateSelectedScore(selection, notes => {
      const existing = notes.find(note => note.string === selection.string);
      if (!existing) return;
      existing.string = destination;
      existing.fret = fret;
      notes.sort((left, right) => left.string - right.string);
    }, note => { note.string = destination; note.fret = fret; }, after,
    `Move note to string ${destination}${moveMode === 'pitch' ? ` keeping pitch (fret ${fret})` : ''}`, undefined, destination)) return;
    setSelection(after);
  }
  function commitImportedRemoval(nextSource: string, selectionToDelete: ScoreSelection, mode: RemovalMode) {
    if (!preview) return;
    if (selectionToDelete.graceIndex !== null) { commitGraceRemoval(nextSource, selectionToDelete, mode); return; }
    try {
      const beat = preview.score.tracks[0]?.staves[0]?.bars[selectionToDelete.measure - 1]?.voices[selectionToDelete.voice - 1]?.beats[selectionToDelete.event - 1];
      const lastMember = mode === 'rest' || beat?.notes.length === 1;
      const carryEvent = sourceEventCount(preview.source, selectionToDelete.measure - 1, selectionToDelete.voice)
        === sourceEventCount(nextSource, selectionToDelete.measure - 1, selectionToDelete.voice);
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, preview.filename, preview.sourceFormat,
        preview.sourceIdentity ? { source: preview.source, map: preview.sourceIdentity,
          carries: structuralCarries(preview, selectionToDelete, carryEvent) } : undefined), preview.score.title);
      const nextBeats = nextPreview.score.tracks[0]?.staves[0]?.bars[selectionToDelete.measure - 1]?.voices[selectionToDelete.voice - 1]?.beats ?? [];
      const matchingEvent = beat ? nextBeats.findIndex(candidate => !candidate.graceType && candidate.playbackStart === beat.playbackStart) : -1;
      const after: ScoreSelection = { ...selectionToDelete, event: matchingEvent < 0 ? selectionToDelete.event : matchingEvent + 1,
        kind: lastMember ? 'rest' : 'empty', noteId: null, fret: null, sourceId: undefined };
      refreshStructuralSelection(after, nextPreview);
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after, sourceIdentity: nextPreview.sourceIdentity }, mode === 'rest' ? 'Make rest' : 'Remove note');
      setPreview(nextPreview);
      setSelection(after);
      setError('');
      documentRefocus();
    } catch (failure) { setError((failure as Error).message); }
  }
  function commitGraceRemoval(nextSource: string, selectionToDelete: ScoreSelection, mode: RemovalMode) {
    if (!preview) return;
    try {
      const carryEvent = sourceEventCount(preview.source, selectionToDelete.measure - 1, selectionToDelete.voice)
        === sourceEventCount(nextSource, selectionToDelete.measure - 1, selectionToDelete.voice);
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, preview.filename, preview.sourceFormat,
        preview.sourceIdentity ? { source: preview.source, map: preview.sourceIdentity,
          carries: structuralCarries(preview, selectionToDelete, carryEvent) } : undefined), preview.score.title);
      // A removed grace event hands its index to the next grace event or to
      // the ordinary destination, so the selection stays beside the edit.
      const after = selectionAtPosition(selectionToDelete, score, nextPreview, {});
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after, sourceIdentity: nextPreview.sourceIdentity },
        mode === 'grace' ? 'Remove grace' : 'Remove grace note');
      setPreview(nextPreview); setSelection(after); setError('');
      setMessage(mode === 'grace' ? 'Grace event removed.' : 'Grace note removed.');
      documentRefocus();
    } catch (failure) { setError((failure as Error).message); }
  }
  function requestRemoval(selectionToDelete: ScoreSelection, mode: RemovalMode = 'note') {
    if (selectionToDelete.kind !== 'note' || selectionToDelete.string === null) return;
    if (preview && selectionToDelete.graceIndex !== null) {
      try {
        const result = removeMusicXmlGrace(preview.source, preview.score, {
          measure: selectionToDelete.measure - 1, beat: selectionToDelete.event - 1,
          voice: selectionToDelete.voice - 1, string: mode === 'grace' ? undefined : selectionToDelete.string,
        });
        if (result.dependencies.length) {
          removalOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setPendingRemoval({ beforeSource: preview.source, afterSource: result.source, selection: selectionToDelete, mode, dependencies: result.dependencies });
        } else commitGraceRemoval(result.source, selectionToDelete, mode);
      } catch (failure) { setError((failure as Error).message); }
      return;
    }
    if (mode === 'grace') return;
    if (preview) {
      try {
        const result = removeMusicXmlNotes(preview.source, preview.score, {
          measure: selectionToDelete.measure - 1, beat: selectionToDelete.event - 1,
          voice: selectionToDelete.voice - 1, string: mode === 'note' ? selectionToDelete.string : undefined,
        });
        if (!result) return;
        if (result.dependencies.length) {
          removalOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setPendingRemoval({ beforeSource: preview.source, afterSource: result.source, selection: selectionToDelete, mode, dependencies: result.dependencies });
        } else commitImportedRemoval(result.source, selectionToDelete, mode);
      } catch (failure) { setError((failure as Error).message); }
      return;
    }
    const beat = score.measures[selectionToDelete.measure - 1]?.beats[selectionToDelete.event - 1];
    if (!beat?.notes.some(note => note.string === selectionToDelete.string)) return;
    const lastMember = mode === 'rest' || beat.notes.length === 1;
    const after: ScoreSelection = { ...selectionToDelete, kind: lastMember ? 'rest' : 'empty', noteId: null, fret: null };
    if (!updateSelectedScore(selectionToDelete, notes => {
      if (mode === 'rest') notes.splice(0);
      else {
        const index = notes.findIndex(note => note.string === selectionToDelete.string);
        if (index >= 0) notes.splice(index, 1);
      }
    }, note => { note.deleted = true; }, after, mode === 'rest' ? 'Make rest' : 'Remove note')) return;
    setSelection(after);
    documentRefocus();
  }
  function confirmRemoval() {
    const pending = pendingRemoval;
    if (!pending) return;
    setPendingRemoval(null);
    if (!preview || preview.source !== pending.beforeSource) {
      setError('The score changed while removal was pending. Select the event again.');
      return;
    }
    commitImportedRemoval(pending.afterSource, pending.selection, pending.mode);
  }
  function hasUnsavedWork() {
    return documentKey(currentDocumentRef.current) !== (savedBaseline.current ?? documentKey(initialSnapshot.current.document)) || pendingFretRef.current !== null || saveInFlight.current !== null;
  }
  function requestLeave(action: () => void | Promise<void>, opener: HTMLElement | null = document.activeElement as HTMLElement | null) {
    if (!hasUnsavedWork()) { void action(); return; }
    leaveAction.current = action;
    leaveOpener.current = opener;
    setGuardError(''); setLeaveOpen(true);
  }
  function cancelLeave() {
    setLeaveOpen(false); setGuardError(''); leaveAction.current = null;
    if (leaveOpener.current?.isConnected) requestAnimationFrame(() => leaveOpener.current?.focus({ preventScroll: true }));
  }
  function restoreSnapshot(snapshot: SessionSnapshot) {
    if (isImportedScoreDocument(snapshot.document)) loadPreview(readImportedDocument(snapshot.document), snapshot.diagnostics, snapshot.id, snapshot.revision, snapshot.original);
    else load(snapshot.document, snapshot.original, snapshot.diagnostics, snapshot.id, snapshot.revision);
  }
  function askDiscard(action: () => void | Promise<void>) {
    discardAction.current = action;
    setDiscardOpen(true);
  }
  async function confirmDiscard() {
    const action = discardAction.current;
    discardAction.current = null;
    setDiscardOpen(false);
    if (action) await action();
  }
  function commitPendingFret() {
    const pending = pendingFretRef.current;
    if (!pending) return true;
    if (!/^\d+$/.test(pending.value)) {
      setError('Enter a whole-number fret before saving or leaving.');
      return false;
    }
    if (Number(pending.value) === pending.selection.fret) {
      flushSync(() => setFretEdit(null));
      return true;
    }
    const before = documentKey(currentDocumentRef.current);
    flushSync(() => updateSelectionFret(pending.selection, Number(pending.value)));
    if (documentKey(currentDocumentRef.current) === before) {
      document.querySelector<HTMLInputElement>('[aria-label="Fret"]')?.focus({ preventScroll: true });
      return false;
    }
    return true;
  }
  function navigateInspector(changes: Partial<Pick<ScoreSelection, 'measure' | 'event' | 'voice' | 'string'>>) {
    if (!commitPendingFret()) return;
    setSelection(current => current ? selectionAtPosition(current, score, preview, changes) : current);
  }
  async function saveCurrent() {
    if (!commitPendingFret()) return false;
    return save();
  }
  async function saveAndContinue() {
    setGuardError('');
    if (!commitPendingFret()) {
      leaveAction.current = null; setLeaveOpen(false);
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Fret"]')?.focus({ preventScroll: true }));
      return;
    }
    if (!hasUnsavedWork()) {
      const action = leaveAction.current;
      leaveAction.current = null; setLeaveOpen(false);
      if (action) await action();
      return;
    }
    const saved = await save();
    if (!saved) { setGuardError('Save failed. Your work is still here; retry or cancel.'); return; }
    if (hasUnsavedWork()) { setGuardError('More changes were made while saving. Save and continue again.'); return; }
    const action = leaveAction.current;
    leaveAction.current = null;
    setLeaveOpen(false);
    if (action) await action();
  }
  async function openSong(id: number) {
    try {
      const song = await apiRequest(`/api/songs/${id}`);
      validateStoredScore(song.score);
      const candidate = isImportedScoreDocument(song.score) ? readImportedDocument(song.score) : null;
      requestLeave(() => {
        if (candidate) loadPreview(candidate, song.score.warnings, id, song.revision, song.source_text);
        else load(song.score, song.source_text, song.source_text ? ['Imported from plaintext using equal-note rhythm. Original text is preserved with this score.'] : [], id, song.revision);
      });
    } catch (e) { setError((e as Error).message); }
  }
  async function reloadSavedVersion() {
    if (savedId === null) return;
    try {
      const song = await apiRequest(`/api/songs/${savedId}`);
      validateStoredScore(song.score);
      if (isImportedScoreDocument(song.score)) restoreSnapshot({ document: song.score, original: song.source_text, diagnostics: song.score.warnings, id: savedId, revision: song.revision });
      else restoreSnapshot({ document: song.score, original: song.source_text, diagnostics: song.source_text ? ['Imported from plaintext using equal-note rhythm. Original text is preserved with this score.'] : [], id: savedId, revision: song.revision });
    } catch (failure) { setError((failure as Error).message); }
  }
  async function save(copyName?: string): Promise<boolean> {
    if (saveInFlight.current !== null) return false;
    const token = ++saveSequence.current;
    saveInFlight.current = token;
    setSaving(true); setSaveError(''); setConflicted(false); setMessage(''); setFailedCopyName(null);
    const savingSession = session.current;
    const copy = copyName !== undefined;
    const id = savedId;
    const revision = savedRevision;
    try {
      const document = { ...currentDocumentRef.current, ...(copy ? { title: copyName } : {}) };
      const updating = id !== null && !copy;
      const item: LibraryItem = await apiRequest(updating ? `/api/songs/${id}` : '/api/songs', {
        method: updating ? 'PATCH' : 'POST',
        body: JSON.stringify({ score: document, source_text: source, ...(updating ? { revision } : {}) }),
      });
      if (savingSession !== session.current) return false;
      if (copy) {
        const latest = { ...currentDocumentRef.current, title: copyName };
        currentDocumentRef.current = latest;
        if (preview) setPreview(current => current ? withPreviewTitle(current, copyName) : current);
        else setScore(current => ({ ...current, title: copyName }));
      }
      savedBaseline.current = documentKey(document);
      setConflicted(false);
      savedSnapshot.current = { document, original: source, diagnostics: warnings, id: item.id, revision: item.revision ?? null };
      setHistoryRevision(value => value + 1);
      setSavedId(item.id); setSavedRevision(item.revision ?? null);
      setDirty(documentKey(currentDocumentRef.current) !== savedBaseline.current);
      setLibrary(items => updating ? items.map(existing => existing.id === item.id ? item : existing) : [item, ...items]);
      setMessage(copy ? 'Saved a copy to your library.' : updating ? 'Changes saved.' : 'Saved to your library.');
      return true;
    } catch (e) {
      if (savingSession === session.current) {
        setSaveError((e as Error).message); setFailedCopyName(copy ? copyName : null);
        if (e instanceof ApiError && e.status === 409) {
          setConflicted(true); setLeaveOpen(false); leaveAction.current = null; setConflictOpen(true);
        }
      }
      return false;
    } finally {
      if (saveInFlight.current === token) { saveInFlight.current = null; setSaving(false); }
    }
  }
  function openCopyDialog() {
    const name = (preview?.score.title ?? score.title).trim();
    setCopyTitle(`${name.slice(0, 153)} — copy`.slice(0, 160));
    setCopyOpen(true);
  }
  async function readFile(file?: File) {
    if (!file) return;
    setImportError('');
    const extension = file.name.split('.').pop()?.toLowerCase();
    const isXml = extension === 'xml' || extension === 'musicxml';
    const isTef = extension === 'tef';
    const isPdf = extension === 'pdf';
    if (!['txt', 'json', 'xml', 'musicxml', 'tef', 'pdf'].includes(extension ?? '')) { setImportError('Choose a .tef, .txt, Playtab .json, .musicxml, or .pdf file.'); return; }
    const limit = isXml ? 2_000_000 : isPdf ? 10_000_000 : 100_000;
    if (file.size > limit) { setImportError(isXml ? 'Choose MusicXML smaller than 2 MB.' : isPdf ? 'Choose a PDF smaller than 10 MB.' : 'Choose a file smaller than 100 KB.'); return; }
    setReading(true);
    try {
      let contents: string;
      let conversionWarnings: string[] = [];
      if (isTef || isPdf) {
        const form = new FormData();
        form.append('file', file);
        const converted = await apiRequest(isPdf ? '/api/pdf_imports' : '/api/tef_imports', { method: 'POST', body: form, signal: AbortSignal.timeout(isPdf ? 120000 : 25000) });
        contents = converted.musicxml;
        conversionWarnings = converted.warnings;
      } else contents = await file.text();
      if (isXml || isTef || isPdf) {
        const filename = isTef || isPdf ? file.name.replace(/\.(tef|pdf)$/i, '.musicxml') : file.name;
        const candidate = readMusicXml(contents, filename, isTef ? 'tef' : isPdf ? 'pdf' : 'musicxml');
        const diagnostics = isTef || isPdf ? conversionWarnings : ['MusicXML preview: tuning and rhythm come from the file. Save this score to preserve the imported document in your library.'];
        requestLeave(() => { loadPreview(candidate, diagnostics); dialog.current?.close(); });
      } else if (extension === 'json') {
        const document: unknown = JSON.parse(contents); validateScore(document);
        requestLeave(() => { load(document, null); dialog.current?.close(); });
      } else { setText(contents); setTitle(file.name.replace(/\.txt$/i, '').slice(0, 160)); }
    } catch (e) { setImportError((e as Error).message); } finally { setReading(false); }
  }
  function importText() {
    try {
      const result = parseAscii(text, title, duration);
      requestLeave(() => { load(result.score, text, result.warnings); dialog.current?.close(); });
    } catch (e) { setImportError((e as Error).message); }
  }
  // Read-only facts about the selected location: exact offset from the bar
  // start, sounding pitch, grace-group navigation, and string-move outcome.
  const selectedBeats = selection ? preview?.score.tracks?.[0]?.staves?.[0]?.bars?.[selection.measure - 1]?.voices?.[selection.voice - 1]?.beats : undefined;
  const selectedDetails = (() => {
    if (!selection) return null;
    const gcd = (left: number, right: number): number => right ? gcd(right, left % right) : left;
    let numerator = 0; let denominator = 1; let pitch: number | null = null; const tuning = preview ? preview.score.tracks?.[0]?.staves?.[0]?.tuning ?? [] : score.tuning;
    if (preview) {
      const beat = selectedBeats?.[selection.event - 1];
      if (!beat) return null;
      const ticks = Math.round(beat.playbackStart);
      const divisor = gcd(ticks, 960) || 960;
      numerator = ticks / divisor; denominator = 960 / divisor;
      const note = beat.notes.find(item => selection.string !== null && 6 - item.string === selection.string);
      pitch = note ? note.realValue : null;
    } else {
      const beats = score.measures[selection.measure - 1]?.beats ?? [];
      const sixteenths = beats.slice(0, selection.event - 1).reduce((sum, beat) => sum + 16 / beat.duration, 0);
      const divisor = gcd(sixteenths, 4) || 4;
      numerator = sixteenths / divisor; denominator = 4 / divisor;
      const note = beats[selection.event - 1]?.notes.find(item => item.string === selection.string);
      pitch = note ? tuning[note.string - 1] + note.fret : null;
    }
    const offset = numerator === 0 ? 'Offset 0' : `Offset ${denominator === 1 ? numerator : `${numerator}/${denominator}`} quarter note${numerator / denominator > 1 ? 's' : ''}`;
    let grace: { options: { label: string; event: number }[] } | null = null;
    if (selectedBeats) {
      const index = selection.event - 1;
      let destination = index;
      while (selectedBeats[destination]?.graceType) destination++;
      let start = destination;
      while (start > 0 && selectedBeats[start - 1]?.graceType) start--;
      if (start < destination && selectedBeats[destination]) {
        grace = { options: [...Array.from({ length: destination - start }, (_, at) => ({ label: `Grace ${at + 1}`, event: start + at + 1 })), { label: 'Main', event: destination + 1 }] };
      }
    }
    return { offset, pitch: pitch === null ? 'Rest / empty string' : midiName(pitch), pitchValue: pitch, tuning, grace };
  })();
  const moveOutcome = (() => {
    if (!selection || selection.kind !== 'note' || selection.fret === null || !selectedDetails || selectedDetails.pitchValue === null) return null;
    const destination = Number(moveString);
    if (!Number.isInteger(destination) || destination === selection.string) return null;
    const fret = moveMode === 'fret' ? selection.fret : selectedDetails.pitchValue - selectedDetails.tuning[destination - 1];
    const occupied = preview ? selectedBeats?.[selection.event - 1]?.notes.some(note => 6 - note.string === destination)
      : score.measures[selection.measure - 1]?.beats[selection.event - 1]?.notes.some(note => note.string === destination);
    const reason = occupied ? `String ${destination} already has a note in this event.`
      : !Number.isInteger(fret) || fret < 0 || fret > 36 ? `Keeping the pitch would need fret ${fret} on string ${destination}, outside 0–36.` : null;
    return { destination, fret, pitch: midiName(selectedDetails.tuning[destination - 1] + fret), reason };
  })();
  const selectedEventCount = selection ? (preview
    ? preview.score.tracks?.[0]?.staves?.[0]?.bars?.[selection.measure - 1]?.voices?.[selection.voice - 1]?.beats.length ?? 1
    : score.measures[selection.measure - 1]?.beats.length ?? 1) : 1;
  const selectedRhythm = selection ? preview
    ? inspectMusicXmlDuration(preview.source, { measure: selection.measure - 1, beat: selection.event - 1,
      voice: selection.voice - 1 })
    : { denominator: score.measures[selection.measure - 1]?.beats[selection.event - 1]?.duration ?? null,
      dots: 0, rest: selection.kind === 'rest', reason: undefined } : null;
  const selectedTriplet = selection && preview ? inspectMusicXmlTriplet(preview.source,
    { measure: selection.measure - 1, beat: selection.event - 1, voice: selection.voice - 1 }) : null;
  const selectedTupletLocked = Boolean(selectedTriplet?.triplet || selectedTriplet?.reason);
  const selectedTransitions: NoteTransition[] = (() => {
    if (!selection || !preview || selection.kind !== 'note' || selection.string === null || selection.fret === null) return [];
    try { return inspectMusicXmlTransitions(preview.source, preview.score, tiePosition(selection)).filter(item => item.kind !== 'tie'); }
    catch { return []; }
  })();
  const selectedTie = (() => {
    if (!selection || !preview || selection.kind !== 'note' || selection.string === null || selection.fret === null) return false;
    try { return inspectMusicXmlTie(preview.source, preview.score, tiePosition(selection)).canRemove; }
    catch { return false; }
  })();
  const selectedTechniques: NoteTechniqueInfo | null = (() => {
    if (!selection || selection.kind !== 'note' || selection.string === null || selection.fret === null) return null;
    if (!preview) return { picking: 'none', fretting: 'none', bend: 'none' };
    try { return inspectMusicXmlNoteTechniques(preview.source, preview.score, tiePosition(selection)); }
    catch (failure) {
      const reason = (failure as Error).message;
      return { picking: null, pickingReason: reason, fretting: null, frettingReason: reason, bend: null, bendReason: reason };
    }
  })();
  const selectedHasGrace = Boolean(selection && (selection.graceIndex !== null || selectedBeats?.[selection.event - 2]?.graceType));
  const measureCount = preview?.score.masterBars.length ?? score.measures.length;
  const onSelection = (run: (current: ScoreSelection) => void) => (_opener: HTMLElement) => { if (selection) run(selection); };
  const noteSelected = selection?.kind === 'note';
  const graceReason = selection?.graceIndex !== null && selection ? 'Not available on a grace note' : undefined;
  const tupletReason = !selectedRhythm ? 'Select an event first' : selectedTupletLocked ? selectedTriplet?.reason ?? 'Change the triplet as a whole' : undefined;
  const wholeRange = wholeMeasurePassage();
  const rangeReason = !passage ? 'Select a range first' : !wholeRange ? 'Select whole measures first' : undefined;
  const playReason = playerControls.current?.canPlay ? undefined : 'Playback is not ready yet';
  // The status bar summarises the selection in the compact form other
  // notation editors use, e.g. "M3 E2 S4 · fret 5 · G3 · 1/8".
  const durationText = selectedRhythm?.denominator
    ? `${selectedRhythm.rest ? 'rest ' : ''}${selectedRhythm.denominator === 1 ? '1' : `1/${selectedRhythm.denominator}`}${'.'.repeat(selectedRhythm.dots)}` : null;
  const statusSelection = passage ? rangeDescription(passage, wholeRange) : selection
    ? [`M${selection.measure} E${selection.event}${selection.string !== null ? ` S${selection.string}` : ''}`,
      selection.fret !== null ? `fret ${selection.fret}` : null, selectedDetails?.pitchValue != null ? selectedDetails.pitch : null, durationText]
      .filter(Boolean).join(' · ')
    : 'Nothing selected';
  const commands: EditorCommands = {
    undo: { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !history.undo.length,
      title: history.undo.length ? `Undo: ${history.undo.at(-1)!.description}` : 'Nothing to undo', run: () => moveHistory('undo') },
    redo: { label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: !history.redo.length,
      title: history.redo.length ? `Redo: ${history.redo.at(-1)!.description}` : 'Nothing to redo', run: () => moveHistory('redo') },
    'apply-fret': { label: noteSelected ? 'Apply' : 'Add note', disabled: selection?.string == null,
      run: onSelection(current => updateSelectionFret(current, Number(fretDraft))) },
    'move-string': { label: 'Move', disabled: !moveOutcome || Boolean(moveOutcome.reason), run: () => moveSelectedString() },
    'remove-note': { label: 'Remove note', shortcut: 'Delete', className: 'editor-remove-note', disabled: !noteSelected, run: onSelection(current => requestRemoval(current)) },
    'make-rest': { label: 'Make rest', hidden: !noteSelected || selection?.graceIndex !== null, reason: 'Select a note first', run: onSelection(current => requestRemoval(current, 'rest')) },
    ...Object.fromEntries(DURATION_DENOMINATORS.map(value => [`duration-${value}`, {
      label: value === 1 ? '1' : `1/${value}`, iconOnly: true, ariaLabel: value === 1 ? 'Whole note duration' : `1/${value} duration`,
      pressed: selectedRhythm ? selectedRhythm.denominator === value && selectedRhythm.dots === 0 : undefined,
      disabled: !selectedRhythm || selectedTupletLocked, reason: tupletReason, run: () => changeSelectedDuration(value, false),
    } satisfies EditorCommand])),
    dotted: { label: 'Dotted', className: 'editor-dotted-button', pressed: selectedRhythm ? selectedRhythm.dots === 1 : undefined,
      disabled: !selectedRhythm || selectedRhythm.denominator === null || selectedTupletLocked,
      run: () => selectedRhythm && changeSelectedDuration(selectedRhythm.denominator!, selectedRhythm.dots !== 1) },
    'split-rest': { label: 'Split rest', className: 'editor-split-rest',
      disabled: !selectedRhythm?.rest || selectedRhythm.denominator === null || selectedRhythm.denominator === 64 || selectedRhythm.dots !== 0 || selectedTupletLocked,
      run: () => selectedRhythm && changeSelectedDuration((selectedRhythm.denominator! * 2) as DurationDenominator, false) },
    'insert-event': { label: 'Insert event…', className: 'editor-insert-event', disabled: !selection, run: opener => openInsertEvent(opener) },
    'set-tempo': { label: 'Set tempo here…', className: 'editor-insert-event', disabled: !selection || selection.graceIndex !== null, reason: graceReason, run: opener => openTempoDialog(opener) },
    triplet: { label: 'Triplet', className: 'editor-triplet-button',
      disabled: !selectedRhythm || selectedTupletLocked || selectedRhythm.denominator === null || selectedRhythm.denominator === 64 || selectedRhythm.dots !== 0,
      run: () => changeSelectedTriplet(false) },
    'remove-triplet': { label: 'Remove triplet', className: 'editor-remove-triplet', hidden: !selectedTriplet?.triplet,
      disabled: !selectedTriplet?.canRemove, run: () => changeSelectedTriplet(true) },
    grace: { label: selectedHasGrace ? 'Edit grace…' : 'Add grace…', disabled: !noteSelected, reason: 'Select a note first', run: opener => openGraceDialog(opener) },
    'remove-grace': { label: 'Remove grace', hidden: !noteSelected || selection?.graceIndex === null, run: onSelection(current => requestRemoval(current, 'grace')) },
    bend: { label: 'Bend…', disabled: !selectedTechniques, reason: 'Select a note first', run: opener => openBendDialog(opener) },
    ...Object.fromEntries(TRANSITION_COMMANDS.map(kind => [kind, {
      label: capitalized(TRANSITION_NAMES[kind]), disabled: !noteSelected || pendingTie !== null,
      reason: pendingTie ? 'Finish or cancel the pending transition first' : 'Select a note first', run: () => beginTransition(kind),
    } satisfies EditorCommand])),
    'remove-tie': { label: 'Remove tie', hidden: !selectedTie, run: () => removeSelectedTie() },
    ...Object.fromEntries((['chord', 'section', 'words'] as AnchorKind[]).map(kind => [kind, {
      label: `${ANCHOR_NAMES[kind].title}…`, disabled: !selection || selection.graceIndex !== null, reason: graceReason, run: opener => openAnchorDialog(kind, opener),
    } satisfies EditorCommand])),
    lyric: { label: 'Lyric syllable…', disabled: !selection || selection.graceIndex !== null, reason: graceReason, run: opener => openLyricDialog(opener) },
    'lyrics-chords': { label: 'Lyrics & chords…', run: opener => openStandaloneDialog(opener) },
    'range-start': { label: 'Set range start', disabled: !selection, run: onSelection(current => setPassage({ start: current, end: current })) },
    'range-end': { label: 'Set range end', disabled: !passage || !selection, run: onSelection(current => {
      if (!passage) return;
      const first = passage.start.measure < current.measure || passage.start.measure === current.measure && passage.start.event <= current.event;
      setPassage(first ? { start: passage.start, end: current } : { start: current, end: passage.start });
    }) },
    'clear-passage': { label: 'Clear passage', disabled: !passage, run: () => setPassage(null) },
    'clear-range': { label: 'Clear to rests…', icon: 'make-rest', shortcut: 'Delete', disabled: !passage, run: opener => openClearRange(opener) },
    'copy-passage': { label: 'Copy passage', shortcut: 'Ctrl+C', disabled: Boolean(rangeReason), reason: rangeReason, run: () => copyPassage() },
    'cut-passage': { label: 'Cut passage…', shortcut: 'Ctrl+X', disabled: Boolean(rangeReason), reason: rangeReason, run: opener => openCutDialog(opener) },
    'paste-passage': { label: 'Paste passage…', shortcut: 'Ctrl+V', disabled: !clipboard || !selection, reason: 'Copy or cut measures first', run: opener => openPasteDialog(opener) },
    'select-measure': { label: 'Select measure', disabled: !selection, run: () => selectWholeMeasure() },
    'insert-measure-before': { label: 'Insert measure before', disabled: !selection, run: () => insertSelectedMeasure('before') },
    'insert-measure-after': { label: 'Insert measure after', disabled: !selection, run: () => insertSelectedMeasure('after') },
    'duplicate-measure': { label: 'Duplicate measure…', disabled: !selection, run: opener => previewDuplicateMeasure(opener) },
    'delete-measure': { label: 'Delete measure…', disabled: !selection || measureCount <= 1, reason: 'The last remaining measure cannot be deleted', run: opener => previewDeleteMeasure(opener) },
    'time-signature': { label: 'Time signature…', disabled: !selection, run: opener => openMeterDialog(opener) },
    repeat: { label: 'Repeat / endings…', disabled: !selection, run: opener => openRepeatDialog(opener) },
    pickup: { label: 'Pickup…', disabled: selection?.measure !== 1, reason: 'Only the first measure can be a pickup', run: opener => openPickupDialog(opener) },
    'edit-fret': { label: noteSelected ? 'Edit fret…' : 'Add a note…', icon: noteSelected ? 'edit-tools' : 'add-note', disabled: selection?.string == null,
      reason: 'Select a string position first', run: () => focusFretEntry() },
    'play-from-here': { label: 'Play from here', icon: 'play', disabled: !selection || Boolean(playReason), reason: playReason, run: () => playerControls.current?.playFrom() },
    'play-selection': { label: passage ? 'Play range' : 'Play selection', icon: 'play', disabled: !selection || Boolean(playReason), reason: playReason, run: () => playerControls.current?.playSelection() },
    'score-settings': { label: 'Score settings…', run: opener => openSettingsDialog(opener) },
    'keyboard-help': { label: 'Keyboard help…', shortcut: '?', run: () => setHelpOpen(true) },
  };
  const measureEntries: MenuEntry[] = ['select-measure', 'insert-measure-before', 'insert-measure-after', 'duplicate-measure', 'delete-measure', 'time-signature', 'repeat'];
  const durationEntries: MenuEntry = { label: 'Duration', items: [...DURATION_COMMANDS, 'dotted', 'split-rest', 'triplet', 'remove-triplet'] };
  const textEntries: MenuEntry = { label: 'Text', items: ['chord', 'section', 'words', 'lyric'] };
  const contextEntries: MenuEntry[] = contextMenu?.scope === 'range' || contextMenu?.scope === 'measure'
    ? ['copy-passage', 'cut-passage', 'paste-passage', 'clear-range', '-', 'play-selection', 'clear-passage', '-', ...measureEntries]
    : noteSelected
      ? ['edit-fret', 'remove-note', 'make-rest', '-', durationEntries,
        { label: 'Techniques', items: ['tie', 'hammer-on', 'pull-off', 'slide', 'bend', 'grace', 'remove-grace', 'remove-tie'] }, textEntries,
        '-', 'paste-passage', '-', { label: 'Measure', items: measureEntries }, '-', 'play-from-here', 'play-selection']
      : ['edit-fret', 'insert-event', '-', durationEntries, textEntries, '-', 'paste-passage', '-', { label: 'Measure', items: measureEntries }, '-', 'play-from-here', 'play-selection'];
  const editorTools = <section className="editor-sidebar" aria-label="Edit tools">
        <div className="sidebar-section">EDIT SCORE</div>
        <p className="editor-selection-empty">Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z redoes. History lasts while this score is open; older actions expire after 100 edits or 32 MB.</p>
        <p className="editor-sidebar-status"><strong>Edit mode</strong><span>{selection ? 'Selection is ready for an edit.' : 'Select a note or empty string position to begin editing.'}</span></p>
        <div className="editor-selection" aria-label="Selection inspector">
          {passage && <p className="editor-range-summary" role="status">{rangeDescription(passage, wholeMeasurePassage())}</p>}
          {!selection ? <p className="editor-selection-empty">No note, rest, or staff position selected.</p> : <>
            <SelectionInspector selection={selection} details={selectedDetails} measureCount={measureCount} eventCount={selectedEventCount}
              onNavigate={navigateInspector} fretDraft={fretDraft} onFretDraft={setFretDraft} fretBuffered={Boolean(surfaceBuffer)}
              moveString={moveString} onMoveString={setMoveString} moveMode={moveMode} onMoveMode={setMoveMode} moveOutcome={moveOutcome} commands={commands} />
            {selectedRhythm && <RhythmTools rhythm={selectedRhythm} triplet={selectedTriplet} tupletLocked={selectedTupletLocked} commands={commands} />}
            <TechniqueTools selection={selection} techniques={selectedTechniques} onHand={changeHand} transitions={selectedTransitions}
              onRemoveTransition={removeTransition} pendingTransition={pendingTie} onCompleteTransition={() => completeTransition(selection)}
              onCancelTransition={() => { if (!pendingTie) return; const name = TRANSITION_NAMES[pendingTie.kind]; setPendingTie(null); setError(''); setMessage(`${capitalized(name)} cancelled.`); }}
              commands={commands} />
            <CommandGroup className="editor-text-tools" summary="Text" commands={commands} ids={['lyrics-chords']} />
            <CommandGroup className="editor-passage-tools" summary="Select passage" commands={commands}
              ids={['range-start', 'range-end', 'clear-passage', 'clear-range']}>
              {clipboard && <p className="editor-rhythm-reason">Clipboard: {clipboard.measures.length} measure{clipboard.measures.length === 1 ? '' : 's'} from “{clipboard.title}”.</p>}
            </CommandGroup>
            <CommandGroup className="editor-measure-tools" summary="Measure" commands={commands} ids={['select-measure', 'insert-measure-before', 'pickup']}>
              {measureCount <= 1 && <p>The last remaining measure cannot be deleted.</p>}
              {selection.measure !== 1 && <p>Pickup length is available only in the first measure.</p>}
            </CommandGroup>
          </>}
        </div>
        <CommandGroup className="editor-score-tools" summary="Score" commands={commands} ids={['score-settings', 'keyboard-help']} />
      </section>;
  return <div className={editMode ? 'shell edit-mode' : 'shell'}>
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Playtab home" onClick={event => { event.preventDefault(); requestLeave(() => window.location.assign('/'), event.currentTarget); }}><span className="brand-mark">♮</span>playtab<span className="brand-dot">.</span></a>
      <div className="sidebar-section">YOUR WORKSPACE</div>
      <button type="button" className="nav-item" onClick={event => openNewScoreDialog(event.currentTarget)}>＋ <span>New score</span></button>
      <button className="nav-item active" aria-expanded={!libraryCollapsed} onClick={() => { if (editMode) setLibraryCollapsed(current => !current); else document.getElementById('library-list')?.scrollIntoView(); }}>▤ <span>My library</span><span className="count">{library.length}</span></button>
      {!libraryCollapsed && <div className="library-list" id="library-list">
        {library.length === 0 ? <div className="empty-library"><p>A home for the tunes<br />you’re working on.</p><button type="button" className="practice-demo" onClick={event => requestLeave(() => load(demo, null), event.currentTarget)}>♩ <span>Practice demo</span></button></div> : library.map(item => <button className={savedId === item.id ? 'current' : ''} key={item.id} onClick={() => void openSong(item.id)}>{item.title}</button>)}
      </div>}
      {editMode && !narrow && editorTools}
      <div id="playback-controls" className="sidebar-playback" />
      <div className="sidebar-bottom"><div className="small-banjo">♫</div><p>A little practice,<br /><em>every day.</em></p><span>LOCAL WORKSPACE · EARLY PREVIEW</span></div>
    </aside>
    <main>
      <header className="topbar"><span>My library <span className="breadcrumb">/ Practice room</span></span><div className="account-controls">{userEmail() && <span className="account-email">{userEmail()}</span>}<button onClick={event => requestLeave(() => signOut().catch(e => setError(e.message)), event.currentTarget)}>Sign out</button><button className="primary" onClick={() => { setImportError(''); dialog.current?.showModal(); }}>＋ Import a tab</button></div></header>
      <div className="workspace">
        <div className="eyebrow">PICK UP WHERE THE MUSIC BEGINS</div>
        <div className="title-row"><h1>{preview?.score.title ?? score.title}</h1><div className="title-actions"><button type="button" className="edit-mode-toggle" aria-pressed={editMode} onClick={toggleEditMode}>{editMode ? 'Done editing' : 'Edit score'}</button>{editMode && narrow && <button type="button" className="edit-tools-toggle" aria-expanded={toolsOpen} aria-controls="edit-tools-sheet" onClick={() => setToolsOpen(open => !open)}>Edit tools</button>}<button className="save-button" disabled={saving || (!dirty && !pendingFret)} onClick={() => void saveCurrent()}>{saving ? 'Saving…' : savedId && !dirty && !pendingFret ? '✓ Saved' : savedId ? 'Save changes' : '＋ Save to library'}</button><details className="score-more"><summary>More</summary><button type="button" disabled={saving} onClick={openCopyDialog}>Save a copy…</button><button type="button" disabled={!hasDocumentEdits && !pendingFret} onClick={() => askDiscard(() => restoreSnapshot(savedSnapshot.current ?? initialSnapshot.current))}>Discard unsaved changes…</button></details></div></div>
        <p className="save-status" role="status">{saving ? 'Saving…' : conflicted ? 'Changed in another tab' : saveError ? 'Could not save' : savedId === null ? hasDocumentEdits || pendingFret ? 'Unsaved changes' : 'Not saved to library' : dirty || pendingFret ? 'Unsaved changes' : 'Saved'}</p>
        {saveError && <p className="alert" role="alert">{saveError} {conflicted ? <button type="button" onClick={() => setConflictOpen(true)}>Resolve conflict…</button> : <button type="button" disabled={saving} onClick={() => void (failedCopyName ? save(failedCopyName) : saveCurrent())}>Retry save</button>}</p>}
        {error && <p className="alert" role="alert">{error}</p>}
        {message && !editMode && <p className="success" role="status">{message}</p>}
        {warnings.length > 0 && showWarnings && <aside className="import-notice" role="note" aria-label="Import warnings"><div className="notice-heading"><strong>Check your import</strong><button type="button" className="notice-dismiss" aria-label="Dismiss import warnings" onClick={() => setShowWarnings(false)}>×</button></div>{warnings.map(warning => <p key={warning}>{warning}</p>)}</aside>}
        {showPracticeTip && <aside className="practice-note" role="note" aria-label="Practice tip"><span className="note-icon">✦</span><p><strong>Make it your pace.</strong> Slow down a tricky passage, loop it, and find your rhythm.</p><span className="practice-badge">PRACTICE MODE</span><button type="button" className="tip-dismiss" aria-label="Dismiss practice tip" onClick={() => setShowPracticeTip(false)}>×</button></aside>}
        {editMode && !narrow && <EditorToolbar commands={commands} />}
        <Player
          key="score"
          score={score}
          preview={preview}
          preferences={playerPreferences}
          onPreferencesChange={changes => setPlayerPreferences(current => ({ ...current, ...changes }))}
          editing={editMode}
          selection={selection}
          passage={passage}
          onSelectionChange={next => {
            const addressed = next ? { ...next,
              sourceId: next.noteId === null ? undefined : preview?.sourceIdByModelNoteId?.get(next.noteId),
              sourceMeasureId: preview?.sourceIdentity?.measureIds[next.measure - 1],
              sourceEventId: preview?.sourceEventIdByAddress?.get(`${next.measure - 1}:${next.voice}:${next.event - 1}`),
            } : null;
            // Moving to another location commits a valid buffered fret once;
            // an invalid one keeps the current selection and its error.
            if (addressed && pendingFretRef.current && !commitPendingFret()) return;
            setSelection(addressed);
            if (pendingTie && addressed) completeTransition(addressed);
          }}
          onPassageChange={setPassage}
          onFretKey={handleFretKey}
          onBeforeNavigate={commitPendingFret}
          onContextMenu={request => setContextMenu(request)} controlsRef={playerControls}
          onSelectionDelete={current => { if (passage) openClearRange(document.activeElement instanceof HTMLElement ? document.activeElement : null); else requestRemoval(current); }}
          exportBlockedReason={pendingFret ? 'Apply or clear the pending fret before exporting.' : null}
          historyRevision={historyRevision}
          compactTransportHost={editMode && narrow && toolsOpen ? sheetTransportHost : null}
          onRenderResult={handleRenderResult}
          sessionKey={session.current}
        />
        {editMode && <div className="editor-status-bar" role="status" aria-label="Editor status">
          <span className="editor-status-selection">{statusSelection}</span>
          {surfaceBuffer && <span className="editor-status-buffer">Fret {fretDraft} typed — Enter applies, Escape cancels</span>}
          {message && <span className="editor-status-message">{message}</span>}
        </div>}
        <div className="workspace-footer"><span>Made for five strings and a little patience.</span><span>Sound powered by alphaTab · MuseScore General Lite</span></div>
      </div>
    </main>
    {editMode && narrow && toolsOpen && <section id="edit-tools-sheet" className="edit-sheet" aria-label="Edit tools sheet">
      <div className="edit-sheet-header"><strong>Edit tools</strong>
        <button type="button" onClick={() => { setToolsOpen(false); document.querySelector<HTMLElement>('.edit-tools-toggle')?.focus(); }}>Close tools</button></div>
      <div ref={setSheetTransportHost} className="edit-sheet-transport" />
      <div className="edit-sheet-body"><EditorToolbar commands={commands} />{editorTools}</div>
    </section>}
    <DeleteMeasureDialog pending={pendingMeasureDeletion} onConfirm={confirmDeleteMeasure} onClose={() => setPendingMeasureDeletion(null)} returnFocus={deleteMeasureOpener} />
    <MeterDialog target={meterTarget} onApply={confirmMeterChange} onClose={() => setMeterTarget(null)} returnFocus={meterOpener} />
    <RepeatDialog target={repeatTarget} onAdd={confirmRepeat} onAddEndings={addRepeatEndings} onRequestRemoval={previewRepeatRemoval}
      onClose={() => setRepeatTarget(null)} returnFocus={repeatOpener} />
    <RepeatRemovalDialog removal={repeatRemoval} error={repeatRemovalError} onConfirm={confirmRepeatRemoval} onClose={() => setRepeatRemoval(null)} />
    <GraceDialog target={graceTarget} onApply={confirmGrace} onRemove={removeGraceGroup} onClose={() => setGraceTarget(null)} returnFocus={graceOpener} />
    <AnchorDialog target={anchorTarget} onApply={applyAnchor} onClose={() => setAnchorTarget(null)} returnFocus={anchorOpener} />
    <LyricDialog target={lyricTarget} onApply={applyLyric} onClose={() => setLyricTarget(null)} returnFocus={textOpener} />
    <StandaloneTextDialog target={standaloneTarget && { initialText: standaloneTarget.base.lyricsSection ?? '' }} onApply={applyStandalone}
      onClose={() => setStandaloneTarget(null)} returnFocus={textOpener} />
    <PasteDialog target={pasteTarget} clipboard={clipboard} onApply={applyPaste} onClose={() => setPasteTarget(null)} returnFocus={textOpener} />
    <CutDialog target={cutTarget} onConfirm={confirmCut} onClose={() => setCutTarget(null)} returnFocus={textOpener} />
    <NewScoreDialog open={newScoreOpen} onCreate={createNewScore} onClose={() => setNewScoreOpen(false)} returnFocus={newScoreOpener} />
    <KeyboardHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    <SettingsDialog target={settingsTarget} onApply={applySettings} onClose={() => setSettingsTarget(null)} returnFocus={textOpener} />
    <TempoDialog target={tempoTarget} onApply={applyTempo} onClose={() => setTempoTarget(null)} returnFocus={textOpener} />
    <BendDialog target={bendTarget} onApply={applyBend} onClose={() => setBendTarget(null)} returnFocus={bendOpener} />
    <PickupDialog target={pickupTarget} onApply={confirmPickupChange} onClose={() => setPickupTarget(null)} returnFocus={pickupOpener} />
    <DuplicateMeasureDialog pending={pendingDuplication} onConfirm={confirmDuplicateMeasure} onClose={() => setPendingDuplication(null)} returnFocus={duplicateOpener} />
    <ContextMenu at={editMode ? contextMenu : null} entries={contextEntries} commands={commands} label="Score actions"
      onClose={() => { setContextMenu(null); documentRefocus(); }} />
    <InsertEventDialog open={insertOpen} initialString={selection?.string ?? 1} error={error} onInsert={confirmInsertEvent}
      onClose={() => setInsertOpen(false)} returnFocus={insertOpener} />
    <RemovalDialog pending={pendingRemoval} onConfirm={confirmRemoval} onClose={() => setPendingRemoval(null)} returnFocus={removalOpener} onFocusFallback={documentRefocus} />
    <SaveCopyDialog open={copyOpen} initialTitle={copyTitle} saving={saving} onClose={() => setCopyOpen(false)} onSave={title => {
      setCopyOpen(false);
      if (!commitPendingFret()) {
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Fret"]')?.focus({ preventScroll: true }));
        return;
      }
      void save(title);
    }} />
    <LeaveDialog open={leaveOpen} error={guardError} saving={saving} onCancel={cancelLeave}
      onDiscard={() => { const action = leaveAction.current; leaveAction.current = null; setLeaveOpen(false); if (action) void action(); }}
      onSaveAndContinue={() => void saveAndContinue()} />
    <DiscardDialog open={discardOpen} onCancel={() => setDiscardOpen(false)} onDiscard={() => void confirmDiscard()} />
    <ConflictDialog open={conflictOpen} onKeep={() => setConflictOpen(false)}
      onSaveCopy={() => { setConflictOpen(false); requestAnimationFrame(openCopyDialog); }}
      onReload={() => { setConflictOpen(false); askDiscard(() => reloadSavedVersion()); }} />
    <dialog ref={dialog} className="import-dialog">
      <div className="dialog-heading"><div><div className="eyebrow">BRING YOUR OWN MUSIC</div><h2>Import a tab</h2></div><button className="icon-button" aria-label="Close import" onClick={() => dialog.current?.close()}>×</button></div>
      <p>Open a TEF or PDF to convert and play it, or preview uncompressed MusicXML. You can also paste simple five-string tablature below.</p>
      <label className="file-picker">↥ Open a file <input aria-label="Choose tablature file" type="file" accept=".txt,.json,.xml,.musicxml,.tef,.pdf" disabled={reading} onChange={e => { void readFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
      <div className="import-fields"><label>Title<input value={title} maxLength={160} onChange={e => setTitle(e.target.value)} /></label><label>Assume each note is<select value={duration} onChange={e => setDuration(Number(e.target.value) as 4 | 8 | 16)}><option value={4}>A quarter note</option><option value={8}>An eighth note</option><option value={16}>A sixteenth note</option></select></label></div>
      <label className="text-label">Tablature <span>Top to bottom: D · B · G · D · g</span><textarea aria-label="Plaintext tablature" spellCheck={false} value={text} onChange={e => setText(e.target.value)} /></label>
      <p className="import-help">4/4, open G, no capo. Only frets and barlines for now. Fifth-string fret numbers are relative to its own nut. Rhythm is assumed from your choice above; blank spacing does not encode rests.</p>
      {importError && <p className="alert" role="alert">{importError}</p>}
      {reading && <p role="status">Reading and converting your file…</p>}
      <div className="dialog-footer"><span>TEF and selectable or scanned PDF preview supported.</span><button className="primary" disabled={reading} onClick={importText}>Open in player →</button></div>
    </dialog>
  </div>;
}
