import { useEffect, useState, type RefObject } from 'react';
import type { MusicXmlPreview } from '../../music/musicxml';
import { ANCHOR_TEXT_LIMIT, applyMusicXmlScoreSettings, CAPO_LIMIT, defaultFifthCapo, TEMPO_LIMITS,
  type Feel, type ScoreSettingsInfo, type TuningMode } from '../../music/musicxml-editor';
import { TuningPicker } from '../TuningPicker';
import { useModalDialog } from '../useModalDialog';

export type SettingsDraft = { title: string; subtitle: string; composer: string; arranger: string; tempo: string; feel: Feel; keyFifths: number;
  tuning: number[]; mode: TuningMode; capo: number; fifthCapo: number | null };
type Candidate = { source: string; tuningRange: { first: number; last: number } };

const KEYS = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];
const MAJOR = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
const MINOR = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];
const keyName = (fifths: number) => `${MAJOR[fifths + 7]} major / ${MINOR[fifths + 7]} minor`;

// Title, credits, tempo, feel, key, tuning and capo as one transaction. The
// candidate is computed live so invalid input disables Apply; onApply
// returns an error.
export function SettingsDialog({ target, onApply, onClose, returnFocus }: {
  target: { base: MusicXmlPreview; info: ScoreSettingsInfo } | null; onApply: (candidate: Candidate, draft: SettingsDraft) => string | null;
  onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(target !== null, returnFocus);
  const [draft, setDraft] = useState<SettingsDraft>({ title: '', subtitle: '', composer: '', arranger: '', tempo: '', feel: 'straight', keyFifths: 0,
    tuning: [], mode: 'frets', capo: 0, fifthCapo: null });
  const [settingsError, setSettingsError] = useState('');
  useEffect(() => {
    if (!target) return;
    const { info } = target;
    setDraft({ title: target.base.score.title, subtitle: info.subtitle, composer: info.composer, arranger: info.arranger, tempo: String(info.tempo),
      feel: info.feel, keyFifths: info.keyFifths, tuning: [...info.tuning], mode: 'frets', capo: info.capo, fifthCapo: info.fifthCapo });
    setSettingsError('');
  }, [target]);
  const update = (changes: Partial<SettingsDraft>) => { setSettingsError(''); setDraft(current => ({ ...current, ...changes })); };
  const apply = (candidate: Candidate) => setSettingsError(onApply(candidate, draft) ?? '');
  const text = (field: 'title' | 'subtitle' | 'composer' | 'arranger', label: string, first = false) =>
    <label className="anchor-text">{label}<input aria-label={label} data-dialog-first={first ? '' : undefined} maxLength={ANCHOR_TEXT_LIMIT} value={draft[field]}
      onChange={event => update({ [field]: event.target.value })} /></label>;
  return (
  <dialog ref={ref} className="duplicate-dialog settings-dialog" aria-label="Score settings" onCancel={event => { event.preventDefault(); onClose(); }}>
    {target && (() => {
      const { base, info } = target;
      const tuningChanged = draft.tuning.some((value, index) => value !== info.tuning[index]);
      let candidate: Candidate | null = null;
      let problem = '';
      try {
        candidate = applyMusicXmlScoreSettings(base.source, base.score, { title: draft.title, tempo: Number(draft.tempo), tuning: draft.tuning, mode: draft.mode,
          subtitle: draft.subtitle, composer: draft.composer, arranger: draft.arranger, feel: draft.feel, keyFifths: draft.keyFifths,
          capo: draft.capo, fifthCapo: draft.fifthCapo });
      } catch (failure) { problem = (failure as Error).message; }
      const last = info.tuningRange.last;
      const measures = base.score.masterBars.length;
      const first = base.score.masterBars[0];
      return <>
        <h2>Score settings</h2>
        <fieldset className="settings-section settings-credits"><legend>Score</legend>
          {text('title', 'Title', true)}
          {text('subtitle', 'Subtitle')}
          {text('composer', 'Composer')}
          {text('arranger', 'Arranger')}
        </fieldset>
        <fieldset className="settings-section settings-timing"><legend>Timing</legend>
          <label className="anchor-text">Opening tempo (BPM)<input aria-label="Opening tempo" type="number" inputMode="numeric" min={TEMPO_LIMITS.min} max={TEMPO_LIMITS.max}
            value={draft.tempo} onChange={event => update({ tempo: event.target.value })} /></label>
          <label className="anchor-text">Feel<select aria-label="Feel" value={draft.feel} onChange={event => update({ feel: event.target.value as Feel })}>
            <option value="straight">Straight eighths</option>
            <option value="swing">Swung eighths (2:1)</option>
            <option value="dotted">Dotted eighths (3:1)</option>
          </select></label>
          <label className="anchor-text">Key signature<select aria-label="Key signature" value={draft.keyFifths} onChange={event => update({ keyFifths: Number(event.target.value) })}>
            {KEYS.map(fifths => <option key={fifths} value={fifths}>{keyName(fifths)}</option>)}
          </select></label>
          <p className="settings-readout"><span>Time signature</span><strong>{first ? `${first.timeSignatureNumerator}/${first.timeSignatureDenominator}` : '—'}</strong>
            <small>Change it from Measure ▸ Time signature…</small></p>
        </fieldset>
        <fieldset className="settings-section settings-tuning"><legend>Tuning</legend>
          <TuningPicker tuning={draft.tuning} onChange={tuning => update({ tuning })} />
          <div className="settings-mode" role="radiogroup" aria-label="When tuning changes">
            <label><input type="radio" name="tuning-mode" checked={draft.mode === 'frets'} onChange={() => update({ mode: 'frets' })} />Keep frets (pitches change)</label>
            <label><input type="radio" name="tuning-mode" checked={draft.mode === 'pitches'} onChange={() => update({ mode: 'pitches' })} />Keep pitches (frets change)</label>
          </div>
          <p className="editor-rhythm-reason">{tuningChanged ? 'Tuning applies to' : 'A tuning change would apply to'} measures 1–{last}{last < measures ? `; measure ${last + 1} changes tuning again and is not affected` : ''}.</p>
        </fieldset>
        <fieldset className="settings-section settings-capo"><legend>Capo</legend>
          <label className="anchor-text">Capo<select aria-label="Capo" value={draft.capo}
            onChange={event => { const capo = Number(event.target.value); update({ capo, fifthCapo: defaultFifthCapo(capo) }); }}>
            <option value={0}>None</option>
            {Array.from({ length: CAPO_LIMIT }, (_, index) => index + 1).map(fret => <option key={fret} value={fret}>Fret {fret}</option>)}
          </select></label>
          <label className="anchor-text">5th-string capo<select aria-label="5th-string capo" value={draft.fifthCapo ?? ''}
            onChange={event => update({ fifthCapo: event.target.value ? Number(event.target.value) : null })}>
            <option value="">None</option>
            {Array.from({ length: 12 }, (_, index) => index + 6).map(fret => <option key={fret} value={fret}>Fret {fret}</option>)}
          </select></label>
          <p className="editor-rhythm-reason">Frets are written relative to the capo; playback sounds at the capoed pitch. Changing the capo moves the 5th-string capo to match (capo + 5); set it separately for other spikes.</p>
        </fieldset>
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
