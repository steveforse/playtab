import { useState } from 'react';
import { musicXmlEditorState, type MusicXmlEditorState, type TechniqueChoice } from './music/musicxml-editor';
import { validateScore, type Score } from './music/score';
import type { MusicXmlPreview } from './music/musicxml';

type Props = {
  score: Score;
  preview: MusicXmlPreview | null;
  onApplyNative: (score: Score) => void;
  onApplyImported: (state: MusicXmlEditorState) => void;
};

const techniqueOptions: [TechniqueChoice, string][] = [
  ['keep', 'Keep source'], ['none', 'No technique'], ['thumb', 'Thumb (T)'],
  ['finger-1', 'Fretting finger 1'], ['finger-2', 'Fretting finger 2'], ['finger-3', 'Fretting finger 3'], ['finger-4', 'Fretting finger 4'],
  ['hammer-on-start', 'Hammer-on start'], ['hammer-on-stop', 'Hammer-on stop'], ['pull-off-start', 'Pull-off start'], ['pull-off-stop', 'Pull-off stop'],
  ['slide', 'Slide'], ['bend', 'Bend'],
];

const nativeCopy = (score: Score): Score => structuredClone(score);

function updateBeat(score: Score, measureIndex: number, beatIndex: number, string: number, value: string) {
  const next = nativeCopy(score);
  const beat = next.measures[measureIndex].beats[beatIndex];
  beat.notes = beat.notes.filter(note => note.string !== string);
  if (value.trim() !== '') {
    const fret = Number(value);
    if (!Number.isInteger(fret) || fret < 0 || fret > 22) throw new Error('Frets must be whole numbers from 0 to 22.');
    beat.notes.push({ string, fret });
    beat.notes.sort((a, b) => a.string - b.string);
  }
  return next;
}

function NativeEditor({ score, onApply }: { score: Score; onApply: (score: Score) => void }) {
  const [draft, setDraft] = useState(nativeCopy(score));
  const [error, setError] = useState('');
  const change = (next: Score) => { setDraft(next); setError(''); };
  const setMeasureCount = (count: number) => {
    const next = nativeCopy(draft);
    if (count < 1 || count > 256) return;
    while (next.measures.length < count) next.measures.push(nativeCopy({ ...next, measures: [next.measures[0]] }).measures[0]);
    next.measures = next.measures.slice(0, count);
    change(next);
  };
  return <div className="editor-panel" aria-label="Score editor">
    <div className="editor-heading"><div><div className="eyebrow">EDIT THIS SCORE</div><h2>Score editor</h2></div><span className="editor-kind">Native score</span></div>
    <p className="editor-help">Change the title, tempo, measures, and note frets. Empty fret fields remove a note from that string and beat.</p>
    <div className="editor-fields">
      <label>Score title<input aria-label="Score title" value={draft.title} maxLength={160} onChange={event => change({ ...draft, title: event.target.value })} /></label>
      <label>Tempo<input aria-label="Score tempo" type="number" min={30} max={240} value={draft.tempo} onChange={event => change({ ...draft, tempo: Number(event.target.value) })} /></label>
      <label>Measures<input aria-label="Measure count" type="number" min={1} max={256} value={draft.measures.length} onChange={event => setMeasureCount(Number(event.target.value))} /></label>
    </div>
    <div className="editor-measures">
      {draft.measures.map((measure, measureIndex) => <details key={measureIndex} open={measureIndex === 0}>
        <summary>Measure {measureIndex + 1} <span>{measure.beats.length} beats</span></summary>
        <div className="editor-beats">
          {measure.beats.map((beat, beatIndex) => <div className="editor-beat" key={beatIndex}><span>Beat {beatIndex + 1}</span>{[1, 2, 3, 4, 5].map(string => {
            const note = beat.notes.find(item => item.string === string);
            return <label key={string}>S{string}<input aria-label={`Measure ${measureIndex + 1} beat ${beatIndex + 1} string ${string} fret`} inputMode="numeric" min={0} max={22} value={note?.fret ?? ''} onChange={event => {
              try { change(updateBeat(draft, measureIndex, beatIndex, string, event.target.value)); } catch (e) { setError((e as Error).message); }
            }} /></label>;
          })}</div>)}
        </div>
      </details>)}
    </div>
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="editor-footer"><span>Open G is the native score tuning.</span><button className="primary" onClick={() => { try { validateScore(draft); onApply(draft); } catch (e) { setError((e as Error).message); } }}>Apply edits</button></div>
  </div>;
}

