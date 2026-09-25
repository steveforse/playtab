import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { defaultPlayerPreferences, Player, type PlayerPreferences, type ScoreSelection } from './Player';
import { demo, isImportedScoreDocument, validateScore, validateStoredScore, type ImportedScoreDocument, type Score, type StoredScore } from './music/score';
import { exportAscii, parseAscii } from './music/ascii';
import { createBlankMusicXml, OPEN_G_TUNING, promoteNativeScore, readMusicXml, toImportedScoreDocument, type MusicXmlPreview } from './music/musicxml';
import { addMusicXmlEndings, cutMusicXmlMeasures, copyMusicXmlMeasures, pasteMusicXmlMeasures, connectMusicXmlTransition, inspectMusicXmlTransitions, removeMusicXmlTransition, applyMusicXmlScoreSettings, inspectMusicXmlScoreSettings, inspectMusicXmlTempo, setMusicXmlLocalTempo, TEMPO_LIMITS, TUNING_LIMITS, inspectMusicXmlLyrics, LYRIC_VERSES, setMusicXmlLyric, setMusicXmlStandaloneLyrics, STANDALONE_LYRICS_LIMIT, ANCHOR_TEXT_LIMIT, changeMusicXmlAnchor, chordSpellingName, inspectMusicXmlAnchor, inspectMusicXmlNoteTechniques, setMusicXmlBend, setMusicXmlHand, applyMusicXmlGraceGroup, inspectMusicXmlGraceGroup, removeMusicXmlGraceGroup, addMusicXmlNote, addMusicXmlRepeat, applyMusicXmlEdits, removeMusicXmlGrace, changeMusicXmlDuration, changeMusicXmlMeter, changeMusicXmlPickup, connectMusicXmlTie, createMusicXmlTriplet, insertMusicXmlEvent,
  deleteMusicXmlMeasure, duplicateMusicXmlMeasure, inspectMusicXmlDuration, inspectMusicXmlMeterRange, inspectMusicXmlRepeatEndings, inspectMusicXmlRepeats, inspectMusicXmlTie, inspectMusicXmlTriplet, insertMusicXmlMeasure, musicXmlEditorState,
  removeMusicXmlNotes, removeMusicXmlRepeat, removeMusicXmlTie, removeMusicXmlTriplet, sourceTabNoteRecords,
  type MeasureClipboard, type MeasureCut, type PasteMode, type NoteTransition, type TransitionKind, type LocalTempoInfo, type ScoreSettingsInfo, type TuningMode, type EventLyric, type LyricSyllabic, type AnchorItem, type AnchorKind, type ChordQuality, type ChordRoot, type ChordSpelling, type BendAmount, type FrettingHand, type NoteBend, type NoteTechniqueInfo, type PickingHand, type GraceEventSpec, type GraceTransition, type InsertEventOptions, type RepeatEndings, type RepeatRegion, type TiePosition } from './music/musicxml-editor';
import { documentKey, emptyHistory, record, travel, type Snapshot } from './editor/history';
import { DURATION_DENOMINATORS, type DurationDenominator } from './editor/rhythm';
import type { PlaybackEndpoints } from './editor/audition';
import { sourceEventCount, type IdentityCarry, type SourceIdentityMap } from './music/source-identity';

type LibraryItem = { id: number; title: string; revision?: number };
type RemovalMode = 'note' | 'rest' | 'grace';
type PendingRemoval = { beforeSource: string; afterSource: string; selection: ScoreSelection; mode: RemovalMode; dependencies: string[] };
type PendingDuplication = { originalKey: string; base: MusicXmlPreview; source: string; measureIndex: number;
  excluded: string[]; noteCount: number; restCount: number };
type PendingMeasureDeletion = { originalKey: string; base: MusicXmlPreview; source: string; measureIndex: number;
  noteCount: number; restCount: number; labelCount: number };
type MeterTarget = { originalKey: string; base: MusicXmlPreview; measureIndex: number };
type PickupTarget = { originalKey: string; base: MusicXmlPreview };
type RepeatTarget = { originalKey: string; base: MusicXmlPreview };
type RepeatRemoval = RepeatTarget & { region: RepeatRegion; endings: RepeatEndings | null };
type GraceTarget = { originalKey: string; base: MusicXmlPreview; selection: ScoreSelection; destination: number; first: number;
  existing: boolean; readOnly: string[]; connections: string[] };
type BendTarget = { originalKey: string; selection: ScoreSelection; existing: NoteBend | 'none' | null; reason?: string };
type AnchorTarget = { originalKey: string; base: MusicXmlPreview; selection: ScoreSelection; kind: AnchorKind; items: AnchorItem[] };
type LyricTarget = { originalKey: string; base: MusicXmlPreview; selection: ScoreSelection; lyrics: EventLyric[] };
type StandaloneTarget = { originalKey: string; base: MusicXmlPreview };
type SettingsTarget = { originalKey: string; base: MusicXmlPreview; info: ScoreSettingsInfo };
type TempoTarget = { originalKey: string; base: MusicXmlPreview; selection: ScoreSelection; info: LocalTempoInfo };
type PasteTarget = { originalKey: string; base: MusicXmlPreview; measure: number; replaceFrom: number | null; replaceCount: number };
type CutTarget = { originalKey: string; base: MusicXmlPreview; first: number; last: number; cut: MeasureCut };
type PendingTie = { originalKey: string; base: MusicXmlPreview; origin: ScoreSelection; kind: TransitionKind };
type SessionSnapshot = { document: StoredScore; original: string | null; diagnostics: string[]; id: number | null; revision: number | null };
const BEND_LABELS: Record<BendAmount, string> = { 1: '1/2 step', 2: 'Whole step', 3: '1½ steps', 4: '2 steps' };
const ANCHOR_NAMES: Record<AnchorKind, { title: string; item: string }> = {
  chord: { title: 'Chord name', item: 'chord' }, words: { title: 'Annotation', item: 'annotation' }, section: { title: 'Section label', item: 'section' } };
const CHORD_QUALITIES: [ChordQuality, string][] = [['major', 'Major'], ['minor', 'Minor'], ['dominant', '7'], ['major-seventh', 'maj7'],
  ['minor-seventh', 'm7'], ['diminished', 'dim'], ['augmented', 'aug'], ['suspended-fourth', 'sus4']];
