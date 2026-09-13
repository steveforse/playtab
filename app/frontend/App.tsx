import { useEffect, useRef, useState } from 'react';
import { Player } from './Player';
import { demo, validateScore, type Score } from './music/score';
import { exportAscii, parseAscii } from './music/ascii';
import { readMusicXml, type MusicXmlPreview } from './music/musicxml';

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
    setScore(next); setSource(original); setWarnings(diagnostics); setSavedId(id); setMessage(''); setError('');
  }
  async function openSong(id: number) {
    try {
      const song = await apiRequest(`/api/songs/${id}`);
      validateScore(song.score);
      load(song.score, song.source_text, song.source_text ? ['Imported from plaintext using equal-note rhythm. Original text is preserved with this score.'] : [], id);
    } catch (e) { setError((e as Error).message); }
  }
  async function save() {
    if (preview) return;
    setSaving(true); setError('');
    try {
      const item = await apiRequest('/api/songs', { method: 'POST', body: JSON.stringify({ score, source_text: source }) });
      setSavedId(item.id); setLibrary(items => [item, ...items]); setMessage('Saved to your library.');
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  async function readFile(file?: File) {
    if (!file) return;
    setImportError('');
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'pdf') {
      setImportError('PDF recognition is not available in this build. Paste the original text tablature if you have it.');
      return;
    }
    const isXml = extension === 'xml' || extension === 'musicxml';
    const isTef = extension === 'tef';
    if (!['txt', 'json', 'xml', 'musicxml', 'tef'].includes(extension ?? '')) { setImportError('Choose a .tef, .txt, Playtab .json, or .musicxml file.'); return; }
    if (file.size > (isXml ? 2_000_000 : 100_000)) { setImportError(isXml ? 'Choose MusicXML smaller than 2 MB.' : 'Choose a file smaller than 100 KB.'); return; }
    setReading(true);
    try {
      let contents: string;
      let conversionWarnings: string[] = [];
      if (isTef) {
        const form = new FormData();
        form.append('file', file);
        const converted = await apiRequest('/api/tef_imports', { method: 'POST', body: form, signal: AbortSignal.timeout(25000) });
        contents = converted.musicxml;
        conversionWarnings = converted.warnings;
      } else contents = await file.text();
      if (isXml || isTef) {
        setPreview(readMusicXml(contents, isTef ? file.name.replace(/\.tef$/i, '.musicxml') : file.name));
        setSavedId(null); setMessage(''); setError('');
        setWarnings(['MusicXML preview: tuning and rhythm come from the file. Conversion may omit techniques, text, or other source details; compare with the original TEF.', 'Preview is not saved to your library. Download the original MusicXML to keep it.']);
        if (isTef) setWarnings(conversionWarnings);
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
        <div className="title-row"><div><h1>{preview?.score.title ?? score.title}</h1><p className="subtitle">5-string banjo <span>·</span> {preview ? preview.tuningLabel : 'Open G tuning'} <span>·</span> {preview?.score.masterBars.length ?? score.measures.length} measures</p></div><button className="save-button" disabled={saving || savedId !== null || !!preview} onClick={save}>{preview ? 'Preview only' : savedId ? '✓ Saved' : saving ? 'Saving…' : '＋ Save to library'}</button></div>
        {error && <p className="alert" role="alert">{error}</p>}
        {message && <p className="success" role="status">{message}</p>}
        {warnings.length > 0 && <details className="import-notice" open><summary>Check your import</summary>{warnings.map(warning => <p key={warning}>{warning}</p>)}</details>}
        <div className="practice-note"><span className="note-icon">✦</span><p><strong>Make it your pace.</strong> Slow down a tricky passage, loop it, and find your rhythm.</p><span className="practice-badge">PRACTICE MODE</span></div>
        <Player key={preview?.id ?? JSON.stringify(score)} score={score} preview={preview} />
        <div className="workspace-footer"><span>Made for five strings and a little patience.</span><span>Sound powered by alphaTab · SONiVOX</span></div>
      </div>
    </main>
    <dialog ref={dialog} className="import-dialog">
      <div className="dialog-heading"><div><div className="eyebrow">BRING YOUR OWN MUSIC</div><h2>Import a tab</h2></div><button className="icon-button" aria-label="Close import" onClick={() => dialog.current?.close()}>×</button></div>
      <p>Open a TEF file to convert and play it, or preview uncompressed MusicXML. You can also paste simple five-string tablature below.</p>
      <label className="file-picker">↥ Open a file <input aria-label="Choose tablature file" type="file" accept=".txt,.json,.xml,.musicxml,.tef,.pdf" disabled={reading} onChange={e => { void readFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
      <div className="import-fields"><label>Title<input value={title} maxLength={160} onChange={e => setTitle(e.target.value)} /></label><label>Assume each note is<select value={duration} onChange={e => setDuration(Number(e.target.value) as 4 | 8 | 16)}><option value={4}>A quarter note</option><option value={8}>An eighth note</option><option value={16}>A sixteenth note</option></select></label></div>
      <label className="text-label">Tablature <span>Top to bottom: D · B · G · D · g</span><textarea aria-label="Plaintext tablature" spellCheck={false} value={text} onChange={e => setText(e.target.value)} /></label>
      <p className="import-help">4/4, open G, no capo. Only frets and barlines for now. Fifth-string fret numbers are relative to its own nut. Rhythm is assumed from your choice above; blank spacing does not encode rests.</p>
      {importError && <p className="alert" role="alert">{importError}</p>}
      {reading && <p role="status">Reading and converting your file…</p>}
      <div className="dialog-footer"><span>TEF2 preview supported · PDF import coming later.</span><button className="primary" disabled={reading} onClick={importText}>Open in player →</button></div>
    </dialog>
  </div>;
}
