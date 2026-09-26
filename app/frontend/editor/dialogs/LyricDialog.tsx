import { useEffect, useState, type RefObject } from 'react';
import { ANCHOR_TEXT_LIMIT, LYRIC_VERSES, type BeatLyric, type LyricSyllabic } from '../../music/musicxml-editor';
import { useModalDialog } from '../useModalDialog';

export type LyricDialogTarget = { selection: { measure: number; beat: number }; lyrics: BeatLyric[] };
type Draft = { verse: number; text: string; syllabic: LyricSyllabic };

// One verse of a timed lyric on one beat. onApply returns an error or null.
export function LyricDialog({ target, onApply, onClose, returnFocus }: {
  target: LyricDialogTarget | null; onApply: (verse: number, value: { text: string; syllabic: LyricSyllabic } | null) => string | null;
  onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(target !== null, returnFocus);
  const [lyricDraft, setLyricDraft] = useState<Draft>({ verse: 1, text: '', syllabic: 'single' });
  const [lyricError, setLyricError] = useState('');
  function chooseLyricVerse(verse: number, lyrics: BeatLyric[]) {
    const current = lyrics.find(lyric => lyric.verse === verse);
    setLyricError('');
    setLyricDraft({ verse, text: current?.text ?? '', syllabic: current?.syllabic ?? 'single' });
  }
  useEffect(() => { if (target) chooseLyricVerse(target.lyrics.find(lyric => lyric.verse > 0)?.verse ?? 1, target.lyrics); }, [target]);
  const apply = (remove: boolean) => setLyricError(onApply(lyricDraft.verse, remove ? null : { text: lyricDraft.text, syllabic: lyricDraft.syllabic }) ?? '');
  return (
  <dialog ref={ref} className="duplicate-dialog anchor-dialog" aria-label="Lyric syllable" onCancel={event => { event.preventDefault(); onClose(); }}>
    {target && (() => {
      const current = target.lyrics.find(lyric => lyric.verse === lyricDraft.verse);
      const kept = target.lyrics.filter(lyric => lyric.verse === 0);
      return <>
        <h2>Lyric syllable</h2>
        <p>Measure {target.selection.measure}, beat {target.selection.beat}. Other verses and the Lyrics &amp; chords text are not changed.</p>
        <div className="insert-dialog-fields">
          <label>Verse<select aria-label="Verse" data-dialog-first="" value={lyricDraft.verse} onChange={event => chooseLyricVerse(Number(event.target.value), target.lyrics)}>
            {Array.from({ length: LYRIC_VERSES }, (_, index) => index + 1).map(verse => <option key={verse} value={verse}>
              {verse}{target.lyrics.some(lyric => lyric.verse === verse) ? ' •' : ''}</option>)}</select></label>
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
          <button type="button" onClick={() => onClose()}>Cancel</button>
          {current && <button type="button" onClick={() => apply(true)}>Remove lyric</button>}
          <button type="button" disabled={!lyricDraft.text.trim() || Boolean(current?.reason)} onClick={() => apply(false)}>Apply lyric</button>
        </div>
      </>;
    })()}
  </dialog>
  );
}
