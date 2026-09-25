import { useEffect, useState, type RefObject } from 'react';
import type { MusicXmlPreview } from '../../music/musicxml';
import { ANCHOR_TEXT_LIMIT, applyMusicXmlScoreSettings, TEMPO_LIMITS, TUNING_LIMITS, type ScoreSettingsInfo, type TuningMode } from '../../music/musicxml-editor';
import { midiName } from '../labels';
import { useModalDialog } from '../useModalDialog';

export type SettingsDraft = { title: string; tempo: string; tuning: string[]; mode: TuningMode };
type Candidate = { source: string; tuningRange: { first: number; last: number } };

// Title, opening tempo and tuning as one transaction. The candidate is
// computed live so invalid input disables Apply; onApply returns an error.
export function SettingsDialog({ target, onApply, onClose, returnFocus }: {
  target: { base: MusicXmlPreview; info: ScoreSettingsInfo } | null; onApply: (candidate: Candidate, draft: SettingsDraft) => string | null;
  onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(target !== null, returnFocus);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({ title: '', tempo: '', tuning: [], mode: 'frets' });
  const [settingsError, setSettingsError] = useState('');
  useEffect(() => {
    if (target) { setSettingsDraft({ title: target.base.score.title, tempo: String(target.info.tempo), tuning: target.info.tuning.map(String), mode: 'frets' }); setSettingsError(''); }
  }, [target]);
  const apply = (candidate: Candidate) => setSettingsError(onApply(candidate, settingsDraft) ?? '');
  return (
  <dialog ref={ref} className="duplicate-dialog settings-dialog" aria-label="Score settings" onCancel={event => { event.preventDefault(); onClose(); }}>
    {target && (() => {
      const { base, info } = target;
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
        <label className="anchor-text">Title<input aria-label="Title" data-dialog-first="" maxLength={ANCHOR_TEXT_LIMIT} value={settingsDraft.title}
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
          <button type="button" onClick={() => onClose()}>Cancel</button>
          <button type="button" disabled={!candidate} onClick={() => { if (candidate) apply(candidate); }}>Apply settings</button>
        </div>
      </>;
    })()}
  </dialog>
  );
}