const CHORD_STEPS: ChordRoot['step'][] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const DEFAULT_CHORD: ChordSpelling = { step: 'C', alter: 0, quality: 'major', bass: null };
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const midiName = (midi: number) => Number.isInteger(midi) ? `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}` : '—';
const TRANSITION_NAMES: Record<TransitionKind, string> = { tie: 'tie', 'hammer-on': 'hammer-on', 'pull-off': 'pull-off', slide: 'slide' };
const capitalized = (value: string) => `${value[0].toUpperCase()}${value.slice(1)}`;
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
  const notes = sourceTabNoteRecords(new DOMParser().parseFromString(preview.source, 'application/xml'));
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
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showWarnings, setShowWarnings] = useState(false);
  const [showPracticeTip, setShowPracticeTip] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [selection, setSelection] = useState<ScoreSelection | null>(null);
  const [passage, setPassage] = useState<PlaybackEndpoints | null>(null);
  const [fretDraft, setFretDraft] = useState('');
  const [moveString, setMoveString] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [pendingDuplication, setPendingDuplication] = useState<PendingDuplication | null>(null);
  const [pendingMeasureDeletion, setPendingMeasureDeletion] = useState<PendingMeasureDeletion | null>(null);
  const [meterTarget, setMeterTarget] = useState<MeterTarget | null>(null);
  const [meterApplyError, setMeterApplyError] = useState('');
  const [meterDraft, setMeterDraft] = useState<{ numerator: number; denominator: 2 | 4 | 8 | 16; scope: 'this' | 'from' }>({
    numerator: 4, denominator: 4, scope: 'this',
  });
  const meterDialog = useRef<HTMLDialogElement>(null);
  const meterOpener = useRef<HTMLElement | null>(null);
  const [repeatTarget, setRepeatTarget] = useState<RepeatTarget | null>(null);
  const [repeatDraft, setRepeatDraft] = useState({ start: 1, end: 2, count: 2 });
  const [repeatAddTouched, setRepeatAddTouched] = useState(false);
  const [repeatSelected, setRepeatSelected] = useState('');
  const [endingDraft, setEndingDraft] = useState({ firstStart: 1, secondEnd: 1 });
  const [repeatApplyError, setRepeatApplyError] = useState('');
  const [repeatRemoval, setRepeatRemoval] = useState<RepeatRemoval | null>(null);
  const repeatDialog = useRef<HTMLDialogElement>(null);
  const repeatRemovalDialog = useRef<HTMLDialogElement>(null);
  const repeatOpener = useRef<HTMLElement | null>(null);
  const [graceTarget, setGraceTarget] = useState<GraceTarget | null>(null);
  const [graceEvents, setGraceEvents] = useState<GraceEventSpec[]>([]);
  const [anchorTarget, setAnchorTarget] = useState<AnchorTarget | null>(null);
  const [anchorChoice, setAnchorChoice] = useState<number | 'new'>('new');
  const [anchorText, setAnchorText] = useState('');
  const [anchorChord, setAnchorChord] = useState<ChordSpelling>(DEFAULT_CHORD);
  const [anchorError, setAnchorError] = useState('');
  const anchorDialog = useRef<HTMLDialogElement>(null);
  const anchorOpener = useRef<HTMLElement | null>(null);
  const [lyricTarget, setLyricTarget] = useState<LyricTarget | null>(null);
  const [lyricDraft, setLyricDraft] = useState<{ verse: number; text: string; syllabic: LyricSyllabic }>({ verse: 1, text: '', syllabic: 'single' });
  const [lyricError, setLyricError] = useState('');
  const lyricDialog = useRef<HTMLDialogElement>(null);
  const [standaloneTarget, setStandaloneTarget] = useState<StandaloneTarget | null>(null);
  const [standaloneText, setStandaloneText] = useState('');
  const [standaloneError, setStandaloneError] = useState('');
  const standaloneDialog = useRef<HTMLDialogElement>(null);
  const textOpener = useRef<HTMLElement | null>(null);
  const [newScoreOpen, setNewScoreOpen] = useState(false);
  const [newScoreDraft, setNewScoreDraft] = useState({ title: 'Untitled', tempo: '96', numerator: '4', denominator: '4', measures: '8', tuningPreset: 'open-g', tuning: OPEN_G_TUNING.map(String) });
  const [newScoreError, setNewScoreError] = useState('');
  const newScoreDialog = useRef<HTMLDialogElement>(null);
  const newScoreOpener = useRef<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 800px)').matches);
  const [toolsOpen, setToolsOpen] = useState(false);
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
  const [pasteMode, setPasteMode] = useState<TuningMode>('frets');
  const [pastePlacement, setPastePlacement] = useState<PasteMode>('insert');
  const [cutTarget, setCutTarget] = useState<CutTarget | null>(null);
  const cutDialog = useRef<HTMLDialogElement>(null);
  const [pasteError, setPasteError] = useState('');
  const pasteDialog = useRef<HTMLDialogElement>(null);
  const [settingsTarget, setSettingsTarget] = useState<SettingsTarget | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<{ title: string; tempo: string; tuning: string[]; mode: TuningMode }>({ title: '', tempo: '', tuning: [], mode: 'frets' });
  const [settingsError, setSettingsError] = useState('');
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const [tempoTarget, setTempoTarget] = useState<TempoTarget | null>(null);
  const [tempoDraft, setTempoDraft] = useState('');
  const [tempoError, setTempoError] = useState('');
  const tempoDialog = useRef<HTMLDialogElement>(null);
  const [bendTarget, setBendTarget] = useState<BendTarget | null>(null);
  const [bendDraft, setBendDraft] = useState<NoteBend>({ amount: 2, shape: 'bend' });
  const bendDialog = useRef<HTMLDialogElement>(null);
  const bendOpener = useRef<HTMLElement | null>(null);
  const [graceError, setGraceError] = useState('');
  const graceDialog = useRef<HTMLDialogElement>(null);
  const graceOpener = useRef<HTMLElement | null>(null);
  const [pickupTarget, setPickupTarget] = useState<PickupTarget | null>(null);
  const [pendingTie, setPendingTie] = useState<PendingTie | null>(null);
  const [pickupApplyError, setPickupApplyError] = useState('');
  const [pickupDraft, setPickupDraft] = useState<{ numerator: number; denominator: 2 | 4 | 8 | 16 | 32 | 64 }>({
    numerator: 1, denominator: 8,
  });
  const pickupDialog = useRef<HTMLDialogElement>(null);
  const pickupOpener = useRef<HTMLElement | null>(null);
  const duplicateDialog = useRef<HTMLDialogElement>(null);
  const duplicateOpener = useRef<HTMLElement | null>(null);
  const deleteMeasureDialog = useRef<HTMLDialogElement>(null);
  const deleteMeasureOpener = useRef<HTMLElement | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertDraft, setInsertDraft] = useState<Pick<InsertEventOptions, 'placement' | 'kind' | 'denominator' | 'dotted' | 'string' | 'fret'>>({
    placement: 'after', kind: 'rest', denominator: 4, dotted: false, string: 1, fret: 0,
  });
  const insertDialog = useRef<HTMLDialogElement>(null);
  const insertOpener = useRef<HTMLElement | null>(null);
  const removalDialog = useRef<HTMLDialogElement>(null);
  const copyDialog = useRef<HTMLDialogElement>(null);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const discardDialog = useRef<HTMLDialogElement>(null);
  const conflictDialog = useRef<HTMLDialogElement>(null);
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
  useEffect(() => {
    const element = leaveDialog.current;
    if (!element) return;
    if (leaveOpen && !element.open) { element.showModal(); element.querySelector<HTMLElement>('[data-leave-cancel]')?.focus(); }
    else if (!leaveOpen && element.open) element.close();
  }, [leaveOpen]);
  useEffect(() => {
    const element = discardDialog.current;
    if (!element) return;
    if (discardOpen && !element.open) { element.showModal(); element.querySelector<HTMLElement>('[data-discard-cancel]')?.focus(); }
    else if (!discardOpen && element.open) element.close();
  }, [discardOpen]);
  useEffect(() => {
    const element = conflictDialog.current;
    if (!element) return;
    if (conflictOpen && !element.open) { element.showModal(); element.querySelector<HTMLElement>('[data-conflict-keep]')?.focus(); }
    else if (!conflictOpen && element.open) element.close();
  }, [conflictOpen]);
  useEffect(() => {
    const dialog = removalDialog.current;
    if (!dialog) return;
    if (pendingRemoval) {
      if (!dialog.open) dialog.showModal();
      dialog.querySelector<HTMLElement>('[data-removal-cancel]')?.focus();
    } else if (dialog.open) {
      dialog.close();
      if (removalOpener.current?.isConnected) removalOpener.current.focus({ preventScroll: true });
      else documentRefocus();
    }
  }, [pendingRemoval]);
  useEffect(() => {
    const dialog = insertDialog.current;
    if (!dialog) return;
    if (insertOpen && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLElement>('[data-insert-first]')?.focus(); }
    else if (!insertOpen && dialog.open) {
      dialog.close();
      if (insertOpener.current?.isConnected) insertOpener.current.focus({ preventScroll: true });
    }
  }, [insertOpen]);
  useEffect(() => {
    const dialog = duplicateDialog.current;
    if (!dialog) return;
    if (pendingDuplication && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLElement>('[data-duplicate-cancel]')?.focus(); }
    else if (!pendingDuplication && dialog.open) {
      dialog.close();
      if (duplicateOpener.current?.isConnected) duplicateOpener.current.focus({ preventScroll: true });
    }
  }, [pendingDuplication]);
  useEffect(() => {
    const dialog = deleteMeasureDialog.current;
    if (!dialog) return;
    if (pendingMeasureDeletion && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLElement>('[data-delete-measure-cancel]')?.focus(); }
    else if (!pendingMeasureDeletion && dialog.open) {
      dialog.close();
      if (deleteMeasureOpener.current?.isConnected) deleteMeasureOpener.current.focus({ preventScroll: true });
    }
  }, [pendingMeasureDeletion]);
  useEffect(() => {
    const dialog = meterDialog.current;
    if (!dialog) return;
    if (meterTarget && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLElement>('[data-meter-first]')?.focus(); }
    else if (!meterTarget && dialog.open) {
      dialog.close();
      if (meterOpener.current?.isConnected) meterOpener.current.focus({ preventScroll: true });
    }
  }, [meterTarget]);
  useEffect(() => {
    const dialog = repeatDialog.current;
    if (!dialog) return;
    if (repeatTarget && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLElement>('[data-repeat-first]')?.focus(); }
    else if (!repeatTarget && dialog.open) {
      dialog.close();
      if (repeatOpener.current?.isConnected) repeatOpener.current.focus({ preventScroll: true });
    }
  }, [repeatTarget]);
  useEffect(() => {
    const dialog = repeatRemovalDialog.current;
    if (!dialog) return;
    if (repeatRemoval && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLElement>('[data-repeat-remove-cancel]')?.focus(); }
    else if (!repeatRemoval && dialog.open) dialog.close();
  }, [repeatRemoval]);
  useEffect(() => {
    const dialog = anchorDialog.current;
    if (!dialog) return;
    if (anchorTarget && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLElement>('[data-anchor-first]')?.focus(); }
    else if (!anchorTarget && dialog.open) {
      dialog.close(); if (anchorOpener.current?.isConnected) anchorOpener.current.focus({ preventScroll: true });
    }
  }, [anchorTarget]);
  useEffect(() => {
    for (const [dialog, open] of [[lyricDialog.current, lyricTarget !== null], [standaloneDialog.current, standaloneTarget !== null],
      [settingsDialog.current, settingsTarget !== null], [tempoDialog.current, tempoTarget !== null], [pasteDialog.current, pasteTarget !== null], [cutDialog.current, cutTarget !== null]] as const) {
      if (!dialog) continue;
      if (open && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLElement>('[data-text-first]')?.focus(); }
      else if (!open && dialog.open) { dialog.close(); if (textOpener.current?.isConnected) textOpener.current.focus({ preventScroll: true }); }
    }
  }, [lyricTarget, standaloneTarget, settingsTarget, tempoTarget, pasteTarget, cutTarget]);
  useEffect(() => {
    const dialog = newScoreDialog.current;
    if (!dialog) return;
    if (newScoreOpen && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLInputElement>('[data-new-first]')?.select(); }
    else if (!newScoreOpen && dialog.open) { dialog.close(); if (newScoreOpener.current?.isConnected) newScoreOpener.current.focus({ preventScroll: true }); }
  }, [newScoreOpen]);
  useEffect(() => {
    const dialog = bendDialog.current;
    if (!dialog) return;
    if (bendTarget && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLElement>('[data-bend-first]')?.focus(); }
    else if (!bendTarget && dialog.open) {
      dialog.close(); if (bendOpener.current?.isConnected) bendOpener.current.focus({ preventScroll: true });
    }
  }, [bendTarget]);
  useEffect(() => {
    const dialog = graceDialog.current;
    if (!dialog) return;
    if (graceTarget && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLElement>('[data-grace-first]')?.focus(); }
    else if (!graceTarget && dialog.open) {
      dialog.close(); if (graceOpener.current?.isConnected) graceOpener.current.focus({ preventScroll: true });
    }
  }, [graceTarget]);
  useEffect(() => {
    const dialog = pickupDialog.current;
    if (!dialog) return;
    if (pickupTarget && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLElement>('[data-pickup-first]')?.focus(); }
    else if (!pickupTarget && dialog.open) {
      dialog.close();
      if (pickupOpener.current?.isConnected) pickupOpener.current.focus({ preventScroll: true });
    }
  }, [pickupTarget]);
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
  useEffect(() => {
    setFretDraft(selection?.fret === null || selection?.fret === undefined ? '' : String(selection.fret));
    setMoveString(selection?.string ? String(selection.string) : '');
  }, [selection?.noteId, selection?.measure, selection?.event, selection?.string, selection?.fret]);
  function remember(after: Snapshot, description: string, group?: string) {
    setHistory(current => record(current, { before: { document: currentDocument, selection, sourceIdentity: preview?.sourceIdentity }, after, description, group }));
    setDirty(documentKey(after.document) !== savedBaseline.current);
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
      setDirty(documentKey(document) !== savedBaseline.current);
      setError(''); setMessage(result.description);
      documentRefocus();
    } catch (error) { setError((error as Error).message); }
  }
  function documentRefocus() { document.querySelector<HTMLElement>('[data-testid="notation"]')?.focus({ preventScroll: true }); }
  const historyAction = useRef(moveHistory);
  historyAction.current = moveHistory;
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
    setInsertDraft({ placement: 'after', kind: 'rest', denominator: 4, dotted: false,
      string: selection.string ?? 1, fret: 0 });
    setInsertOpen(true);
  }
  function confirmInsertEvent() {
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
      const parsed = new DOMParser().parseFromString(base.source, 'application/xml');
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
      setMeterApplyError('');
      setMeterDraft({ numerator: master.timeSignatureNumerator,
        denominator: master.timeSignatureDenominator as 2 | 4 | 8 | 16, scope: 'this' });
      setMeterTarget({ originalKey: documentKey(currentDocument), base, measureIndex });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function confirmMeterChange(candidate: ReturnType<typeof changeMusicXmlMeter>) {
    if (!meterTarget || !selection) return;
    if (meterTarget.originalKey !== documentKey(currentDocument)) {
      setMeterTarget(null); setError('The score changed since this meter preview. Open it again.'); return;
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
    } catch (failure) { setMeterApplyError((failure as Error).message); }
  }
  function openRepeatDialog(opener: HTMLElement) {
    if (!selection) return;
    if (pendingFret) { setError('Apply the pending fret before editing repeats.'); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      let regions: RepeatRegion[] = [];
      try { regions = inspectMusicXmlRepeats(base.source); } catch { /* Preserve unsupported imported maps read-only in the dialog. */ }
      const selected = regions.find(item => selection.measure - 1 >= item.start && selection.measure - 1 <= item.end) ?? regions[0];
      repeatOpener.current = opener;
      setRepeatDraft({ start: selection.measure, end: Math.min(base.score.masterBars.length, selection.measure + 1), count: 2 });
      setRepeatAddTouched(false);
      setRepeatSelected(selected ? `${selected.start}:${selected.end}` : '');
      setEndingDraft({ firstStart: selected ? selected.end + 1 : selection.measure,
        secondEnd: selected ? selected.end + 2 : selection.measure + 1 });
      setRepeatApplyError(''); setRepeatTarget({ originalKey: documentKey(currentDocument), base }); setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function commitRepeatChange(target: RepeatTarget, candidate: string, description: string, status: string) {
    if (target.originalKey !== documentKey(currentDocument)) {
      setRepeatTarget(null); setRepeatRemoval(null);
      setError('The score changed since this repeat preview. Open it again.'); return;
    }
    try {
      const { base } = target;
      const nextPreview = withPreviewTitle(readMusicXml(candidate, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), base.score.title);
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection,
        sourceIdentity: nextPreview.sourceIdentity }, description);
      setPreview(nextPreview); setRepeatTarget(null); setRepeatRemoval(null); setError(''); setMessage(status);
    } catch (failure) { setRepeatApplyError((failure as Error).message); }
  }
  function confirmRepeat(candidate: string) {
    if (repeatTarget) commitRepeatChange(repeatTarget, candidate,
      `Repeat measures ${repeatDraft.start}–${repeatDraft.end} ×${repeatDraft.count}`,
      `Repeat added: measures ${repeatDraft.start}–${repeatDraft.end}, ${repeatDraft.count} plays.`);
  }
  function previewRepeatRemoval(region: RepeatRegion) {
    if (!repeatTarget) return;
    try {
      const endings = inspectMusicXmlRepeatEndings(repeatTarget.base.source, region.start, region.end);
      removeMusicXmlRepeat(repeatTarget.base.source, repeatTarget.base.score, region.start, region.end);
      setRepeatRemoval({ ...repeatTarget, region, endings }); setRepeatTarget(null); setRepeatApplyError('');
    } catch (failure) { setRepeatApplyError((failure as Error).message); }
  }
  function confirmRepeatRemoval() {
    if (!repeatRemoval) return;
    try {
      const { region, base } = repeatRemoval;
      const candidate = removeMusicXmlRepeat(base.source, base.score, region.start, region.end);
      commitRepeatChange(repeatRemoval, candidate, `Remove repeat measures ${region.start + 1}–${region.end + 1}`,
        `Repeat in measures ${region.start + 1}–${region.end + 1} removed with its dependent endings.`);
    } catch (failure) { setRepeatApplyError((failure as Error).message); }
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
      setGraceEvents(existing ? info.events : [{ denominator: 16, notes: [{ string: selection.string, fret: selection.fret, transition: 'none' }] }]);
      setGraceError('');
      setGraceTarget({ originalKey: documentKey(currentDocument), base, selection, destination: info.destination,
        first: info.destination - info.events.length, existing, readOnly: info.readOnly, connections: info.connections });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function commitGraceSource(candidate: string, description: string, message: string, event: number, string: number | null) {
    if (!graceTarget) return;
    if (graceTarget.originalKey !== documentKey(currentDocument)) {
      setGraceTarget(null); setError('The score changed since this grace preview. Open it again.'); return;
    }
    try {
      const { base, selection: opened } = graceTarget;
      const nextPreview = withPreviewTitle(readMusicXml(candidate, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), base.score.title);
      const after = selectionAtPosition(opened, score, nextPreview, { event, string });
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after, sourceIdentity: nextPreview.sourceIdentity }, description);
      setPreview(nextPreview); setSelection(after); setGraceTarget(null); setError(''); setMessage(message);
    } catch (failure) { setGraceError((failure as Error).message); }
  }
  function confirmGrace(candidate: string) {
    if (!graceTarget) return;
    const { selection: opened, first, existing } = graceTarget;
    commitGraceSource(candidate, `${existing ? 'Edit' : 'Add'} grace group in measure ${opened.measure}`,
      existing ? 'Grace group updated.' : 'Grace group added before the selected event.', first + 1, graceEvents[0].notes[0].string);
  }
  function removeGraceGroup() {
    if (!graceTarget) return;
    const { base, selection: opened, first } = graceTarget;
    try {
      const removed = removeMusicXmlGraceGroup(base.source, base.score, { measure: opened.measure - 1, beat: graceTarget.destination, voice: opened.voice - 1 });
      commitGraceSource(removed.source, `Remove grace group in measure ${opened.measure}`, 'Grace group removed.', first + 1, opened.string);
    } catch (failure) { setGraceError((failure as Error).message); }
  }
  function updateGraceEvent(eventIndex: number, change: (event: GraceEventSpec) => GraceEventSpec) {
    setGraceError('');
    setGraceEvents(current => current.map((event, index) => index === eventIndex ? change(event) : event));
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
    setBendDraft(existing && existing !== 'none' ? existing : { amount: 2, shape: 'bend' });
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
  function chooseAnchorItem(choice: number | 'new', items: AnchorItem[]) {
    setAnchorChoice(choice); setAnchorError('');
    const item = choice === 'new' ? undefined : items[choice];
    setAnchorText(item?.text ?? '');
    setAnchorChord(item?.chord ?? DEFAULT_CHORD);
  }
  function openAnchorDialog(kind: AnchorKind, opener: HTMLElement) {
    if (!selection || selection.graceIndex !== null) { setError('Select an ordinary event to anchor text to it.'); return; }
    if (pendingFret) { setError('Apply the pending fret before editing text.'); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      const info = inspectMusicXmlAnchor(base.source, base.score, anchorPosition(selection));
      const items = kind === 'chord' ? info.chords : kind === 'words' ? info.words : info.sections;
      anchorOpener.current = opener;
      chooseAnchorItem(items.length ? 0 : 'new', items);
      setAnchorTarget({ originalKey: documentKey(currentDocument), base, selection, kind, items });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function applyAnchor(remove: boolean) {
    if (!anchorTarget) return;
    const { base, selection: target, kind, items } = anchorTarget;
    if (anchorTarget.originalKey !== documentKey(currentDocument)) { setAnchorTarget(null); setError('The score changed since this text was opened. Open it again.'); return; }
    const name = ANCHOR_NAMES[kind].item;
    const value = remove ? null : kind === 'chord' ? anchorChord : anchorText;
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
    } catch (failure) { setAnchorError((failure as Error).message); }
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
  function chooseLyricVerse(verse: number, lyrics: EventLyric[]) {
    const current = lyrics.find(lyric => lyric.verse === verse);
    setLyricError('');
    setLyricDraft({ verse, text: current?.text ?? '', syllabic: current?.syllabic ?? 'single' });
  }
  function openLyricDialog(opener: HTMLElement) {
    if (!selection || selection.graceIndex !== null) { setError('Select an ordinary event to edit its lyric.'); return; }
    if (pendingFret) { setError('Apply the pending fret before editing text.'); return; }
    try {
      const base = textBase();
      const lyrics = inspectMusicXmlLyrics(base.source, base.score, anchorPosition(selection));
      textOpener.current = opener;
      chooseLyricVerse(lyrics.find(lyric => lyric.verse > 0)?.verse ?? 1, lyrics);
      setLyricTarget({ originalKey: documentKey(currentDocument), base, selection, lyrics });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function applyLyric(remove: boolean) {
    if (!lyricTarget) return;
    const { base, selection: target } = lyricTarget;
    if (lyricTarget.originalKey !== documentKey(currentDocument)) { setLyricTarget(null); setError('The score changed since this lyric was opened. Open it again.'); return; }
    try {
      const nextSource = setMusicXmlLyric(base.source, base.score, anchorPosition(target), lyricDraft.verse,
        remove ? null : { text: lyricDraft.text, syllabic: lyricDraft.syllabic });
      const where = `measure ${target.measure}, event ${target.event}`;
      commitText(base, target, nextSource, `${remove ? 'Remove' : 'Set'} verse ${lyricDraft.verse} lyric at ${where}`,
        remove ? `Verse ${lyricDraft.verse} lyric removed from ${where}.` : `Verse ${lyricDraft.verse} lyric “${lyricDraft.text.trim()}” applied at ${where}.`);
      setLyricTarget(null);
    } catch (failure) { setLyricError((failure as Error).message); }
  }
  function openStandaloneDialog(opener: HTMLElement) {
    if (pendingFret) { setError('Apply the pending fret before editing text.'); return; }
    try {
      const base = textBase();
      textOpener.current = opener;
      setStandaloneText(base.lyricsSection ?? ''); setStandaloneError('');
      setStandaloneTarget({ originalKey: documentKey(currentDocument), base });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function applyStandalone() {
    if (!standaloneTarget) return;
    const { base } = standaloneTarget;
    if (standaloneTarget.originalKey !== documentKey(currentDocument)) { setStandaloneTarget(null); setError('The score changed since this text was opened. Open it again.'); return; }
    try {
      const nextSource = setMusicXmlStandaloneLyrics(base.source, standaloneText);
      if (nextSource === base.source && preview) { setStandaloneTarget(null); return; }
      const removed = !standaloneText.trim();
      commitText(base, null, nextSource, removed ? 'Remove Lyrics & chords text' : 'Edit Lyrics & chords text',
        removed ? 'Lyrics & chords text removed.' : 'Lyrics & chords text updated.');
      setStandaloneTarget(null);
    } catch (failure) { setStandaloneError((failure as Error).message); }
  }
  function openSettingsDialog(opener: HTMLElement) {
    if (pendingFret) { setError('Apply the pending fret before changing score settings.'); return; }
    try {
      const base = textBase();
      const info = inspectMusicXmlScoreSettings(base.source, base.score);
      textOpener.current = opener;
      setSettingsDraft({ title: base.score.title, tempo: String(info.tempo), tuning: info.tuning.map(String), mode: 'frets' });
      setSettingsError('');
      setSettingsTarget({ originalKey: documentKey(currentDocument), base, info });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function applySettings(candidate: { source: string; tuningRange: { first: number; last: number } }) {
    if (!settingsTarget) return;
    const { base, info } = settingsTarget;
    if (settingsTarget.originalKey !== documentKey(currentDocument)) { setSettingsTarget(null); setError('The score changed since settings were opened. Open them again.'); return; }
    try {
      const title = settingsDraft.title.trim();
      const tuningChanged = settingsDraft.tuning.some((value, index) => Number(value) !== info.tuning[index]);
      const nextPreview = withPreviewTitle(readMusicXml(candidate.source, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), title);
      const after = selection ? selectionAtPosition(selection, score, nextPreview, {}) : null;
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after, sourceIdentity: nextPreview.sourceIdentity }, 'Change score settings');
      setPreview(nextPreview); setSelection(after); setSettingsTarget(null); setError('');
      setMessage(tuningChanged ? `Score settings applied. Tuning changed for measures ${candidate.tuningRange.first}–${candidate.tuningRange.last}.` : 'Score settings applied.');
    } catch (failure) { setSettingsError((failure as Error).message); }
  }
  function openTempoDialog(opener: HTMLElement) {
    if (!selection || selection.graceIndex !== null) { setError('Select an ordinary event to set its tempo.'); return; }
    if (pendingFret) { setError('Apply the pending fret before changing the tempo.'); return; }
    try {
      const base = textBase();
      const info = inspectMusicXmlTempo(base.source, base.score, anchorPosition(selection));
      textOpener.current = opener;
      setTempoDraft(String(info.local ?? info.inherited)); setTempoError('');
      setTempoTarget({ originalKey: documentKey(currentDocument), base, selection, info });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function applyTempo(remove: boolean) {
    if (!tempoTarget) return;
    const { base, selection: target } = tempoTarget;
    if (tempoTarget.originalKey !== documentKey(currentDocument)) { setTempoTarget(null); setError('The score changed since this tempo was opened. Open it again.'); return; }
    try {
      const tempo = remove ? null : Number(tempoDraft);
      const nextSource = setMusicXmlLocalTempo(base.source, base.score, anchorPosition(target), tempo);
      const where = `measure ${target.measure}, event ${target.event}`;
      commitText(base, target, nextSource, remove ? `Remove local tempo at ${where}` : `Set tempo ${tempo} BPM at ${where}`,
        remove ? `Local tempo removed at ${where}; ${tempoTarget.info.inherited} BPM continues.` : `Tempo ${tempo} BPM set at ${where}.`);
      setTempoTarget(null);
    } catch (failure) { setTempoError((failure as Error).message); }
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
  function confirmCut() {
    if (!cutTarget) return;
    const { base, first, last, cut } = cutTarget;
    setCutTarget(null);
    if (cutTarget.originalKey !== documentKey(currentDocument)) { setError('The score changed since Cut was opened. Select the measures again.'); return; }
    try {
      const nextPreview = withPreviewTitle(readMusicXml(cut.source, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), base.score.title);
      const after = selection ? selectionAtPosition(selection, score, nextPreview, {}) : null;
      const range = first === last ? `measure ${first}` : `measures ${first}–${last}`;
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after, sourceIdentity: nextPreview.sourceIdentity }, `Cut ${range}`);
      setClipboard({ ...cut.clipboard, title: base.score.title });
      setPreview(nextPreview); setSelection(after); setPassage(null); setError('');
      setMessage(`Cut ${range} to the clipboard; the measures now hold rests.`);
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
      setPasteMode('frets'); setPasteError(''); setPastePlacement('insert');
      setPasteTarget({ originalKey: documentKey(currentDocument), base: textBase(), measure: selection.measure,
        replaceFrom: range?.first ?? null, replaceCount: range ? range.last - range.first + 1 : 0 });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function applyPaste(candidate: string) {
    if (!pasteTarget || !clipboard) return;
    const { base } = pasteTarget;
    const replacing = pastePlacement === 'replace' && pasteTarget.replaceFrom !== null;
    const measure = replacing ? pasteTarget.replaceFrom! : pasteTarget.measure;
    if (pasteTarget.originalKey !== documentKey(currentDocument)) { setPasteTarget(null); setError('The score changed since paste was opened. Open it again.'); return; }
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
    } catch (failure) { setPasteError((failure as Error).message); }
  }
  function openNewScoreDialog(opener: HTMLElement) {
    newScoreOpener.current = opener;
    setNewScoreDraft({ title: 'Untitled', tempo: '96', numerator: '4', denominator: '4', measures: '8', tuningPreset: 'open-g', tuning: OPEN_G_TUNING.map(String) });
    setNewScoreError(''); setNewScoreOpen(true);
  }
  function createNewScore() {
    let source: string;
    const title = newScoreDraft.title.trim();
    try {
      source = createBlankMusicXml({ title, tempo: Number(newScoreDraft.tempo), numerator: Number(newScoreDraft.numerator),
        denominator: Number(newScoreDraft.denominator), measures: Number(newScoreDraft.measures),
        tuning: newScoreDraft.tuningPreset === 'open-g' ? OPEN_G_TUNING : newScoreDraft.tuning.map(Number) });
    } catch (failure) { setNewScoreError((failure as Error).message); return; }
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
  }
  function openPickupDialog(opener: HTMLElement) {
    if (!selection || selection.measure !== 1) return;
    if (pendingFret) { setError('Apply the pending fret before changing the pickup.'); return; }
    try {
      const base = preview ?? withPreviewTitle(readMusicXml(promoteNativeScore(score), `${score.title.slice(0, 148)}.musicxml`), score.title);
      pickupOpener.current = opener;
      setPickupApplyError('');
      setPickupDraft({ numerator: 1, denominator: 8 });
      setPickupTarget({ originalKey: documentKey(currentDocument), base });
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  function confirmPickupChange(nextSource: string) {
    if (!pickupTarget) return;
    if (pickupTarget.originalKey !== documentKey(currentDocument)) {
      setPickupTarget(null); setError('The score changed since this pickup preview. Open it again.'); return;
    }
    try {
      const { base } = pickupTarget;
      const nextPreview = withPreviewTitle(readMusicXml(nextSource, base.filename, base.sourceFormat,
        base.sourceIdentity ? { source: base.source, map: base.sourceIdentity } : undefined), base.score.title);
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: null,
        sourceIdentity: nextPreview.sourceIdentity }, 'Change pickup length');
      setPreview(nextPreview); setSelection(null); setPickupTarget(null); setPassage(null);
      setMessage('Pickup length changed. Edit and playback selections cleared.'); setError('');
    } catch (failure) { setPickupApplyError((failure as Error).message); }
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
    const after = { ...selection, string: destination };
    if (!updateSelectedScore(selection, notes => {
      const existing = notes.find(note => note.string === selection.string);
      if (!existing) return;
      existing.string = destination;
      notes.sort((left, right) => left.string - right.string);
    }, note => { note.string = destination; }, after, `Move note to string ${destination}`, undefined, destination)) return;
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
      flushSync(() => setFretDraft(String(pending.selection.fret)));
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
    copyDialog.current?.showModal();
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
  const meterPreview = (() => {
    if (!meterTarget) return null;
    try {
      const range = inspectMusicXmlMeterRange(meterTarget.base.source, meterTarget.base.score,
        meterTarget.measureIndex, meterDraft.scope);
      try {
        return { range, candidate: changeMusicXmlMeter(meterTarget.base.source, meterTarget.base.score,
          meterTarget.measureIndex, meterDraft.numerator, meterDraft.denominator, meterDraft.scope), error: '' };
      } catch (failure) { return { range, candidate: null, error: (failure as Error).message }; }
    } catch (failure) { return { range: null, candidate: null, error: (failure as Error).message }; }
  })();
  const pickupPreview = (() => {
    if (!pickupTarget) return null;
    try {
      return { source: changeMusicXmlPickup(pickupTarget.base.source, pickupTarget.base.score,
        pickupDraft.numerator, pickupDraft.denominator), error: '' };
    } catch (failure) { return { source: null, error: (failure as Error).message }; }
  })();
  const repeatPreview = (() => {
    if (!repeatTarget) return null;
    try {
      const existing = inspectMusicXmlRepeats(repeatTarget.base.source);
      try {
        return { existing, candidate: addMusicXmlRepeat(repeatTarget.base.source, repeatTarget.base.score,
          repeatDraft.start - 1, repeatDraft.end - 1, repeatDraft.count), error: '', structureError: false };
      } catch (failure) { return { existing, candidate: null, error: (failure as Error).message, structureError: false }; }
    } catch (failure) { return { existing: [], candidate: null, error: (failure as Error).message, structureError: true }; }
  })();
  const selectedRepeat = repeatPreview?.existing.find(region => `${region.start}:${region.end}` === repeatSelected);
  const endingsPreview = (() => {
    if (!repeatTarget || !selectedRepeat) return null;
    try {
      const existing = inspectMusicXmlRepeatEndings(repeatTarget.base.source, selectedRepeat.start, selectedRepeat.end);
      if (existing) return { existing, candidate: null, error: 'This repeat already has first and second endings.' };
      try {
        return { existing: null, candidate: addMusicXmlEndings(repeatTarget.base.source, repeatTarget.base.score,
          selectedRepeat.start, selectedRepeat.end, endingDraft.firstStart - 1, endingDraft.secondEnd - 1), error: '' };
      } catch (failure) { return { existing: null, candidate: null, error: (failure as Error).message }; }
    } catch (failure) { return { existing: null, candidate: null, error: (failure as Error).message }; }
  })();
  const gracePreview = (() => {
    if (!graceTarget || graceTarget.readOnly.length) return null;
    try {
      return { candidate: applyMusicXmlGraceGroup(graceTarget.base.source, graceTarget.base.score,
        { measure: graceTarget.selection.measure - 1, beat: graceTarget.destination, voice: graceTarget.selection.voice - 1 },
        graceEvents), error: '' };
    } catch (failure) { return { candidate: null, error: (failure as Error).message }; }
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
  const selectedBeats = selection ? preview?.score.tracks?.[0]?.staves?.[0]?.bars?.[selection.measure - 1]?.voices?.[selection.voice - 1]?.beats : undefined;
  const selectedHasGrace = Boolean(selection && (selection.graceIndex !== null || selectedBeats?.[selection.event - 2]?.graceType));
  const editorTools = <section className="editor-sidebar" aria-label="Edit tools">
        <div className="sidebar-section">EDIT SCORE</div>
        <div className="editor-history">
          <button type="button" disabled={!history.undo.length} title={history.undo.length ? `Undo: ${history.undo.at(-1)!.description}` : 'Nothing to undo'} onClick={() => moveHistory('undo')}>Undo</button>
          <button type="button" disabled={!history.redo.length} title={history.redo.length ? `Redo: ${history.redo.at(-1)!.description}` : 'Nothing to redo'} onClick={() => moveHistory('redo')}>Redo</button>
        </div>
        <p className="editor-selection-empty">Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z redoes. History lasts while this score is open; older actions expire after 100 edits or 32 MB.</p>
        <p className="editor-sidebar-status"><strong>Edit mode</strong><span>{selection ? 'Selection is ready for an edit.' : 'Select a note or empty string position to begin editing.'}</span></p>
        <div className="editor-selection" aria-label="Selection inspector">
          {!selection ? <p className="editor-selection-empty">No note, rest, or staff position selected.</p> : <>
            <div className="editor-selection-summary" aria-live="polite">
              <span>Measure {selection.measure}</span>
              <span>Event {selection.event}</span>
              <span>String {selection.string ?? '—'}</span>
              {selection.fret !== null && <span>Fret {selection.fret}</span>}
            </div>
            <div className="editor-selection-fields">
              <label>Measure<select aria-label="Selection measure" value={selection.measure} onChange={event => navigateInspector({ measure: Number(event.target.value) })}>{Array.from({ length: Math.max(1, preview?.score.masterBars.length ?? score.measures.length) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
              <label>Event<select aria-label="Selection event" value={selection.event} onChange={event => navigateInspector({ event: Number(event.target.value) })}>{Array.from({ length: Math.max(1, selectedEventCount) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
              <label>Voice<select aria-label="Selection voice" value={selection.voice} onChange={event => navigateInspector({ voice: Number(event.target.value) })}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>String<select aria-label="Selection string" value={selection.string ?? ''} onChange={event => navigateInspector({ string: event.target.value ? Number(event.target.value) : null })}><option value="">—</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            </div>
            {selection.mappingReason && <p className="editor-selection-reason">{selection.mappingReason}</p>}
            {selection.string !== null && <div className="editor-note-tools">
              <label>{selection.kind === 'note' ? 'Fret' : 'Add fret'}<input aria-label="Fret" inputMode="numeric" min={0} max={36} value={fretDraft} onChange={event => setFretDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); updateSelectionFret(selection, Number(fretDraft)); } }} /></label>
              <button type="button" onClick={() => updateSelectionFret(selection, Number(fretDraft))}>{selection.kind === 'note' ? 'Apply' : 'Add note'}</button>
              {selection.kind === 'note' && <>
                <label>Move to string<select aria-label="Move to string" value={moveString} onChange={event => setMoveString(event.target.value)}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value} disabled={value === selection.string}>{value}</option>)}</select></label>
                <button type="button" onClick={moveSelectedString} disabled={!moveString || Number(moveString) === selection.string}>Move</button>
                <button type="button" className="editor-remove-note" onClick={() => requestRemoval(selection)}>Remove note</button>
              </>}
            </div>}
            {selection.kind === 'note' && selection.graceIndex === null && <div className="editor-event-tools"><button type="button" onClick={() => requestRemoval(selection, 'rest')}>Make rest</button></div>}
            {selectedRhythm && <div className="editor-rhythm-tools" aria-label="Duration tools">
              <p>Duration</p>
              <div className="editor-duration-buttons">{DURATION_DENOMINATORS.map(value => <button key={value} type="button"
                aria-label={value === 1 ? 'Whole note duration' : `1/${value} duration`}
                aria-pressed={selectedRhythm.denominator === value && selectedRhythm.dots === 0}
                disabled={selectedTupletLocked}
                onClick={() => changeSelectedDuration(value, false)}>{value === 1 ? '1' : `1/${value}`}</button>)}</div>
              <button type="button" className="editor-dotted-button" aria-pressed={selectedRhythm.dots === 1}
                disabled={selectedRhythm.denominator === null || selectedTupletLocked}
                onClick={() => changeSelectedDuration(selectedRhythm.denominator!, selectedRhythm.dots !== 1)}>Dotted</button>
              <button type="button" className="editor-split-rest" disabled={!selectedRhythm.rest || selectedRhythm.denominator === null || selectedRhythm.denominator === 64 || selectedRhythm.dots !== 0 || selectedTupletLocked}
                onClick={() => changeSelectedDuration((selectedRhythm.denominator! * 2) as DurationDenominator, false)}>Split rest</button>
              <button type="button" className="editor-insert-event" onClick={event => openInsertEvent(event.currentTarget)}>Insert event…</button>
              <button type="button" className="editor-insert-event" disabled={selection.graceIndex !== null} onClick={event => openTempoDialog(event.currentTarget)}>Set tempo here…</button>
              <button type="button" className="editor-triplet-button" disabled={selectedTupletLocked || selectedRhythm.denominator === null
                || selectedRhythm.denominator === 64 || selectedRhythm.dots !== 0}
                onClick={() => changeSelectedTriplet(false)}>Triplet</button>
              {selectedTriplet?.triplet && <button type="button" className="editor-remove-triplet" disabled={!selectedTriplet.canRemove}
                onClick={() => changeSelectedTriplet(true)}>Remove triplet</button>}
              {selectedRhythm.reason && <p className="editor-rhythm-reason">{selectedRhythm.reason}</p>}
              {selectedTriplet?.reason && selectedTriplet.reason !== selectedRhythm.reason && <p className="editor-rhythm-reason">{selectedTriplet.reason}</p>}
            </div>}
            <details className="editor-technique-tools"><summary>Techniques</summary>
              <button type="button" disabled={selection.kind !== 'note'}
                onClick={event => openGraceDialog(event.currentTarget)}>{selectedHasGrace ? 'Edit grace…' : 'Add grace…'}</button>
              {selection.kind === 'note' && selection.graceIndex !== null && <button type="button" onClick={() => requestRemoval(selection, 'grace')}>Remove grace</button>}
              {selectedTechniques && <div className="editor-hand-tools">
                <label>Picking hand<select aria-label="Picking hand" value={selectedTechniques.picking ?? ''} disabled={selectedTechniques.picking === null}
                  onChange={event => changeHand('picking', event.target.value as PickingHand)}>
                  {selectedTechniques.picking === null && <option value="">Kept as written</option>}
                  <option value="none">None</option><option value="T">T</option><option value="I">I</option><option value="M">M</option></select></label>
                {selectedTechniques.pickingReason && <p className="editor-rhythm-reason">{selectedTechniques.pickingReason}</p>}
                <label>Fretting hand<select aria-label="Fretting hand" value={selectedTechniques.fretting ?? ''} disabled={selectedTechniques.fretting === null}
                  onChange={event => changeHand('fretting', event.target.value as FrettingHand)}>
                  {selectedTechniques.fretting === null && <option value="">Kept as written</option>}
                  <option value="none">None</option>{['1', '2', '3', '4'].map(value => <option key={value} value={value}>{value}</option>)}<option value="T">Thumb</option></select></label>
                {selectedTechniques.frettingReason && <p className="editor-rhythm-reason">{selectedTechniques.frettingReason}</p>}
                <button type="button" onClick={event => openBendDialog(event.currentTarget)}>Bend…</button>
              </div>}
              <div className="editor-transition-buttons">{(['hammer-on', 'pull-off', 'slide', 'tie'] as TransitionKind[]).map(kind =>
                <button key={kind} type="button" disabled={selection.kind !== 'note' || pendingTie !== null} onClick={() => beginTransition(kind)}>{capitalized(TRANSITION_NAMES[kind])}</button>)}</div>
              {selectedTie && <button type="button" onClick={removeSelectedTie}>Remove tie</button>}
              {selectedTransitions.map(item => <button key={`${item.kind}:${item.direction}`} type="button" onClick={() => removeTransition(item)}>
                Remove {TRANSITION_NAMES[item.kind]} {item.direction === 'outgoing' ? 'to' : 'from'} {item.other ? `m${item.other.measure} e${item.other.event}` : 'its other note'}</button>)}
              {pendingTie && <div className="editor-tie-pending" role="status">
                <p>{pendingTie.kind === 'tie' ? 'Origin' : `${capitalized(TRANSITION_NAMES[pendingTie.kind])} origin`}: measure {pendingTie.origin.measure}, event {pendingTie.origin.event}, string {pendingTie.origin.string}, fret {pendingTie.origin.fret}. Select the destination note.</p>
                <button type="button" disabled={selection.kind !== 'note'} onClick={() => completeTransition(selection)}>Use selected note</button>
                <button type="button" onClick={() => { const name = TRANSITION_NAMES[pendingTie.kind]; setPendingTie(null); setError(''); setMessage(`${capitalized(name)} cancelled.`); }}>Cancel {TRANSITION_NAMES[pendingTie.kind]}</button>
              </div>}
            </details>
            <details className="editor-text-tools"><summary>Text</summary>
              {(['chord', 'section', 'words'] as AnchorKind[]).map(kind => <button key={kind} type="button" disabled={selection.graceIndex !== null}
                onClick={event => openAnchorDialog(kind, event.currentTarget)}>{ANCHOR_NAMES[kind].title}…</button>)}
              <button type="button" disabled={selection.graceIndex !== null} onClick={event => openLyricDialog(event.currentTarget)}>Lyric syllable…</button>
              <button type="button" onClick={event => openStandaloneDialog(event.currentTarget)}>Lyrics &amp; chords…</button>
            </details>
            <details className="editor-passage-tools"><summary>Select passage</summary>
              <button type="button" onClick={() => setPassage({ start: selection, end: selection })}>Set range start</button>
              <button type="button" disabled={!passage} onClick={() => {
                if (!passage) return;
                const first = passage.start.measure < selection.measure || passage.start.measure === selection.measure && passage.start.event <= selection.event;
                setPassage(first ? { start: passage.start, end: selection } : { start: selection, end: passage.start });
              }}>Set range end</button>
              <button type="button" disabled={!passage} onClick={() => setPassage(null)}>Clear passage</button>
              <button type="button" disabled={!passage} onClick={copyPassage}>Copy passage</button>
              <button type="button" disabled={!passage} onClick={event => openCutDialog(event.currentTarget)}>Cut passage…</button>
              <button type="button" disabled={!clipboard} onClick={event => openPasteDialog(event.currentTarget)}>Paste passage…</button>
              {clipboard && <p className="editor-rhythm-reason">Clipboard: {clipboard.measures.length} measure{clipboard.measures.length === 1 ? '' : 's'} from “{clipboard.title}”.</p>}
            </details>
            <details className="editor-measure-tools"><summary>Measure</summary>
              <button type="button" onClick={selectWholeMeasure}>Select measure</button>
              <button type="button" onClick={() => insertSelectedMeasure('before')}>Insert measure before</button>
              <button type="button" onClick={() => insertSelectedMeasure('after')}>Insert measure after</button>
              <button type="button" onClick={event => previewDuplicateMeasure(event.currentTarget)}>Duplicate measure…</button>
              <button type="button" disabled={(preview?.score.masterBars.length ?? score.measures.length) <= 1}
                onClick={event => previewDeleteMeasure(event.currentTarget)}>Delete measure…</button>
              {(preview?.score.masterBars.length ?? score.measures.length) <= 1 && <p>The last remaining measure cannot be deleted.</p>}
              <button type="button" onClick={event => openMeterDialog(event.currentTarget)}>Time signature…</button>
              <button type="button" onClick={event => openRepeatDialog(event.currentTarget)}>Repeat / endings…</button>
              <button type="button" disabled={selection.measure !== 1} onClick={event => openPickupDialog(event.currentTarget)}>Pickup…</button>
              {selection.measure !== 1 && <p>Pickup length is available only in the first measure.</p>}
            </details>
          </>}
        </div>
        <details className="editor-score-tools"><summary>Score</summary>
          <button type="button" onClick={event => openSettingsDialog(event.currentTarget)}>Score settings…</button>
        </details>
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
        {message && <p className="success" role="status">{message}</p>}
        {warnings.length > 0 && showWarnings && <aside className="import-notice" role="note" aria-label="Import warnings"><div className="notice-heading"><strong>Check your import</strong><button type="button" className="notice-dismiss" aria-label="Dismiss import warnings" onClick={() => setShowWarnings(false)}>×</button></div>{warnings.map(warning => <p key={warning}>{warning}</p>)}</aside>}
        {showPracticeTip && <aside className="practice-note" role="note" aria-label="Practice tip"><span className="note-icon">✦</span><p><strong>Make it your pace.</strong> Slow down a tricky passage, loop it, and find your rhythm.</p><span className="practice-badge">PRACTICE MODE</span><button type="button" className="tip-dismiss" aria-label="Dismiss practice tip" onClick={() => setShowPracticeTip(false)}>×</button></aside>}
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
            setSelection(addressed);
            if (pendingTie && addressed) completeTransition(addressed);
          }}
          onPassageChange={setPassage}
          onFretInput={updateSelectionFret}
          onSelectionDelete={requestRemoval}
          exportBlockedReason={pendingFret ? 'Apply or clear the pending fret before exporting.' : null}
          historyRevision={historyRevision}
          compactTransportHost={editMode && narrow && toolsOpen ? sheetTransportHost : null}
          sessionKey={session.current}
        />
        <div className="workspace-footer"><span>Made for five strings and a little patience.</span><span>Sound powered by alphaTab · MuseScore General Lite</span></div>
      </div>
    </main>
    {editMode && narrow && toolsOpen && <section id="edit-tools-sheet" className="edit-sheet" aria-label="Edit tools sheet">
      <div className="edit-sheet-header"><strong>Edit tools</strong>
        <button type="button" onClick={() => { setToolsOpen(false); document.querySelector<HTMLElement>('.edit-tools-toggle')?.focus(); }}>Close tools</button></div>
      <div ref={setSheetTransportHost} className="edit-sheet-transport" />
      <div className="edit-sheet-body">{editorTools}</div>
    </section>}
    <dialog ref={deleteMeasureDialog} className="duplicate-dialog" aria-label="Delete measure" onCancel={event => { event.preventDefault(); setPendingMeasureDeletion(null); }}>
      <h2>Delete measure {pendingMeasureDeletion ? pendingMeasureDeletion.measureIndex + 1 : ''}?</h2>
      <p>This permanently removes {pendingMeasureDeletion?.noteCount ?? 0} note{pendingMeasureDeletion?.noteCount === 1 ? '' : 's'}, {pendingMeasureDeletion?.restCount ?? 0} rest{pendingMeasureDeletion?.restCount === 1 ? '' : 's'}, and {pendingMeasureDeletion?.labelCount ?? 0} local label{pendingMeasureDeletion?.labelCount === 1 ? '' : 's'} from this score. Undo can restore them during this editing session.</p>
      <p>Edit and playback selections touching this measure will clear.</p>
      <div className="duplicate-dialog-actions"><button type="button" data-delete-measure-cancel onClick={() => setPendingMeasureDeletion(null)}>Cancel</button><button type="button" onClick={confirmDeleteMeasure}>Delete measure</button></div>
    </dialog>
    <dialog ref={meterDialog} className="duplicate-dialog" aria-label="Time signature" onCancel={event => { event.preventDefault(); setMeterTarget(null); }}>
      <h2>Time signature</h2>
      <div className="insert-dialog-fields">
        <label>Numerator<input data-meter-first type="number" min={1} max={12} step={1} value={meterDraft.numerator}
          onChange={event => { setMeterApplyError(''); setMeterDraft(current => ({ ...current, numerator: Number(event.target.value) })); }} /></label>
        <label>Denominator<select value={meterDraft.denominator}
          onChange={event => { setMeterApplyError(''); setMeterDraft(current => ({ ...current, denominator: Number(event.target.value) as 2 | 4 | 8 | 16 })); }}>
          {[2, 4, 8, 16].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Apply to<select value={meterDraft.scope}
          onChange={event => { setMeterApplyError(''); setMeterDraft(current => ({ ...current, scope: event.target.value as 'this' | 'from' })); }}>
          <option value="this">This measure</option><option value="from">From here (until next explicit signature)</option></select></label>
      </div>
      {meterPreview?.range && <p>Affects measures {meterPreview.range.firstMeasure}–{meterPreview.range.lastMeasure} ({meterPreview.range.lastMeasure - meterPreview.range.firstMeasure + 1} total).</p>}
      {meterPreview?.error && <p className="alert" role="alert">{meterPreview.error}</p>}
      {meterApplyError && <p className="alert" role="alert">{meterApplyError}</p>}
      <div className="duplicate-dialog-actions"><button type="button" onClick={() => setMeterTarget(null)}>Cancel</button>
        <button type="button" disabled={!meterPreview?.candidate} onClick={() => { if (meterPreview?.candidate) confirmMeterChange(meterPreview.candidate); }}>Apply</button></div>
    </dialog>
    <dialog ref={repeatDialog} className="duplicate-dialog" aria-label="Repeat / endings" onCancel={event => { event.preventDefault(); setRepeatTarget(null); }}>
      <h2>Repeat / endings</h2>
      <p>Existing repeats: {repeatPreview?.structureError ? 'unavailable (imported structure is read-only)' : repeatPreview?.existing.length ? repeatPreview.existing.map(region =>
        `measures ${region.start + 1}–${region.end + 1} ×${region.count}`).join('; ') : 'none'}.</p>
      <p>Add a non-overlapping repeat. Endings require a two-play repeat and one measure after its backward marker.</p>
      <div className="insert-dialog-fields">
        <label>Start measure<input data-repeat-first type="number" min={1} max={repeatTarget?.base.score.masterBars.length ?? 1} step={1}
          value={repeatDraft.start} onChange={event => { setRepeatAddTouched(true); setRepeatApplyError(''); setRepeatDraft(current => ({ ...current, start: Number(event.target.value) })); }} /></label>
        <label>End measure<input type="number" min={1} max={repeatTarget?.base.score.masterBars.length ?? 1} step={1}
          value={repeatDraft.end} onChange={event => { setRepeatAddTouched(true); setRepeatApplyError(''); setRepeatDraft(current => ({ ...current, end: Number(event.target.value) })); }} /></label>
        <label>Play count<select value={repeatDraft.count}
          onChange={event => { setRepeatAddTouched(true); setRepeatApplyError(''); setRepeatDraft(current => ({ ...current, count: Number(event.target.value) })); }}>
          {[2, 3, 4, 5, 6, 7, 8].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      {repeatPreview?.error && (repeatAddTouched || !repeatPreview.existing.length) && <p className="alert" role="alert">{repeatPreview.error}</p>}
      {repeatApplyError && <p className="alert" role="alert">{repeatApplyError}</p>}
      <div className="duplicate-dialog-actions"><button type="button" onClick={() => setRepeatTarget(null)}>Cancel</button>
        <button type="button" disabled={!repeatPreview?.candidate} onClick={() => { if (repeatPreview?.candidate) confirmRepeat(repeatPreview.candidate); }}>Add repeat</button></div>
      {!!repeatPreview?.existing.length && <>
        <h3>Selected repeat</h3>
        <div className="insert-dialog-fields"><label>Repeat region<select value={repeatSelected} onChange={event => {
          const region = repeatPreview.existing.find(item => `${item.start}:${item.end}` === event.target.value);
          setRepeatSelected(event.target.value);
          if (region) setEndingDraft({ firstStart: region.end + 1, secondEnd: region.end + 2 });
          setRepeatApplyError('');
        }}>
          {repeatPreview.existing.map(region => <option key={`${region.start}:${region.end}`} value={`${region.start}:${region.end}`}>
            Measures {region.start + 1}–{region.end + 1} · {region.count} plays
          </option>)}</select></label></div>
        {selectedRepeat && <>
          {endingsPreview?.existing && <p>First ending: measures {endingsPreview.existing.firstStart + 1}–{endingsPreview.existing.firstEnd + 1}; second ending: measures {endingsPreview.existing.secondStart + 1}–{endingsPreview.existing.secondEnd + 1}.</p>}
          {!endingsPreview?.existing && <>
            <div className="insert-dialog-fields">
              <label>First ending start<input type="number" min={selectedRepeat.start + 1} max={selectedRepeat.end + 1} step={1}
                value={endingDraft.firstStart} onChange={event => { setRepeatApplyError(''); setEndingDraft(current => ({ ...current, firstStart: Number(event.target.value) })); }} /></label>
              <p>First ending end: measure {selectedRepeat.end + 1} (fixed). Second ending start: measure {selectedRepeat.end + 2} (fixed).</p>
              <label>Second ending end<input type="number" min={selectedRepeat.end + 2} max={repeatTarget?.base.score.masterBars.length ?? 1} step={1}
                value={endingDraft.secondEnd} onChange={event => { setRepeatApplyError(''); setEndingDraft(current => ({ ...current, secondEnd: Number(event.target.value) })); }} /></label>
            </div>
            {endingsPreview?.error && <p className="alert" role="alert">{endingsPreview.error}</p>}
            <button type="button" disabled={!endingsPreview?.candidate} onClick={() => {
              if (repeatTarget && selectedRepeat && endingsPreview?.candidate) commitRepeatChange(repeatTarget, endingsPreview.candidate,
                `Add endings to measures ${selectedRepeat.start + 1}–${selectedRepeat.end + 1}`,
                `First and second endings added to measures ${selectedRepeat.start + 1}–${selectedRepeat.end + 1}.`);
            }}>Add first/second endings</button>
          </>}
          <button type="button" onClick={() => previewRepeatRemoval(selectedRepeat)}>Clear selected repeat/ending…</button>
        </>}
      </>}
    </dialog>
    <dialog ref={repeatRemovalDialog} className="duplicate-dialog" aria-label="Clear repeat and endings" onCancel={event => { event.preventDefault(); setRepeatRemoval(null); }}>
      <h2>Clear repeat in measures {repeatRemoval ? `${repeatRemoval.region.start + 1}–${repeatRemoval.region.end + 1}` : ''}?</h2>
      {repeatRemoval?.endings ? <p>This also removes dependent first ending in measures {repeatRemoval.endings.firstStart + 1}–{repeatRemoval.endings.firstEnd + 1} and second ending in measures {repeatRemoval.endings.secondStart + 1}–{repeatRemoval.endings.secondEnd + 1}. Notes and rests remain.</p>
        : <p>The repeat markers will be removed. Notes and rests remain.</p>}
      {repeatApplyError && <p className="alert" role="alert">{repeatApplyError}</p>}
      <div className="duplicate-dialog-actions"><button type="button" data-repeat-remove-cancel onClick={() => setRepeatRemoval(null)}>Cancel</button>
        <button type="button" onClick={confirmRepeatRemoval}>Clear repeat and endings</button></div>
    </dialog>
    <dialog ref={graceDialog} className="duplicate-dialog grace-dialog" aria-label={graceTarget?.existing ? 'Edit grace group' : 'Add grace group'}
      onCancel={event => { event.preventDefault(); setGraceTarget(null); }}>
      <h2>{graceTarget?.existing ? 'Edit grace group' : 'Add grace group'}</h2>
      <p>Destination: measure {graceTarget?.selection.measure}, event {(graceTarget?.destination ?? 0) + 1}. Grace notes play before it without using measure time.</p>
      {!graceTarget ? null : graceTarget.readOnly.length ? <div className="grace-read-only" role="note">
        <p>This imported grace group is read-only, so Playtab keeps it exactly as written:</p>
        <ul>{graceTarget.readOnly.map(reason => <li key={reason}>{reason}</li>)}</ul>
        <p>Cancel keeps it unchanged. Remove grace group deletes the whole group{graceTarget.connections.length ? ` and disconnects its ${graceTarget.connections.join(', ')}` : ''}.</p>
      </div> : <>
        {graceEvents.map((event, eventIndex) => <fieldset key={eventIndex} className="grace-event">
          <legend>Grace event {eventIndex + 1}</legend>
          <label>Display duration<select aria-label={`Grace event ${eventIndex + 1} display duration`} data-grace-first={eventIndex === 0 ? '' : undefined}
            value={event.denominator ?? ''} onChange={change => updateGraceEvent(eventIndex, current => ({ ...current,
              denominator: change.target.value ? Number(change.target.value) as 8 | 16 : null }))}>
            {event.denominator === null && <option value="">Source default</option>}
            <option value={8}>1/8</option><option value={16}>1/16</option></select></label>
          {event.notes.map((note, noteIndex) => <div key={noteIndex} className="grace-note-row">
            <label>String<select aria-label={`Grace event ${eventIndex + 1} string ${noteIndex + 1}`} value={note.string}
              onChange={change => updateGraceEvent(eventIndex, current => ({ ...current, notes: current.notes.map((item, at) =>
                at === noteIndex ? { ...item, string: Number(change.target.value) } : item) }))}>
              {[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Fret<input aria-label={`Grace event ${eventIndex + 1} fret ${noteIndex + 1}`} inputMode="numeric" type="number" min={0} max={36} value={note.fret}
              onChange={change => updateGraceEvent(eventIndex, current => ({ ...current, notes: current.notes.map((item, at) =>
                at === noteIndex ? { ...item, fret: Number(change.target.value) } : item) }))} /></label>
            <label>Transition<select aria-label={`Grace event ${eventIndex + 1} transition ${noteIndex + 1}`} value={note.transition}
              onChange={change => updateGraceEvent(eventIndex, current => ({ ...current, notes: current.notes.map((item, at) =>
                at === noteIndex ? { ...item, transition: change.target.value as GraceTransition } : item) }))}>
              <option value="none">None</option><option value="hammer-on">Hammer-on</option><option value="pull-off">Pull-off</option><option value="slide">Slide</option></select></label>
            {event.notes.length > 1 && <button type="button" aria-label={`Remove grace event ${eventIndex + 1} string ${noteIndex + 1}`}
              onClick={() => updateGraceEvent(eventIndex, current => ({ ...current, notes: current.notes.filter((_, at) => at !== noteIndex) }))}>Remove string</button>}
          </div>)}
          <div className="grace-event-actions">
            <button type="button" aria-label={`Add string to grace event ${eventIndex + 1}`} disabled={event.notes.length >= 5}
              onClick={() => updateGraceEvent(eventIndex, current => {
                const unused = [1, 2, 3, 4, 5].find(value => !current.notes.some(item => item.string === value))!;
                return { ...current, notes: [...current.notes, { string: unused, fret: 0, transition: 'none' }] };
              })}>Add string</button>
            {graceEvents.length > 1 && <button type="button" aria-label={`Remove grace event ${eventIndex + 1}`}
              onClick={() => { setGraceError(''); setGraceEvents(current => current.filter((_, at) => at !== eventIndex)); }}>Remove event</button>}
          </div>
        </fieldset>)}
        <button type="button" className="grace-add-event" disabled={graceEvents.length >= 8} onClick={() => { setGraceError('');
          setGraceEvents(current => [...current, { denominator: 16, notes: [{ string: current.at(-1)?.notes[0].string ?? 1, fret: 0, transition: 'none' }] }]); }}>Add grace event</button>
      </>}
      {gracePreview?.error && <p className="alert" role="alert">{gracePreview.error}</p>}
      {graceError && <p className="alert" role="alert">{graceError}</p>}
      <div className="duplicate-dialog-actions">
        <button type="button" data-grace-first={graceTarget?.readOnly.length ? '' : undefined} onClick={() => setGraceTarget(null)}>Cancel</button>
        {graceTarget?.existing && <button type="button" onClick={removeGraceGroup}>Remove grace group</button>}
        {!graceTarget?.readOnly.length && <button type="button" disabled={!gracePreview?.candidate}
          onClick={() => { if (gracePreview?.candidate) confirmGrace(gracePreview.candidate); }}>Apply grace group</button>}
      </div>
    </dialog>
    <dialog ref={anchorDialog} className="duplicate-dialog anchor-dialog" aria-label={anchorTarget ? ANCHOR_NAMES[anchorTarget.kind].title : 'Text'}
      onCancel={event => { event.preventDefault(); setAnchorTarget(null); }}>
      {anchorTarget && (() => {
        const { kind, items, selection: target } = anchorTarget;
        const name = ANCHOR_NAMES[kind].item;
        const current = anchorChoice === 'new' ? undefined : items[anchorChoice];
        const root = (label: string, value: ChordRoot, change: (next: ChordRoot) => void) => <>
          <label>{label}<select aria-label={label} value={value.step} onChange={event => change({ ...value, step: event.target.value as ChordRoot['step'] })}>
            {CHORD_STEPS.map(step => <option key={step} value={step}>{step}</option>)}</select></label>
          <label>{label} accidental<select aria-label={`${label} accidental`} value={value.alter} onChange={event => change({ ...value, alter: Number(event.target.value) as ChordRoot['alter'] })}>
            <option value={0}>Natural</option><option value={-1}>Flat ♭</option><option value={1}>Sharp ♯</option></select></label>
        </>;
        return <>
          <h2>{ANCHOR_NAMES[kind].title}</h2>
          <p>{kind === 'section' ? `Anchored at the start of measure ${target.measure}.` : `Anchored at measure ${target.measure}, event ${target.event}.`}</p>
          {items.length > 0 && <label className="anchor-choice">Item<select aria-label="Existing item" data-anchor-first="" value={anchorChoice}
            onChange={event => chooseAnchorItem(event.target.value === 'new' ? 'new' : Number(event.target.value), items)}>
            {items.map((item, index) => <option key={index} value={index}>{item.text}</option>)}
            <option value="new">Add new {name}</option></select></label>}
          {current?.reason && <p className="grace-read-only" role="note">{current.reason}</p>}
          {kind === 'chord' ? <div className="insert-dialog-fields">
            {root('Root', anchorChord, next => { setAnchorError(''); setAnchorChord(chord => ({ ...chord, ...next })); })}
            <label>Quality<select aria-label="Quality" value={anchorChord.quality} onChange={event => { setAnchorError(''); setAnchorChord(chord => ({ ...chord, quality: event.target.value as ChordQuality })); }}>
              {CHORD_QUALITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Bass<select aria-label="Bass" value={anchorChord.bass?.step ?? ''} onChange={event => { setAnchorError('');
              const step = event.target.value as ChordRoot['step'] | '';
              setAnchorChord(chord => ({ ...chord, bass: step ? { step, alter: chord.bass?.alter ?? 0 } : null })); }}>
              <option value="">None</option>{CHORD_STEPS.map(step => <option key={step} value={step}>{step}</option>)}</select></label>
            {anchorChord.bass && <label>Bass accidental<select aria-label="Bass accidental" value={anchorChord.bass.alter}
              onChange={event => { const alter = Number(event.target.value) as ChordRoot['alter']; setAnchorChord(chord => ({ ...chord, bass: chord.bass && { ...chord.bass, alter } })); }}>
              <option value={0}>Natural</option><option value={-1}>Flat ♭</option><option value={1}>Sharp ♯</option></select></label>}
            <p className="anchor-chord-preview">Shows as <strong>{chordSpellingName(anchorChord)}</strong></p>
          </div> : <label className="anchor-text">Text<input aria-label="Text" data-anchor-first={items.length ? undefined : ''} maxLength={ANCHOR_TEXT_LIMIT} value={anchorText}
            onChange={event => { setAnchorError(''); setAnchorText(event.target.value); }} /></label>}
          {anchorError && <p className="alert" role="alert">{anchorError}</p>}
          <div className="duplicate-dialog-actions">
            <button type="button" data-anchor-first={kind === 'chord' && !items.length ? '' : undefined} onClick={() => setAnchorTarget(null)}>Cancel</button>
            {current && <button type="button" onClick={() => applyAnchor(true)}>Remove {name}</button>}
            <button type="button" disabled={kind !== 'chord' && (!anchorText.trim() || anchorText.trim().length > ANCHOR_TEXT_LIMIT)}
              onClick={() => applyAnchor(false)}>{current?.reason ? `Replace ${name}` : `Apply ${name}`}</button>
          </div>
        </>;
      })()}
    </dialog>
    <dialog ref={lyricDialog} className="duplicate-dialog anchor-dialog" aria-label="Lyric syllable" onCancel={event => { event.preventDefault(); setLyricTarget(null); }}>
      {lyricTarget && (() => {
        const current = lyricTarget.lyrics.find(lyric => lyric.verse === lyricDraft.verse);
        const kept = lyricTarget.lyrics.filter(lyric => lyric.verse === 0);
        return <>
          <h2>Lyric syllable</h2>
          <p>Measure {lyricTarget.selection.measure}, event {lyricTarget.selection.event}. Other verses and the Lyrics &amp; chords text are not changed.</p>
          <div className="insert-dialog-fields">
            <label>Verse<select aria-label="Verse" data-text-first="" value={lyricDraft.verse} onChange={event => chooseLyricVerse(Number(event.target.value), lyricTarget.lyrics)}>
              {Array.from({ length: LYRIC_VERSES }, (_, index) => index + 1).map(verse => <option key={verse} value={verse}>
                {verse}{lyricTarget.lyrics.some(lyric => lyric.verse === verse) ? ' •' : ''}</option>)}</select></label>
            <label>Syllabic<select aria-label="Syllabic" value={lyricDraft.syllabic} onChange={event => { setLyricError(''); setLyricDraft(draft => ({ ...draft, syllabic: event.target.value as LyricSyllabic })); }}>
              <option value="single">Single</option><option value="begin">Begin</option><option value="middle">Middle</option><option value="end">End</option></select></label>
          </div>
          <label className="anchor-text">Text<input aria-label="Lyric text" maxLength={ANCHOR_TEXT_LIMIT} value={lyricDraft.text}
            onChange={event => { setLyricError(''); setLyricDraft(draft => ({ ...draft, text: event.target.value })); }} /></label>
          {current?.reason && <p className="grace-read-only" role="note">{current.reason}</p>}
          {kept.map(lyric => <p key={lyric.reason} className="grace-read-only" role="note">{lyric.reason}</p>)}
          {current && !lyricDraft.text.trim() && <p className="editor-rhythm-reason">To clear verse {lyricDraft.verse}, use Remove lyric.</p>}
          {lyricError && <p className="alert" role="alert">{lyricError}</p>}
          <div className="duplicate-dialog-actions">
            <button type="button" onClick={() => setLyricTarget(null)}>Cancel</button>
            {current && <button type="button" onClick={() => applyLyric(true)}>Remove lyric</button>}
            <button type="button" disabled={!lyricDraft.text.trim() || Boolean(current?.reason)} onClick={() => applyLyric(false)}>Apply lyric</button>
          </div>
        </>;
      })()}
    </dialog>
    <dialog ref={standaloneDialog} className="duplicate-dialog standalone-dialog" aria-label="Lyrics and chords text" onCancel={event => { event.preventDefault(); setStandaloneTarget(null); }}>
      <h2>Lyrics &amp; chords</h2>
      <p>Whole-score text shown on its own tab and printed after the tablature. It is separate from timed lyrics. Leave it empty to remove it.</p>
      <label className="anchor-text">Text<textarea aria-label="Lyrics and chords text" data-text-first="" rows={14} maxLength={STANDALONE_LYRICS_LIMIT} value={standaloneText}
        onChange={event => { setStandaloneError(''); setStandaloneText(event.target.value); }} /></label>
      <p className="editor-rhythm-reason">{standaloneText.length.toLocaleString('en-US')} / {STANDALONE_LYRICS_LIMIT.toLocaleString('en-US')} characters</p>
      {standaloneError && <p className="alert" role="alert">{standaloneError}</p>}
      <div className="duplicate-dialog-actions">
        <button type="button" onClick={() => setStandaloneTarget(null)}>Cancel</button>
        <button type="button" onClick={applyStandalone}>Apply text</button>
      </div>
    </dialog>
    <dialog ref={pasteDialog} className="duplicate-dialog" aria-label="Paste passage" onCancel={event => { event.preventDefault(); setPasteTarget(null); }}>
      {pasteTarget && clipboard && (() => {
        let candidate: string | null = null;
        let problem = '';
        const count = clipboard.measures.length;
        const canReplace = pasteTarget.replaceFrom !== null && pasteTarget.replaceCount === count;
        const replacing = pastePlacement === 'replace' && canReplace;
        try {
          candidate = pasteMusicXmlMeasures(pasteTarget.base.source, pasteTarget.base.score, clipboard,
            (replacing ? pasteTarget.replaceFrom! : pasteTarget.measure) - 1, replacing ? 'replace' : 'insert', pasteMode);
        } catch (failure) { problem = (failure as Error).message; }
        return <>
          <h2>Paste passage</h2>
          <p>{replacing ? `Destination: measures ${pasteTarget.replaceFrom}–${pasteTarget.replaceFrom! + count - 1}.` : `Destination: before measure ${pasteTarget.measure}.`} Source: {count} measure{count === 1 ? '' : 's'} from “{clipboard.title}” ({clipboard.meters.join(', ')}). {replacing ? 'The bar count stays the same.' : `The score will grow by ${count} measure${count === 1 ? '' : 's'}.`}</p>
          <fieldset className="settings-mode"><legend>Placement</legend>
            <label><input type="radio" name="paste-placement" data-text-first="" checked={!replacing} onChange={() => setPastePlacement('insert')} />Insert measures before measure {pasteTarget.measure}</label>
            <label><input type="radio" name="paste-placement" disabled={!canReplace} checked={replacing} onChange={() => setPastePlacement('replace')} />Replace selected measures</label>
            {!canReplace && <p className="editor-rhythm-reason">To replace, select {count} whole measure{count === 1 ? '' : 's'} as the passage first.</p>}
          </fieldset>
          <fieldset className="settings-mode"><legend>If the tuning differs</legend>
            <label><input type="radio" name="paste-mode" checked={pasteMode === 'frets'} onChange={() => setPasteMode('frets')} />Keep frets (pitches follow this score’s tuning)</label>
            <label><input type="radio" name="paste-mode" checked={pasteMode === 'pitches'} onChange={() => setPasteMode('pitches')} />Keep pitches (frets change)</label>
          </fieldset>
          {clipboard.excluded.length > 0 && <p className="grace-read-only" role="note">Not pasted: {clipboard.excluded.join('; ')}.</p>}
          {problem && <p className="alert" role="alert">{problem}</p>}
          {pasteError && <p className="alert" role="alert">{pasteError}</p>}
          <div className="duplicate-dialog-actions">
            <button type="button" onClick={() => setPasteTarget(null)}>Cancel</button>
            <button type="button" disabled={!candidate} onClick={() => { if (candidate) applyPaste(candidate); }}>Paste</button>
          </div>
        </>;
      })()}
    </dialog>
    <dialog ref={cutDialog} className="duplicate-dialog" aria-label="Cut passage" onCancel={event => { event.preventDefault(); setCutTarget(null); }}>
      {cutTarget && <>
        <h2>Cut {cutTarget.first === cutTarget.last ? `measure ${cutTarget.first}` : `measures ${cutTarget.first}–${cutTarget.last}`}?</h2>
        <p>The measures are copied to the clipboard and left as rests at the same beats. The bar count, meter, tempo and later timing do not change.</p>
        <ul>
          <li>{cutTarget.cut.notes} note{cutTarget.cut.notes === 1 ? '' : 's'}</li>
          {cutTarget.cut.labels > 0 && <li>{cutTarget.cut.labels} chord or text label{cutTarget.cut.labels === 1 ? '' : 's'}</li>}
          {cutTarget.cut.lyrics > 0 && <li>{cutTarget.cut.lyrics} lyric syllable{cutTarget.cut.lyrics === 1 ? '' : 's'}</li>}
          {cutTarget.cut.spans.length > 0 && <li>Connected techniques inside: {cutTarget.cut.spans.join(', ')}</li>}
        </ul>
        <div className="duplicate-dialog-actions">
          <button type="button" data-text-first="" onClick={() => setCutTarget(null)}>Cancel</button>
          <button type="button" onClick={confirmCut}>Cut</button>
        </div>
      </>}
    </dialog>
    <dialog ref={newScoreDialog} className="duplicate-dialog settings-dialog" aria-label="New score" onCancel={event => { event.preventDefault(); setNewScoreOpen(false); }}>
      {newScoreOpen && <>
      <h2>New score</h2>
      <label className="anchor-text">Title<input aria-label="New score title" data-new-first="" maxLength={160} value={newScoreDraft.title}
        onChange={event => { setNewScoreError(''); setNewScoreDraft(draft => ({ ...draft, title: event.target.value })); }} /></label>
      <div className="insert-dialog-fields">
        <label>Tempo (BPM)<input aria-label="New score tempo" type="number" inputMode="numeric" min={30} max={240} value={newScoreDraft.tempo}
          onChange={event => { setNewScoreError(''); setNewScoreDraft(draft => ({ ...draft, tempo: event.target.value })); }} /></label>
        <label>Measures<input aria-label="New score measures" type="number" inputMode="numeric" min={1} max={256} value={newScoreDraft.measures}
          onChange={event => { setNewScoreError(''); setNewScoreDraft(draft => ({ ...draft, measures: event.target.value })); }} /></label>
        <label>Beats<select aria-label="New score beats" value={newScoreDraft.numerator} onChange={event => setNewScoreDraft(draft => ({ ...draft, numerator: event.target.value }))}>
          {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
        <label>Beat unit<select aria-label="New score beat unit" value={newScoreDraft.denominator} onChange={event => setNewScoreDraft(draft => ({ ...draft, denominator: event.target.value }))}>
          {[2, 4, 8, 16].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <fieldset className="settings-mode"><legend>Tuning</legend>
        <label><input type="radio" name="new-tuning" checked={newScoreDraft.tuningPreset === 'open-g'} onChange={() => setNewScoreDraft(draft => ({ ...draft, tuningPreset: 'open-g' }))} />Open G (gDGBD)</label>
        <label><input type="radio" name="new-tuning" checked={newScoreDraft.tuningPreset === 'custom'} onChange={() => setNewScoreDraft(draft => ({ ...draft, tuningPreset: 'custom' }))} />Custom</label>
      </fieldset>
      {newScoreDraft.tuningPreset === 'custom' && <fieldset className="settings-tuning"><legend>Open-string MIDI pitch</legend>
        {newScoreDraft.tuning.map((value, index) => <label key={index}>String {index + 1}<input aria-label={`New score string ${index + 1} pitch`} type="number" inputMode="numeric" min={36} max={96}
          value={value} onChange={event => { setNewScoreError(''); setNewScoreDraft(draft => ({ ...draft, tuning: draft.tuning.map((item, at) => at === index ? event.target.value : item) })); }} />
          <span>{midiName(Number(value))}</span></label>)}
      </fieldset>}
      {newScoreError && <p className="alert" role="alert">{newScoreError}</p>}
      <div className="duplicate-dialog-actions">
        <button type="button" onClick={() => setNewScoreOpen(false)}>Cancel</button>
        <button type="button" onClick={createNewScore}>Create score</button>
      </div>
      </>}
    </dialog>
    <dialog ref={settingsDialog} className="duplicate-dialog settings-dialog" aria-label="Score settings" onCancel={event => { event.preventDefault(); setSettingsTarget(null); }}>
      {settingsTarget && (() => {
        const { base, info } = settingsTarget;
        const tuning = settingsDraft.tuning.map(Number);
        const tuningChanged = tuning.some((value, index) => value !== info.tuning[index]);
        let candidate: { source: string; tuningRange: { first: number; last: number } } | null = null;
        let problem = '';
        try {
          candidate = applyMusicXmlScoreSettings(base.source, base.score, { title: settingsDraft.title, tempo: Number(settingsDraft.tempo), tuning, mode: settingsDraft.mode });
        } catch (failure) { problem = (failure as Error).message; }
        const last = info.tuningRange.last;
        const measures = base.score.masterBars.length;
        return <>
          <h2>Score settings</h2>
          <label className="anchor-text">Title<input aria-label="Title" data-text-first="" maxLength={ANCHOR_TEXT_LIMIT} value={settingsDraft.title}
            onChange={event => { setSettingsError(''); setSettingsDraft(draft => ({ ...draft, title: event.target.value })); }} /></label>
          <label className="anchor-text">Opening tempo (BPM)<input aria-label="Opening tempo" type="number" inputMode="numeric" min={TEMPO_LIMITS.min} max={TEMPO_LIMITS.max}
            value={settingsDraft.tempo} onChange={event => { setSettingsError(''); setSettingsDraft(draft => ({ ...draft, tempo: event.target.value })); }} /></label>
          <fieldset className="settings-tuning"><legend>Tuning (open-string MIDI pitch)</legend>
            {settingsDraft.tuning.map((value, index) => <label key={index}>String {index + 1}<input aria-label={`String ${index + 1} pitch`} type="number" inputMode="numeric"
              min={TUNING_LIMITS.min} max={TUNING_LIMITS.max} value={value} onChange={event => { setSettingsError('');
                setSettingsDraft(draft => ({ ...draft, tuning: draft.tuning.map((item, at) => at === index ? event.target.value : item) })); }} />
              <span aria-label={`String ${index + 1} note`}>{midiName(Number(value))}</span></label>)}
          </fieldset>
          <fieldset className="settings-mode"><legend>When tuning changes</legend>
            <label><input type="radio" name="tuning-mode" checked={settingsDraft.mode === 'frets'} onChange={() => setSettingsDraft(draft => ({ ...draft, mode: 'frets' }))} />Keep frets (pitches change)</label>
            <label><input type="radio" name="tuning-mode" checked={settingsDraft.mode === 'pitches'} onChange={() => setSettingsDraft(draft => ({ ...draft, mode: 'pitches' }))} />Keep pitches (frets change)</label>
          </fieldset>
          <p className="editor-rhythm-reason">{tuningChanged ? 'Tuning applies to' : 'A tuning change would apply to'} measures 1–{last}{last < measures ? `; measure ${last + 1} changes tuning again and is not affected` : ''}.</p>
          {problem && <p className="alert" role="alert">{problem}</p>}
          {settingsError && <p className="alert" role="alert">{settingsError}</p>}
          <div className="duplicate-dialog-actions">
            <button type="button" onClick={() => setSettingsTarget(null)}>Cancel</button>
            <button type="button" disabled={!candidate} onClick={() => { if (candidate) applySettings(candidate); }}>Apply settings</button>
          </div>
        </>;
      })()}
    </dialog>
    <dialog ref={tempoDialog} className="duplicate-dialog" aria-label="Set tempo here" onCancel={event => { event.preventDefault(); setTempoTarget(null); }}>
      {tempoTarget && <>
        <h2>Set tempo here</h2>
        {tempoTarget.info.opening ? <p>The first event uses the opening tempo ({tempoTarget.info.local ?? tempoTarget.info.inherited} BPM). Change it in Score settings.</p> : <>
          <p>Measure {tempoTarget.selection.measure}, event {tempoTarget.selection.event}. {tempoTarget.info.local !== null
            ? `A local tempo of ${tempoTarget.info.local} BPM starts here; without it, ${tempoTarget.info.inherited} BPM continues.`
            : `${tempoTarget.info.inherited} BPM continues here from earlier in the score.`}</p>
          <label className="anchor-text">Tempo (BPM)<input aria-label="Tempo" data-text-first="" type="number" inputMode="numeric" min={TEMPO_LIMITS.min} max={TEMPO_LIMITS.max}
            value={tempoDraft} onChange={event => { setTempoError(''); setTempoDraft(event.target.value); }} /></label>
        </>}
        {tempoError && <p className="alert" role="alert">{tempoError}</p>}
        <div className="duplicate-dialog-actions">
          <button type="button" data-text-first={tempoTarget.info.opening ? '' : undefined} onClick={() => setTempoTarget(null)}>Cancel</button>
          {!tempoTarget.info.opening && tempoTarget.info.local !== null && <button type="button" onClick={() => applyTempo(true)}>Remove local tempo</button>}
          {!tempoTarget.info.opening && <button type="button" onClick={() => applyTempo(false)}>Apply tempo</button>}
        </div>
      </>}
    </dialog>
    <dialog ref={bendDialog} className="duplicate-dialog bend-dialog" aria-label="Bend" onCancel={event => { event.preventDefault(); setBendTarget(null); }}>
      <h2>Bend</h2>
      <p>Measure {bendTarget?.selection.measure}, event {bendTarget?.selection.event}, string {bendTarget?.selection.string}. The pitch reaches the bend by the middle of the note.</p>
      {bendTarget?.reason && <p className="grace-read-only" role="note">{bendTarget.reason}</p>}
      <div className="insert-dialog-fields">
        <label>Amount<select data-bend-first="" value={bendDraft.amount} onChange={event => setBendDraft(current => ({ ...current, amount: Number(event.target.value) as BendAmount }))}>
          {([1, 2, 3, 4] as BendAmount[]).map(amount => <option key={amount} value={amount}>{BEND_LABELS[amount]}</option>)}</select></label>
        <label>Shape<select value={bendDraft.shape} onChange={event => setBendDraft(current => ({ ...current, shape: event.target.value as NoteBend['shape'] }))}>
          <option value="bend">Bend</option><option value="release">Bend and release</option></select></label>
      </div>
      <div className="duplicate-dialog-actions">
        <button type="button" onClick={() => setBendTarget(null)}>Cancel</button>
        {bendTarget?.existing !== 'none' && <button type="button" onClick={() => applyBend(null)}>Remove bend</button>}
        <button type="button" onClick={() => applyBend(bendDraft)}>{bendTarget?.existing === null ? 'Replace bend' : 'Apply bend'}</button>
      </div>
    </dialog>
    <dialog ref={pickupDialog} className="duplicate-dialog" aria-label="Pickup" onCancel={event => { event.preventDefault(); setPickupTarget(null); }}>
      <h2>Pickup length</h2>
      <p>Set the first measure’s actual length. It must be shorter than the nominal time signature.</p>
      <div className="insert-dialog-fields">
        <label>Numerator<input data-pickup-first type="number" min={1} step={1} value={pickupDraft.numerator}
          onChange={event => { setPickupApplyError(''); setPickupDraft(current => ({ ...current, numerator: Number(event.target.value) })); }} /></label>
        <label>Denominator<select value={pickupDraft.denominator}
          onChange={event => { setPickupApplyError(''); setPickupDraft(current => ({ ...current, denominator: Number(event.target.value) as 2 | 4 | 8 | 16 | 32 | 64 })); }}>
          {[2, 4, 8, 16, 32, 64].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      {pickupPreview?.error && <p className="alert" role="alert">{pickupPreview.error}</p>}
      {pickupApplyError && <p className="alert" role="alert">{pickupApplyError}</p>}
      <div className="duplicate-dialog-actions"><button type="button" onClick={() => setPickupTarget(null)}>Cancel</button>
        <button type="button" disabled={!pickupPreview?.source} onClick={() => { if (pickupPreview?.source) confirmPickupChange(pickupPreview.source); }}>Apply</button></div>
    </dialog>
    <dialog ref={duplicateDialog} className="duplicate-dialog" aria-label="Duplicate measure" onCancel={event => { event.preventDefault(); setPendingDuplication(null); }}>
      <h2>Duplicate measure {pendingDuplication ? pendingDuplication.measureIndex + 1 : ''}?</h2>
      <p>The copy will include {pendingDuplication?.noteCount ?? 0} note{pendingDuplication?.noteCount === 1 ? '' : 's'} and {pendingDuplication?.restCount ?? 0} rest{pendingDuplication?.restCount === 1 ? '' : 's'}, plus local labels and contained techniques.</p>
      <p>The copy will exclude:</p>
      {pendingDuplication?.excluded.length ? <ul>{pendingDuplication.excluded.map(item => <li key={item}>{item}</li>)}</ul>
        : <p>No external spans or repeat markers.</p>}
      <div className="duplicate-dialog-actions"><button type="button" data-duplicate-cancel onClick={() => setPendingDuplication(null)}>Cancel</button><button type="button" onClick={confirmDuplicateMeasure}>Duplicate measure</button></div>
    </dialog>
    <dialog ref={insertDialog} className="insert-dialog" aria-label="Insert event" onCancel={event => { event.preventDefault(); setInsertOpen(false); }}>
      <h2>Insert event</h2>
      <p>Following events move within this voice and measure. Trailing rests make room.</p>
      {insertOpen && error && <p className="alert" role="alert">{error}</p>}
      <div className="insert-dialog-fields">
        <label>Position<select data-insert-first value={insertDraft.placement} onChange={event => setInsertDraft(current => ({ ...current, placement: event.target.value as 'before' | 'after' }))}><option value="before">Before</option><option value="after">After</option></select></label>
        <label>Type<select value={insertDraft.kind} onChange={event => setInsertDraft(current => ({ ...current, kind: event.target.value as 'note' | 'rest' }))}><option value="note">Note</option><option value="rest">Rest</option></select></label>
        <label>Duration<select value={insertDraft.denominator} onChange={event => setInsertDraft(current => ({ ...current, denominator: Number(event.target.value) as DurationDenominator }))}>{DURATION_DENOMINATORS.map(value => <option key={value} value={value}>{value === 1 ? '1' : `1/${value}`}</option>)}</select></label>
        <label className="insert-dialog-check"><input type="checkbox" checked={insertDraft.dotted} onChange={event => setInsertDraft(current => ({ ...current, dotted: event.target.checked }))} />Dotted</label>
        {insertDraft.kind === 'note' && <>
          <label>String<select value={insertDraft.string} onChange={event => setInsertDraft(current => ({ ...current, string: Number(event.target.value) }))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Fret<input type="number" inputMode="numeric" min={0} max={36} step={1} value={insertDraft.fret} onChange={event => setInsertDraft(current => ({ ...current, fret: Number(event.target.value) }))} /></label>
        </>}
      </div>
      <div className="insert-dialog-actions"><button type="button" onClick={() => setInsertOpen(false)}>Cancel</button><button type="button" onClick={confirmInsertEvent}>Insert</button></div>
    </dialog>
    <dialog ref={removalDialog} className="removal-dialog" aria-label="Confirm note removal" onCancel={event => { event.preventDefault(); setPendingRemoval(null); }}>
      <h2>Remove connected music?</h2>
      <p>This edit also removes or disconnects:</p>
      <ul>{pendingRemoval?.dependencies.map(dependency => <li key={dependency}>{dependency}</li>)}</ul>
      <div className="removal-dialog-actions">
        <button type="button" data-removal-cancel onClick={() => setPendingRemoval(null)}>Cancel</button>
        <button type="button" onClick={confirmRemoval}>{pendingRemoval?.mode === 'rest' ? 'Make rest' : pendingRemoval?.mode === 'grace' ? 'Remove grace' : 'Remove note'}</button>
      </div>
    </dialog>
    <dialog ref={copyDialog} className="copy-dialog" aria-label="Save a copy">
      <h2>Save a copy</h2>
      <label>Copy title<input aria-label="Copy title" value={copyTitle} maxLength={160} onChange={event => setCopyTitle(event.target.value)} /></label>
      <div className="copy-dialog-actions"><button type="button" onClick={() => copyDialog.current?.close()}>Cancel</button><button type="button" disabled={saving || !copyTitle.trim()} onClick={() => {
        if (!commitPendingFret()) {
          copyDialog.current?.close();
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Fret"]')?.focus({ preventScroll: true }));
          return;
        }
        copyDialog.current?.close(); void save(copyTitle.trim());
      }}>Save copy</button></div>
    </dialog>
    <dialog ref={leaveDialog} className="guard-dialog" aria-label="Unsaved changes" onCancel={event => { event.preventDefault(); cancelLeave(); }}>
      <h2>Save changes before leaving this score?</h2>
      <p>Your unsaved edits will be lost if you discard them.</p>
      {guardError && <p className="alert" role="alert">{guardError}</p>}
      <div className="guard-dialog-actions">
        <button type="button" data-leave-cancel onClick={cancelLeave}>Cancel</button>
        <button type="button" disabled={saving} onClick={() => { const action = leaveAction.current; leaveAction.current = null; setLeaveOpen(false); if (action) void action(); }}>Discard</button>
        <button type="button" disabled={saving} onClick={() => void saveAndContinue()}>Save and continue</button>
      </div>
    </dialog>
    <dialog ref={discardDialog} className="guard-dialog" aria-label="Discard unsaved changes" onCancel={event => { event.preventDefault(); setDiscardOpen(false); }}>
      <h2>Discard unsaved changes?</h2>
      <p>This restores the last saved version, or the score as you first opened it.</p>
      <div className="guard-dialog-actions"><button type="button" data-discard-cancel onClick={() => setDiscardOpen(false)}>Cancel</button><button type="button" onClick={() => void confirmDiscard()}>Discard changes</button></div>
    </dialog>
    <dialog ref={conflictDialog} className="guard-dialog" aria-label="Score changed in another tab" onCancel={event => { event.preventDefault(); setConflictOpen(false); }}>
      <h2>This score changed in another tab.</h2>
      <p>Your draft is still here. Choose how to continue; Playtab will not overwrite the newer saved version.</p>
      <div className="guard-dialog-actions">
        <button type="button" data-conflict-keep onClick={() => setConflictOpen(false)}>Keep editing</button>
        <button type="button" onClick={() => { setConflictOpen(false); requestAnimationFrame(openCopyDialog); }}>Save as copy…</button>
        <button type="button" onClick={() => { setConflictOpen(false); askDiscard(() => reloadSavedVersion()); }}>Reload saved version…</button>
      </div>
    </dialog>
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
