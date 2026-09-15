import { useEffect, useRef, useState } from 'react';
import { AlphaTabApi, PlayerOutputMode } from '@coderline/alphatab';
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

export function Player({ score, preview }: { score: Score; preview?: MusicXmlPreview | null }) {
  const element = useRef<HTMLDivElement>(null);
  const scorePaper = useRef<HTMLElement>(null);
  const lyricsSection = useRef<HTMLElement>(null);
  const api = useRef<AlphaTabApi | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [position, setPosition] = useState({ currentTime: 0, endTime: 0 });
  const [rendered, setRendered] = useState(false);
  const [barsPerRow, setBarsPerRow] = useState(2);
  const [lyricsColumns, setLyricsColumns] = useState(1);
  const [showChordDiagrams, setShowChordDiagrams] = useState(false);
  const [soundFontId, setSoundFontId] = useState(availableSoundFonts[0]?.id || 'musescore-general-lite');
  const soundFont = availableSoundFonts.find(option => option.id === soundFontId) ?? availableSoundFonts[0];
  useEffect(() => {
    setReady(false); setPlaying(false); setRendered(false); setError(''); setExportNotice('');
    setSpeed(1); setLoop(false); setMetronome(false); setPosition({ currentTime: 0, endTime: 0 });
    const base = '/notation/';
    const instance = new AlphaTabApi(element.current!, {
      core: { fontDirectory: `${base}font/`, useWorkers: !preview, enableLazyLoading: !preview },
      display: { scale: 1.1, barsPerRow },
      player: {
        enablePlayer: true, soundFont: `${base}soundfont/${soundFont.filename}`,
        // alphaTab's AudioWorklet output now passes the start/pause smoke
        // tests and avoids the legacy ScriptProcessor scheduling path.
        outputMode: PlayerOutputMode.WebAudioAudioWorklets,
        enableCursor: true, enableUserInteraction: true, scrollElement: 'html',
      },
    });
    api.current = instance;
    instance.playerReady.on(() => setReady(true));
    instance.playerStateChanged.on(event => setPlaying(event.state === 1));
    instance.playerPositionChanged.on(event => setPosition({ currentTime: event.currentTime, endTime: event.endTime }));
    instance.renderFinished.on(() => setRendered(true));
    instance.error.on(error => setError(error.message || 'Notation or audio could not load.'));
    if (preview) configureChordDiagrams(preview.score, showChordDiagrams);
    instance.renderScore(preview ? preview.score : toAlphaTab(score));
    return () => { instance.destroy(); api.current = null; };
  }, [score, preview, barsPerRow, showChordDiagrams, soundFont]);
  const transport = { ready, playing, ...position, onRestart: () => api.current?.stop(), onPlayPause: () => api.current?.playPause() };
  function printPreviewWithLyrics() {
    const paper = scorePaper.current!;
    const lyrics = lyricsSection.current!;
    const popup = window.open('', '_blank', 'width=1200,height=900');
    if (!popup) throw new Error('The print preview window was blocked by the browser.');

    const printablePaper = paper.cloneNode(true) as HTMLElement;
    printablePaper.querySelectorAll('.at-cursors').forEach(node => node.remove());
    const styles = Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'))
      .map(node => node.outerHTML).join('');
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Playtab</title>${styles}<style>
      body { margin: 0; background: white; }
      .print-root { width: 210mm; max-width: 100%; margin: 0 auto; }
      .score-paper, .lyrics-section { box-shadow: none; border-radius: 0; }
      .score-paper { border: 0; }
      .lyrics-section { break-before: page; page-break-before: always; margin-top: 0; }
      @page { margin: 12mm; }
    </style></head><body><main class="print-root">${printablePaper.outerHTML}${lyrics.outerHTML}</main></body></html>`);
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
        else api.current?.print(undefined, preview ? { core: { useWorkers: false } } : undefined);
      }
    } catch (e) { setError((e as Error).message); }
  }
  return <>
    <div className="player player-top"><PlaybackTransport {...transport} top /></div>
    <div className="score-toolbar">
      <div className="segmented"><span className="selected">Tablature</span><span className="muted">5 strings</span></div>
      <div className="score-toolbar-actions">
        <div className="layout-controls" aria-label="Layout settings">
          <label>Measures / line <select aria-label="Measures per line" value={barsPerRow} onChange={e => setBarsPerRow(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
          {preview?.lyricsSection && <label>Lyrics columns <select aria-label="Lyrics columns" value={lyricsColumns} onChange={e => setLyricsColumns(Number(e.target.value))}>
            {[1, 2, 3].map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>}
          {availableSoundFonts.length > 1 && <label>Sound bank <select aria-label="Sound bank" value={soundFont.id} onChange={e => setSoundFontId(e.target.value)}>
            {availableSoundFonts.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select></label>}
          {(preview?.chordDiagrams?.length ?? 0) > 0 && <label className="layout-checkbox"><input aria-label="Show chord diagrams" type="checkbox" checked={showChordDiagrams} onChange={e => setShowChordDiagrams(e.target.checked)} /> Chord diagrams</label>}
        </div>
        <label className="export-label">Export <select aria-label="Export score" value="" disabled={!rendered} onChange={e => exportFile(e.target.value)}>
          <option value="" disabled>Choose format ↗</option><option value="pdf">Print / save PDF</option><option value="midi">MIDI (.mid)</option><option value="tef2">TEF2 (.tef)</option><option value="tef3">TablEdit TEF3 (.tef)</option>{preview ? <option value="musicxml">Original MusicXML</option> : <><option value="txt">Plaintext (.txt)</option><option value="json">Playtab (.json)</option></>}
        </select></label>
      </div>
    </div>
    {error && <p className="alert" role="alert">{error}</p>}
    {exportNotice && <p className="success export-notice" role="status">{exportNotice}</p>}
    <section ref={scorePaper} className="score-paper" aria-label="Banjo tablature">
      <div className="paper-topline"><span>PLAYTAB / {preview ? 'IMPORT PREVIEW' : 'PRACTICE SERIES'}</span><span>{preview ? preview.tuningLabel : 'OPEN G · 4/4'}</span></div>
      {!rendered && <p className="loading">Setting out your music…</p>}
      <div ref={element} data-testid="notation" />
      <div className="paper-footer">Take it slowly. Let every note ring.</div>
    </section>
    {preview?.lyricsSection && <section ref={lyricsSection} className="lyrics-section" aria-label="Lyrics and chords">
      <h2>Lyrics &amp; chords</h2>
      <pre style={{ columnCount: lyricsColumns }}>{preview.lyricsSection}</pre>
    </section>}
    <div className="player">
      <PlaybackTransport {...transport} />
      <label className="speed-control">{Math.round((preview?.score.tempo ?? score.tempo) * speed)} <span>BPM</span><input aria-label="Playback speed" type="range" min="0.25" max="1.5" step="0.05" value={speed} onChange={e => { const value = Number(e.target.value); setSpeed(value); if (api.current) api.current.playbackSpeed = value; }} /><small>{Math.round(speed * 100)}%</small></label>
      <div className="player-toggles">
        <button aria-pressed={loop} onClick={() => { setLoop(!loop); if (api.current) api.current.isLooping = !loop; }}>↻ Loop</button>
        <button aria-pressed={metronome} onClick={() => { setMetronome(!metronome); if (api.current) api.current.metronomeVolume = !metronome ? 0.6 : 0; }}>♩ Click</button>
      </div>
    </div>
    <p className="player-hint">Click a note to seek. Drag across notes to select a practice range, then turn on Loop.</p>
    {preview && <p className="player-hint">Audio preview: imported hammer-ons and pull-offs use held-note articulation; slides and bends retain their pitch movement.</p>}
  </>;
}