function updateImported(state: MusicXmlEditorState, update: Partial<MusicXmlEditorState>): MusicXmlEditorState {
  return { ...state, ...update };
}

function ImportedEditor({ preview, onApply }: { preview: MusicXmlPreview; onApply: (state: MusicXmlEditorState) => void }) {
  const [draft, setDraft] = useState(() => musicXmlEditorState(preview.source, preview.score));
  const [error, setError] = useState('');
  const change = (next: MusicXmlEditorState) => { setDraft(next); setError(''); };
  const updateNote = (index: number, update: Partial<MusicXmlEditorState['notes'][number]>) => change({ ...draft, notes: draft.notes.map(note => note.index === index ? { ...note, ...update } : note) });
  const groups = [...new Set(draft.notes.map(note => note.measure))];
  return <div className="editor-panel" aria-label="Score editor">
    <div className="editor-heading"><div><div className="eyebrow">EDIT THIS IMPORT</div><h2>Score editor</h2></div><span className="editor-kind">Source-preserving MusicXML</span></div>
    <p className="editor-help">Edits are written back into the imported MusicXML. Untouched source techniques, chords, sections, annotations, and lyrics stay with the score.</p>
    <div className="editor-fields">
      <label>Score title<input aria-label="Score title" value={draft.title} maxLength={160} onChange={event => change(updateImported(draft, { title: event.target.value }))} /></label>
      <label>Tempo<input aria-label="Score tempo" type="number" min={30} max={240} value={draft.tempo} onChange={event => change(updateImported(draft, { tempo: Number(event.target.value) }))} /></label>
      <label>Measures<input aria-label="Measure count" type="number" min={1} max={256} value={draft.measureCount} onChange={event => change(updateImported(draft, { measureCount: Number(event.target.value) }))} /></label>
    </div>
    <fieldset className="editor-fieldset"><legend>Tuning (MIDI pitch)</legend><div className="editor-tuning">{draft.tuning.map((pitch, index) => <label key={index}>String {index + 1}<input aria-label={`Tuning string ${index + 1}`} type="number" min={36} max={96} value={pitch} onChange={event => change(updateImported(draft, { tuning: draft.tuning.map((item, i) => i === index ? Number(event.target.value) : item) }))} /></label>)}</div></fieldset>
    <div className="editor-text-fields">
      <label>Lyrics and chords section<textarea aria-label="Lyrics and chords" value={draft.lyricsSection} onChange={event => change(updateImported(draft, { lyricsSection: event.target.value }))} /></label>
      <label>Sections and annotations<textarea aria-label="Sections and annotations" value={draft.annotations.join('\n')} onChange={event => change(updateImported(draft, { annotations: event.target.value.split('\n').filter(Boolean) }))} /></label>
      <label>Chord names<textarea aria-label="Chord names" value={draft.chords.join('\n')} onChange={event => change(updateImported(draft, { chords: event.target.value.split('\n').filter(Boolean) }))} /></label>
    </div>
    <div className="editor-notes"><h3>Notes and techniques</h3>{groups.map(measure => <details key={measure} open={measure === 0}>
      <summary>Measure {measure + 1} <span>{draft.notes.filter(note => note.measure === measure).length} notes</span></summary>
      <div className="editor-note-list">{draft.notes.filter(note => note.measure === measure).map(note => <div className="editor-note" key={note.index}><span>Beat {note.beat + 1}</span><label>String<input aria-label={`Imported note ${note.index} string`} type="number" min={1} max={5} value={note.string} onChange={event => updateNote(note.index, { string: Number(event.target.value) })} /></label><label>Fret<input aria-label={`Imported note ${note.index} fret`} type="number" min={0} max={22} value={note.fret} onChange={event => updateNote(note.index, { fret: Number(event.target.value) })} /></label><label>Technique<select aria-label={`Imported note ${note.index} technique`} value={note.technique} onChange={event => updateNote(note.index, { technique: event.target.value as TechniqueChoice })}>{techniqueOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>)}</div>
    </details>)}</div>
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="editor-footer"><span>Changing a technique requires a valid start/stop pair for H and PO.</span><button className="primary" onClick={() => { try { onApply(draft); } catch (e) { setError((e as Error).message); } }}>Apply edits</button></div>
  </div>;
}

export function ScoreEditor({ score, preview, onApplyNative, onApplyImported }: Props) {
  return preview ? <ImportedEditor key={preview.id} preview={preview} onApply={onApplyImported} /> : <NativeEditor key={JSON.stringify(score)} score={score} onApply={onApplyNative} />;
}
