import { useEffect, useState, type RefObject } from 'react';
import { ANCHOR_TEXT_LIMIT, chordSpellingName, type AnchorItem, type AnchorKind, type ChordQuality, type ChordRoot, type ChordSpelling } from '../../music/musicxml-editor';
import { ANCHOR_NAMES, CHORD_QUALITIES, CHORD_STEPS, DEFAULT_CHORD } from '../labels';
import { useModalDialog } from '../useModalDialog';

export type AnchorDialogTarget = { kind: AnchorKind; items: AnchorItem[]; selection: { measure: number; beat: number } };

// Chord name, section label or annotation anchored at the selection. The
// user picks an existing item or Add new; onApply returns an error or null.
export function AnchorDialog({ target: target_, onApply, onClose, returnFocus }: {
  target: AnchorDialogTarget | null; onApply: (choice: number | 'new', value: ChordSpelling | string | null) => string | null;
  onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(target_ !== null, returnFocus);
  const [anchorChoice, setAnchorChoice] = useState<number | 'new'>('new');
  const [anchorText, setAnchorText] = useState('');
  const [anchorChord, setAnchorChord] = useState<ChordSpelling>(DEFAULT_CHORD);
  const [anchorError, setAnchorError] = useState('');
  function chooseAnchorItem(choice: number | 'new', items: AnchorItem[]) {
    setAnchorChoice(choice); setAnchorError('');
    const item = choice === 'new' ? undefined : items[choice];
    setAnchorText(item?.text ?? '');
    setAnchorChord(item?.chord ?? DEFAULT_CHORD);
  }
  useEffect(() => { if (target_) chooseAnchorItem(target_.items.length ? 0 : 'new', target_.items); }, [target_]);
  const apply = (remove: boolean) => setAnchorError(onApply(anchorChoice, remove ? null : target_?.kind === 'chord' ? anchorChord : anchorText) ?? '');
  return (
  <dialog ref={ref} className="duplicate-dialog anchor-dialog" aria-label={target_ ? ANCHOR_NAMES[target_.kind].title : 'Text'}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    {target_ && (() => {
      const { kind, items, selection: target } = target_;
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
        <p>{kind === 'section' ? `Anchored at the start of measure ${target.measure}.` : `Anchored at measure ${target.measure}, beat ${target.beat}.`}</p>
        {items.length > 0 && <label className="anchor-choice">Item<select aria-label="Existing item" data-dialog-first="" value={anchorChoice}
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
        </div> : <label className="anchor-text">Text<input aria-label="Text" data-dialog-first={items.length ? undefined : ''} maxLength={ANCHOR_TEXT_LIMIT} value={anchorText}
          onChange={event => { setAnchorError(''); setAnchorText(event.target.value); }} /></label>}
        {anchorError && <p className="alert" role="alert">{anchorError}</p>}
        <div className="duplicate-dialog-actions">
          <button type="button" data-dialog-first={kind === 'chord' && !items.length ? '' : undefined} onClick={() => onClose()}>Cancel</button>
          {current && <button type="button" onClick={() => apply(true)}>Remove {name}</button>}
          <button type="button" disabled={kind !== 'chord' && (!anchorText.trim() || anchorText.trim().length > ANCHOR_TEXT_LIMIT)}
            onClick={() => apply(false)}>{current?.reason ? `Replace ${name}` : `Apply ${name}`}</button>
        </div>
      </>;
    })()}
  </dialog>
  );
}
