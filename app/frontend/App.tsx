import { useEffect, useRef, useState } from 'react';
import { defaultPlayerPreferences, Player, type PlayerPreferences, type ScoreSelection } from './Player';
import { demo, isImportedScoreDocument, validateScore, validateStoredScore, type Score } from './music/score';
import { exportAscii, parseAscii } from './music/ascii';
import { readMusicXml, toImportedScoreDocument, type MusicXmlPreview } from './music/musicxml';

type LibraryItem = { id: number; title: string };
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
  function load(next: Score, original: string | null, diagnostics: string[] = [], id: number | null = null) {
    setPreview(null);
    setEditMode(false); setLibraryCollapsed(false);
    setSelection(null);
    setScore(next); setSource(original); setWarnings(diagnostics); setShowWarnings(diagnostics.length > 0); setSavedId(id); setDirty(id === null); setMessage(''); setError('');
  }
  function loadPreview(next: MusicXmlPreview, diagnostics: string[] = [], id: number | null = null) {
    setEditMode(false); setLibraryCollapsed(false);
    setSelection(null);
    setPreview(next); setScore(demo); setSource(null); setWarnings(diagnostics); setShowWarnings(diagnostics.length > 0); setSavedId(id); setDirty(id === null); setMessage(''); setError('');
  }
  function toggleEditMode() {
    setEditMode(current => {
      const next = !current;
      setLibraryCollapsed(next);
      return next;
    });
  }
  function updateNativeSelection(selectionToEdit: ScoreSelection, edit: (notes: { string: number; fret: number }[]) => void) {
    if (preview) {
      setError('Imported score editing is not available yet.');
      return false;
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
    edit(nextBeat.notes);
    try { validateScore(next); } catch (error) { setError((error as Error).message); return false; }
    setScore(next);
    setDirty(true);
    setError('');
    return true;
  }
  function updateSelectionFret(selectionToEdit: ScoreSelection, fret: number) {
    if (!Number.isInteger(fret) || fret < 0 || fret > 22) {
      setError('Frets must be whole numbers from 0 to 22.');
      return;
    }
    if (selectionToEdit.string === null) return;
    if (!updateNativeSelection(selectionToEdit, notes => {
      const existing = notes.find(note => note.string === selectionToEdit.string);
      if (existing) existing.fret = fret;
      else notes.push({ string: selectionToEdit.string!, fret });
      notes.sort((left, right) => left.string - right.string);
    })) return;
    setSelection(current => current ? { ...current, kind: 'note', noteId: null, fret } : current);
  }
  function deleteSelection(selectionToDelete: ScoreSelection) {
    if (selectionToDelete.string === null || selectionToDelete.kind !== 'note') return;
    if (!updateNativeSelection(selectionToDelete, notes => {
      const index = notes.findIndex(note => note.string === selectionToDelete.string);
      if (index >= 0) notes.splice(index, 1);
    })) return;
    setSelection(current => current ? { ...current, kind: 'empty', noteId: null, fret: null } : current);
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
    try {
      const document = preview ? toImportedScoreDocument(preview, warnings) : score;
      const item = await apiRequest('/api/songs', { method: 'POST', body: JSON.stringify({ score: document, source_text: preview ? null : source }) });
      setSavedId(item.id); setDirty(false); setLibrary(items => [item, ...items]); setMessage('Saved to your library.');
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
          key={preview?.id ?? 'score'}
          score={score}
          preview={preview}
          preferences={playerPreferences}
          onPreferencesChange={changes => setPlayerPreferences(current => ({ ...current, ...changes }))}
          editing={editMode}
          selection={selection}
          onSelectionChange={setSelection}
          onFretInput={updateSelectionFret}
          onSelectionDelete={deleteSelection}
        />
        <div className="workspace-footer"><span>Made for five strings and a little patience.</span><span>Sound powered by alphaTab · MuseScore General Lite</span></div>
      </div>
    </main>
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
