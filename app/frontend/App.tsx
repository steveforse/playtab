import { useEffect, useRef, useState } from 'react';
import { defaultPlayerPreferences, Player, type PlayerPreferences, type ScoreSelection } from './Player';
import { demo, isImportedScoreDocument, validateScore, validateStoredScore, type Score } from './music/score';
import { exportAscii, parseAscii } from './music/ascii';
import { readMusicXml, toImportedScoreDocument, type MusicXmlPreview } from './music/musicxml';
import { addMusicXmlNote, applyMusicXmlEdits, musicXmlEditorState, removeMusicXmlNotes } from './music/musicxml-editor';
import { documentKey, emptyHistory, record, travel, type Snapshot } from './editor/history';

type LibraryItem = { id: number; title: string };
type PendingRemoval = { beforeSource: string; afterSource: string; selection: ScoreSelection; mode: 'note' | 'rest'; dependencies: string[] };
const initialText = exportAscii(demo);
const userEmail = () => document.getElementById('playtab-root')?.dataset.userEmail ?? '';
async function apiRequest(path: string, options?: RequestInit) {
  const response = await fetch(path, { ...options, headers: {
    ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    'X-CSRF-Token': document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '',
    ...options?.headers,
  } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return response.json();
}

export function App() {
  const [score, setScore] = useState<Score>(demo);
  const [preview, setPreview] = useState<MusicXmlPreview | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showWarnings, setShowWarnings] = useState(false);
  const [showPracticeTip, setShowPracticeTip] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [selection, setSelection] = useState<ScoreSelection | null>(null);
  const [fretDraft, setFretDraft] = useState('');
  const [moveString, setMoveString] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const removalDialog = useRef<HTMLDialogElement>(null);
  const removalOpener = useRef<HTMLElement | null>(null);
  const [history, setHistory] = useState(emptyHistory);
  const [historyRevision, setHistoryRevision] = useState(0);
  const savedBaseline = useRef<string | null>(null);
  const session = useRef(0);
  const currentDocument = preview ? toImportedScoreDocument(preview, warnings) : score;
  const currentDocumentRef = useRef(currentDocument);
  currentDocumentRef.current = currentDocument;
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(initialText);
  const [title, setTitle] = useState('My banjo tab');
  const [duration, setDuration] = useState<4 | 8 | 16>(8);
  const [importError, setImportError] = useState('');
  const [reading, setReading] = useState(false);
  const [playerPreferences, setPlayerPreferences] = useState<PlayerPreferences>(defaultPlayerPreferences);

  async function signOut() {
    const response = await fetch('/session', {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '' },
    });
    if (!response.ok) throw new Error('Could not sign out.');
    window.location.assign('/session/new');
  }

  useEffect(() => { apiRequest('/api/songs').then(setLibrary).catch(e => setError(e.message)); }, []);
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
  function load(next: Score, original: string | null, diagnostics: string[] = [], id: number | null = null) {
    session.current++;
    savedBaseline.current = id === null ? null : documentKey(next);
    setHistory(emptyHistory()); setHistoryRevision(value => value + 1);
    setPreview(null);
    setEditMode(false); setLibraryCollapsed(false);
    setSelection(null);
    setPendingRemoval(null);
    setScore(next); setSource(original); setWarnings(diagnostics); setShowWarnings(diagnostics.length > 0); setSavedId(id); setDirty(id === null); setMessage(''); setError('');
  }
  function loadPreview(next: MusicXmlPreview, diagnostics: string[] = [], id: number | null = null) {
    session.current++;
    savedBaseline.current = id === null ? null : documentKey(toImportedScoreDocument(next, diagnostics));
    setHistory(emptyHistory()); setHistoryRevision(value => value + 1);
    setEditMode(false); setLibraryCollapsed(false);
    setSelection(null);
    setPendingRemoval(null);
    setPreview(next); setScore(demo); setSource(null); setWarnings(diagnostics); setShowWarnings(diagnostics.length > 0); setSavedId(id); setDirty(id === null); setMessage(''); setError('');
  }
  function toggleEditMode() {
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
    setHistory(current => record(current, { before: { document: currentDocument, selection }, after, description, group }));
    setDirty(documentKey(after.document) !== savedBaseline.current);
  }
  function moveHistory(direction: 'undo' | 'redo') {
    const result = travel(history, direction);
    if (!result) return;
    try {
      const document = result.snapshot.document;
      // Parse before publishing; a failed restoration keeps the current draft.
      const restored = isImportedScoreDocument(document) ? readMusicXml(document.source, document.sourceName, document.sourceFormat) : null;
      setPreview(restored);
      if (!isImportedScoreDocument(document)) setScore(document);
      else setWarnings(document.warnings);
      setSelection(result.snapshot.selection);
      setPendingRemoval(null);
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
  function updateSelectedScore(selectionToEdit: ScoreSelection, editNative: (notes: { string: number; fret: number }[]) => void, editImported: (note: ReturnType<typeof musicXmlEditorState>['notes'][number]) => void, afterSelection: ScoreSelection, description: string, group?: string) {
    if (preview) {
      if (selectionToEdit.string === null) return false;
      try {
        const state = musicXmlEditorState(preview.source, preview.score);
        const note = state.notes.find(candidate => candidate.measure === selectionToEdit.measure - 1 && candidate.beat === selectionToEdit.event - 1 && candidate.string === selectionToEdit.string);
        if (!note) {
          setError('This imported position has no source note to edit yet.');
          return false;
        }
        editImported(note);
        const nextSource = applyMusicXmlEdits(preview.source, state, [note.index]);
        const nextPreview = readMusicXml(nextSource, preview.filename, preview.sourceFormat);
        remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: afterSelection }, description, group);
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
    if (!preview && fret > 22) {
      setError('This native score supports frets 0 to 22. Save as MusicXML before using a higher fret.');
      return;
    }
    if (selectionToEdit.string === null) return;
    if (selectionToEdit.kind === 'note' && selectionToEdit.fret === fret) return;
    const after: ScoreSelection = { ...selectionToEdit, kind: 'note', noteId: null, fret };
    if (preview && selectionToEdit.kind !== 'note') {
      try {
        const nextSource = addMusicXmlNote(preview.source, preview.score, {
          measure: selectionToEdit.measure - 1, beat: selectionToEdit.event - 1,
          voice: selectionToEdit.voice - 1, string: selectionToEdit.string, fret,
        });
        const nextPreview = readMusicXml(nextSource, preview.filename, preview.sourceFormat);
        remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after }, `Add fret ${fret}`, group);
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
    }, note => { note.string = destination; }, after, `Move note to string ${destination}`)) return;
    setSelection(after);
  }
  function commitImportedRemoval(nextSource: string, selectionToDelete: ScoreSelection, mode: 'note' | 'rest') {
    if (!preview) return;
    try {
      const beat = preview.score.tracks[0]?.staves[0]?.bars[selectionToDelete.measure - 1]?.voices[selectionToDelete.voice - 1]?.beats[selectionToDelete.event - 1];
      const lastMember = mode === 'rest' || beat?.notes.length === 1;
      const nextPreview = readMusicXml(nextSource, preview.filename, preview.sourceFormat);
      const nextBeats = nextPreview.score.tracks[0]?.staves[0]?.bars[selectionToDelete.measure - 1]?.voices[selectionToDelete.voice - 1]?.beats ?? [];
      const matchingEvent = beat ? nextBeats.findIndex(candidate => !candidate.graceType && candidate.playbackStart === beat.playbackStart) : -1;
      const after: ScoreSelection = { ...selectionToDelete, event: matchingEvent < 0 ? selectionToDelete.event : matchingEvent + 1,
        kind: lastMember ? 'rest' : 'empty', noteId: null, fret: null };
      remember({ document: toImportedScoreDocument(nextPreview, warnings), selection: after }, mode === 'rest' ? 'Make rest' : 'Remove note');
      setPreview(nextPreview);
      setSelection(after);
      setError('');
      documentRefocus();
    } catch (failure) { setError((failure as Error).message); }
  }
  function requestRemoval(selectionToDelete: ScoreSelection, mode: 'note' | 'rest' = 'note') {
    if (selectionToDelete.kind !== 'note' || selectionToDelete.string === null) return;
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
  async function openSong(id: number) {
    try {
      const song = await apiRequest(`/api/songs/${id}`);
      validateStoredScore(song.score);
      if (isImportedScoreDocument(song.score)) loadPreview(readMusicXml(song.score.source, song.score.sourceName, song.score.sourceFormat), song.score.warnings, id);
      else load(song.score, song.source_text, song.source_text ? ['Imported from plaintext using equal-note rhythm. Original text is preserved with this score.'] : [], id);
    } catch (e) { setError((e as Error).message); }
  }
  async function save() {
    setSaving(true); setError('');
    const savingSession = session.current;
    try {
      const document = preview ? toImportedScoreDocument(preview, warnings) : score;
      const item = await apiRequest('/api/songs', { method: 'POST', body: JSON.stringify({ score: document, source_text: preview ? null : source }) });
      if (savingSession !== session.current) return;
      savedBaseline.current = documentKey(document);
      setHistoryRevision(value => value + 1);
      setSavedId(item.id); setDirty(documentKey(currentDocumentRef.current) !== savedBaseline.current); setLibrary(items => [item, ...items]); setMessage('Saved to your library.');
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
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
        loadPreview(readMusicXml(contents, filename, isTef ? 'tef' : isPdf ? 'pdf' : 'musicxml'), isTef || isPdf ? conversionWarnings : ['MusicXML preview: tuning and rhythm come from the file. Save this score to preserve the imported document in your library.']);
        dialog.current?.close();
      } else if (extension === 'json') {
        const document: unknown = JSON.parse(contents); validateScore(document);
        load(document, null); dialog.current?.close();
      } else { setText(contents); setTitle(file.name.replace(/\.txt$/i, '').slice(0, 160)); }
    } catch (e) { setImportError((e as Error).message); } finally { setReading(false); }
  }
  function importText() {
    try {
      const result = parseAscii(text, title, duration);
      load(result.score, text, result.warnings); dialog.current?.close();
    } catch (e) { setImportError((e as Error).message); }
  }
  return <div className={editMode ? 'shell edit-mode' : 'shell'}>
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Playtab home"><span className="brand-mark">♮</span>playtab<span className="brand-dot">.</span></a>
      <div className="sidebar-section">YOUR WORKSPACE</div>
      <button className="nav-item active" aria-expanded={!libraryCollapsed} onClick={() => { if (editMode) setLibraryCollapsed(current => !current); else document.getElementById('library-list')?.scrollIntoView(); }}>▤ <span>My library</span><span className="count">{library.length}</span></button>
      {!libraryCollapsed && <div className="library-list" id="library-list">
        {library.length === 0 ? <div className="empty-library"><p>A home for the tunes<br />you’re working on.</p><button type="button" className="practice-demo" onClick={() => { load(demo, null); }}>♩ <span>Practice demo</span></button></div> : library.map(item => <button className={savedId === item.id ? 'current' : ''} key={item.id} onClick={() => openSong(item.id)}>{item.title}</button>)}
      </div>}
      {editMode && <section className="editor-sidebar" aria-label="Edit tools">
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
              <label>Measure<select aria-label="Selection measure" value={selection.measure} onChange={event => setSelection(current => current ? { ...current, measure: Number(event.target.value), noteId: null } : current)}>{Array.from({ length: Math.max(1, preview?.score.masterBars.length ?? score.measures.length) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
              <label>Event<select aria-label="Selection event" value={selection.event} onChange={event => setSelection(current => current ? { ...current, event: Number(event.target.value), noteId: null } : current)}>{Array.from({ length: Math.max(1, preview?.score.masterBars.length ? 32 : score.measures[selection.measure - 1]?.beats.length ?? 1) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
              <label>Voice<select aria-label="Selection voice" value={selection.voice} onChange={event => setSelection(current => current ? { ...current, voice: Number(event.target.value), noteId: null } : current)}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>String<select aria-label="Selection string" value={selection.string ?? ''} onChange={event => setSelection(current => current ? { ...current, string: event.target.value ? Number(event.target.value) : null, noteId: null } : current)}><option value="">—</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
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
            {selection.kind === 'note' && <div className="editor-event-tools"><button type="button" onClick={() => requestRemoval(selection, 'rest')}>Make rest</button></div>}
          </>}
        </div>
      </section>}
      <div id="playback-controls" className="sidebar-playback" />
      <div className="sidebar-bottom"><div className="small-banjo">♫</div><p>A little practice,<br /><em>every day.</em></p><span>LOCAL WORKSPACE · EARLY PREVIEW</span></div>
    </aside>
    <main>
      <header className="topbar"><span>My library <span className="breadcrumb">/ Practice room</span></span><div className="account-controls">{userEmail() && <span className="account-email">{userEmail()}</span>}<button onClick={() => { void signOut().catch(e => setError(e.message)); }}>Sign out</button><button className="primary" onClick={() => { setImportError(''); dialog.current?.showModal(); }}>＋ Import a tab</button></div></header>
      <div className="workspace">
        <div className="eyebrow">PICK UP WHERE THE MUSIC BEGINS</div>
        <div className="title-row"><h1>{preview?.score.title ?? score.title}</h1><div className="title-actions"><button type="button" className="edit-mode-toggle" aria-pressed={editMode} onClick={toggleEditMode}>{editMode ? 'Done editing' : 'Edit score'}</button><button className="save-button" disabled={saving || !dirty} onClick={save}>{saving ? 'Saving…' : savedId && !dirty ? '✓ Saved' : '＋ Save to library'}</button></div></div>
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
          onSelectionChange={setSelection}
          onFretInput={updateSelectionFret}
          onSelectionDelete={requestRemoval}
          historyRevision={historyRevision}
        />
        <div className="workspace-footer"><span>Made for five strings and a little patience.</span><span>Sound powered by alphaTab · MuseScore General Lite</span></div>
      </div>
    </main>
    <dialog ref={removalDialog} className="removal-dialog" aria-label="Confirm note removal" onCancel={event => { event.preventDefault(); setPendingRemoval(null); }}>
      <h2>Remove connected music?</h2>
      <p>This edit also removes or disconnects:</p>
      <ul>{pendingRemoval?.dependencies.map(dependency => <li key={dependency}>{dependency}</li>)}</ul>
      <div className="removal-dialog-actions">
        <button type="button" data-removal-cancel onClick={() => setPendingRemoval(null)}>Cancel</button>
        <button type="button" onClick={confirmRemoval}>{pendingRemoval?.mode === 'rest' ? 'Make rest' : 'Remove note'}</button>
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
