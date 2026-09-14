import { useEffect, useRef, useState } from 'react';
import { Player } from './Player';
import { ScoreEditor } from './ScoreEditor';
import { demo, isImportedScoreDocument, validateScore, validateStoredScore, type Score } from './music/score';
import { exportAscii, parseAscii } from './music/ascii';
import { readMusicXml, toImportedScoreDocument, type MusicXmlPreview } from './music/musicxml';
import { applyMusicXmlEdits, type MusicXmlEditorState } from './music/musicxml-editor';

type LibraryItem = { id: number; title: string };
const initialText = exportAscii(demo);
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(initialText);
  const [title, setTitle] = useState('My banjo tab');
  const [duration, setDuration] = useState<4 | 8 | 16>(8);
  const [importError, setImportError] = useState('');
  const [reading, setReading] = useState(false);

  useEffect(() => { apiRequest('/api/songs').then(setLibrary).catch(e => setError(e.message)); }, []);
  function load(next: Score, original: string | null, diagnostics: string[] = [], id: number | null = null) {
    setPreview(null);
    setScore(next); setSource(original); setWarnings(diagnostics); setSavedId(id); setDirty(id === null); setMessage(''); setError('');
  }
  function loadPreview(next: MusicXmlPreview, diagnostics: string[] = [], id: number | null = null) {
    setPreview(next); setScore(demo); setSource(null); setWarnings(diagnostics); setSavedId(id); setDirty(id === null); setMessage(''); setError('');
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
      const existing = savedId !== null;
      const item = await apiRequest(existing ? `/api/songs/${savedId}` : '/api/songs', { method: existing ? 'PATCH' : 'POST', body: JSON.stringify({ score: document, source_text: preview ? null : source }) });
      setSavedId(item.id); setDirty(false); setLibrary(items => existing ? items.map(saved => saved.id === item.id ? item : saved) : [item, ...items]); setMessage(existing ? 'Changes saved to your library.' : 'Saved to your library.');
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  function applyNativeEdits(next: Score) {
    setScore(next); setDirty(true); setMessage('Edits applied. Save the score to keep them.'); setError('');
  }
  function applyImportedEdits(edits: MusicXmlEditorState) {
    try {
      const current = preview!;
      const source = applyMusicXmlEdits(current.source, edits);
      const next = readMusicXml(source, current.filename, current.sourceFormat);
      setPreview(next); setDirty(true); setMessage('Edits applied. Save the score to keep them.'); setError('');
    } catch (e) { setError((e as Error).message); }
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
        const converted = await apiRequest(isPdf ? '/api/pdf_imports' : '/api/tef_imports', { method: 'POST', body: form, signal: AbortSignal.timeout(isPdf ? 30000 : 25000) });
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
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Playtab home"><span className="brand-mark">♮</span>playtab<span className="brand-dot">.</span></a>
      <div className="sidebar-section">YOUR WORKSPACE</div>
      <button className="nav-item active" onClick={() => document.getElementById('library-list')?.scrollIntoView()}>▤ <span>My library</span><span className="count">{library.length}</span></button>
      <button className="nav-item" onClick={() => { load(demo, null); }}>♩ <span>Practice demo</span></button>
      <div className="library-heading" id="library-list">SAVED TABS</div>
      {library.length === 0 ? <p className="empty-library">A home for the tunes<br />you’re working on.</p> : <div className="library-list">{library.map(item => <button className={savedId === item.id ? 'current' : ''} key={item.id} onClick={() => openSong(item.id)}>{item.title}</button>)}</div>}
      <div className="sidebar-bottom"><div className="small-banjo">♫</div><p>A little practice,<br /><em>every day.</em></p><span>LOCAL WORKSPACE · EARLY PREVIEW</span></div>
    </aside>
    <main>
      <header className="topbar"><span>My library <span className="breadcrumb">/ Practice room</span></span><button className="primary" onClick={() => { setImportError(''); dialog.current?.showModal(); }}>＋ Import a tab</button></header>
      <div className="workspace">
        <div className="eyebrow">PICK UP WHERE THE MUSIC BEGINS</div>
        <div className="title-row"><div><h1>{preview?.score.title ?? score.title}</h1><p className="subtitle">5-string banjo <span>·</span> {preview ? preview.tuningLabel : 'Open G tuning'} <span>·</span> {preview?.score.masterBars.length ?? score.measures.length} measures</p></div><button className="save-button" disabled={saving || !dirty} onClick={save}>{saving ? 'Saving…' : savedId && !dirty ? '✓ Saved' : savedId ? 'Save changes' : '＋ Save to library'}</button></div>
        {error && <p className="alert" role="alert">{error}</p>}
        {message && <p className="success" role="status">{message}</p>}
        {warnings.length > 0 && <details className="import-notice" open><summary>Check your import</summary>{warnings.map(warning => <p key={warning}>{warning}</p>)}</details>}
        <ScoreEditor score={score} preview={preview} onApplyNative={applyNativeEdits} onApplyImported={applyImportedEdits} />
        <div className="practice-note"><span className="note-icon">✦</span><p><strong>Make it your pace.</strong> Slow down a tricky passage, loop it, and find your rhythm.</p><span className="practice-badge">PRACTICE MODE</span></div>
        <Player key={preview?.id ?? JSON.stringify(score)} score={score} preview={preview} />
        <div className="workspace-footer"><span>Made for five strings and a little patience.</span><span>Sound powered by alphaTab · SONiVOX</span></div>
      </div>
    </main>
    <dialog ref={dialog} className="import-dialog">
      <div className="dialog-heading"><div><div className="eyebrow">BRING YOUR OWN MUSIC</div><h2>Import a tab</h2></div><button className="icon-button" aria-label="Close import" onClick={() => dialog.current?.close()}>×</button></div>
      <p>Open a TEF or vector PDF to convert and play it, or preview uncompressed MusicXML. You can also paste simple five-string tablature below.</p>
      <label className="file-picker">↥ Open a file <input aria-label="Choose tablature file" type="file" accept=".txt,.json,.xml,.musicxml,.tef,.pdf" disabled={reading} onChange={e => { void readFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
      <div className="import-fields"><label>Title<input value={title} maxLength={160} onChange={e => setTitle(e.target.value)} /></label><label>Assume each note is<select value={duration} onChange={e => setDuration(Number(e.target.value) as 4 | 8 | 16)}><option value={4}>A quarter note</option><option value={8}>An eighth note</option><option value={16}>A sixteenth note</option></select></label></div>
      <label className="text-label">Tablature <span>Top to bottom: D · B · G · D · g</span><textarea aria-label="Plaintext tablature" spellCheck={false} value={text} onChange={e => setText(e.target.value)} /></label>
      <p className="import-help">4/4, open G, no capo. Only frets and barlines for now. Fifth-string fret numbers are relative to its own nut. Rhythm is assumed from your choice above; blank spacing does not encode rests.</p>
      {importError && <p className="alert" role="alert">{importError}</p>}
      {reading && <p role="status">Reading and converting your file…</p>}
      <div className="dialog-footer"><span>TEF and vector PDF preview supported.</span><button className="primary" disabled={reading} onClick={importText}>Open in player →</button></div>
    </dialog>
  </div>;
}
