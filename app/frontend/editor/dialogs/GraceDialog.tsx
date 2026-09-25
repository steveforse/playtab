import { useEffect, useState, type RefObject } from 'react';
import type { MusicXmlPreview } from '../../music/musicxml';
import { applyMusicXmlGraceGroup, type GraceEventSpec, type GraceTransition } from '../../music/musicxml-editor';
import { useModalDialog } from '../useModalDialog';

export type GraceDialogTarget = { base: MusicXmlPreview; selection: { measure: number; voice: number }; destination: number;
  existing: boolean; readOnly: string[]; connections: string[]; initialEvents: GraceEventSpec[] };

// Add or edit the grace group before an event. The rewritten source is
// previewed live; onApply and onRemove return an error or null.
export function GraceDialog({ target, onApply, onRemove, onClose, returnFocus }: {
  target: GraceDialogTarget | null; onApply: (candidate: string, events: GraceEventSpec[]) => string | null; onRemove: () => string | null;
  onClose: () => void; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useModalDialog(target !== null, returnFocus);
  const [graceEvents, setGraceEvents] = useState<GraceEventSpec[]>([]);
  const [graceError, setGraceError] = useState('');
  useEffect(() => { if (target) { setGraceEvents(target.initialEvents); setGraceError(''); } }, [target]);
  function updateGraceEvent(eventIndex: number, change: (event: GraceEventSpec) => GraceEventSpec) {
    setGraceError('');
    setGraceEvents(current => current.map((event, index) => index === eventIndex ? change(event) : event));
  }
  const gracePreview = (() => {
    if (!target || target.readOnly.length) return null;
    try {
      return { candidate: applyMusicXmlGraceGroup(target.base.source, target.base.score,
        { measure: target.selection.measure - 1, beat: target.destination, voice: target.selection.voice - 1 }, graceEvents), error: '' };
    } catch (failure) { return { candidate: null, error: (failure as Error).message }; }
  })();
  return (
  <dialog ref={ref} className="duplicate-dialog grace-dialog" aria-label={target?.existing ? 'Edit grace group' : 'Add grace group'}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2>{target?.existing ? 'Edit grace group' : 'Add grace group'}</h2>
    <p>Destination: measure {target?.selection.measure}, event {(target?.destination ?? 0) + 1}. Grace notes play before it without using measure time.</p>
    {!target ? null : target.readOnly.length ? <div className="grace-read-only" role="note">
      <p>This imported grace group is read-only, so Playtab keeps it exactly as written:</p>
      <ul>{target.readOnly.map(reason => <li key={reason}>{reason}</li>)}</ul>
      <p>Cancel keeps it unchanged. Remove grace group deletes the whole group{target.connections.length ? ` and disconnects its ${target.connections.join(', ')}` : ''}.</p>
    </div> : <>
      {graceEvents.map((event, eventIndex) => <fieldset key={eventIndex} className="grace-event">
        <legend>Grace event {eventIndex + 1}</legend>
        <label>Display duration<select aria-label={`Grace event ${eventIndex + 1} display duration`} data-dialog-first={eventIndex === 0 ? '' : undefined}
          value={event.denominator ?? ''} onChange={change => updateGraceEvent(eventIndex, current => ({ ...current,
            denominator: change.target.value ? Number(change.target.value) as 8 | 16 : null }))}>
          {event.denominator === null && <option value="">Source default</option>}
          <option value={8}>1/8</option><option value={16}>1/16</option></select></label>
        {event.notes.map((note, noteIndex) => <div key={noteIndex} className="grace-note-row">
          <label>String<select aria-label={`Grace event ${eventIndex + 1} string ${noteIndex + 1}`} value={note.string}
            onChange={change => updateGraceEvent(eventIndex, current => ({ ...current, notes: current.notes.map((item, at) =>
              at === noteIndex ? { ...item, string: Number(change.target.value) } : item) }))}>
            {[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Fret<input aria-label={`Grace event ${eventIndex + 1} fret ${noteIndex + 1}`} inputMode="numeric" type="number" min={0} max={36} value={note.fret}
            onChange={change => updateGraceEvent(eventIndex, current => ({ ...current, notes: current.notes.map((item, at) =>
              at === noteIndex ? { ...item, fret: Number(change.target.value) } : item) }))} /></label>
          <label>Transition<select aria-label={`Grace event ${eventIndex + 1} transition ${noteIndex + 1}`} value={note.transition}
            onChange={change => updateGraceEvent(eventIndex, current => ({ ...current, notes: current.notes.map((item, at) =>
              at === noteIndex ? { ...item, transition: change.target.value as GraceTransition } : item) }))}>
            <option value="none">None</option><option value="hammer-on">Hammer-on</option><option value="pull-off">Pull-off</option><option value="slide">Slide</option></select></label>
          {event.notes.length > 1 && <button type="button" aria-label={`Remove grace event ${eventIndex + 1} string ${noteIndex + 1}`}
            onClick={() => updateGraceEvent(eventIndex, current => ({ ...current, notes: current.notes.filter((_, at) => at !== noteIndex) }))}>Remove string</button>}
        </div>)}
        <div className="grace-event-actions">
          <button type="button" aria-label={`Add string to grace event ${eventIndex + 1}`} disabled={event.notes.length >= 5}
            onClick={() => updateGraceEvent(eventIndex, current => {
              const unused = [1, 2, 3, 4, 5].find(value => !current.notes.some(item => item.string === value))!;
              return { ...current, notes: [...current.notes, { string: unused, fret: 0, transition: 'none' }] };
            })}>Add string</button>
          {graceEvents.length > 1 && <button type="button" aria-label={`Remove grace event ${eventIndex + 1}`}
            onClick={() => { setGraceError(''); setGraceEvents(current => current.filter((_, at) => at !== eventIndex)); }}>Remove event</button>}
        </div>
      </fieldset>)}
      <button type="button" className="grace-add-event" disabled={graceEvents.length >= 8} onClick={() => { setGraceError('');
        setGraceEvents(current => [...current, { denominator: 16, notes: [{ string: current.at(-1)?.notes[0].string ?? 1, fret: 0, transition: 'none' }] }]); }}>Add grace event</button>
    </>}
    {gracePreview?.error && <p className="alert" role="alert">{gracePreview.error}</p>}
    {graceError && <p className="alert" role="alert">{graceError}</p>}
    <div className="duplicate-dialog-actions">
      <button type="button" data-dialog-first={target?.readOnly.length ? '' : undefined} onClick={() => onClose()}>Cancel</button>
      {target?.existing && <button type="button" onClick={() => setGraceError(onRemove() ?? '')}>Remove grace group</button>}
      {!target?.readOnly.length && <button type="button" disabled={!gracePreview?.candidate}
        onClick={() => { if (gracePreview?.candidate) setGraceError(onApply(gracePreview.candidate, graceEvents) ?? ''); }}>Apply grace group</button>}
    </div>
  </dialog>
  );
}
