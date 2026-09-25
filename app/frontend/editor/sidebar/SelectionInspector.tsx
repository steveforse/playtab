import type { ScoreSelection } from '../../Player';
import { CommandButton, type EditorCommands } from '../commands';

export type SelectionDetails = { offset: string; pitch: string; grace: { options: { label: string; event: number }[] } | null };
export type MoveOutcome = { destination: number; fret: number; pitch: string; reason: string | null };
type Navigation = Partial<Pick<ScoreSelection, 'measure' | 'event' | 'voice' | 'string'>>;

// Where the selection is, how to move it, and the fret and string edits
// for the selected position.
export function SelectionInspector({ selection, details, measureCount, eventCount, onNavigate, fretDraft, onFretDraft, fretBuffered,
  moveString, onMoveString, moveMode, onMoveMode, moveOutcome, commands }: {
  selection: ScoreSelection; details: SelectionDetails | null; measureCount: number; eventCount: number; onNavigate: (changes: Navigation) => void;
  fretDraft: string; onFretDraft: (value: string) => void; fretBuffered: boolean;
  moveString: string; onMoveString: (value: string) => void; moveMode: 'fret' | 'pitch'; onMoveMode: (value: 'fret' | 'pitch') => void;
  moveOutcome: MoveOutcome | null; commands: EditorCommands;
}) {
  return <>
    <div className="editor-selection-summary" aria-live="polite">
      <span>Measure {selection.measure}</span>
      <span>Event {selection.event}</span>
      <span>String {selection.string ?? '—'}</span>
      {details && <span>{details.offset}</span>}
      {details && <span>{details.pitch}</span>}
      {selection.fret !== null && <span>Fret {selection.fret}</span>}
    </div>
    <div className="editor-selection-fields">
      <label>Measure<select aria-label="Selection measure" value={selection.measure} onChange={event => onNavigate({ measure: Number(event.target.value) })}>{Array.from({ length: Math.max(1, measureCount) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
      <label>Event<select aria-label="Selection event" value={selection.event} onChange={event => onNavigate({ event: Number(event.target.value) })}>{Array.from({ length: Math.max(1, eventCount) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
      <label>Voice<select aria-label="Selection voice" value={selection.voice} onChange={event => onNavigate({ voice: Number(event.target.value) })}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>String<select aria-label="Selection string" value={selection.string ?? ''} onChange={event => onNavigate({ string: event.target.value ? Number(event.target.value) : null })}><option value="">—</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      {details?.grace && <label>Grace<select aria-label="Selection grace" value={selection.event}
        onChange={event => onNavigate({ event: Number(event.target.value) })}>
        {details.grace.options.map(option => <option key={option.event} value={option.event}>{option.label}</option>)}</select></label>}
    </div>
    {selection.mappingReason && <p className="editor-selection-reason">{selection.mappingReason}</p>}
    {selection.string !== null && <div className="editor-note-tools">
      <label>{selection.kind === 'note' ? 'Fret' : 'Add fret'}<input aria-label="Fret" inputMode="numeric" min={0} max={36} value={fretDraft} onChange={event => onFretDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commands['apply-fret'].run(event.currentTarget); } }} /></label>
      <CommandButton id="apply-fret" command={commands['apply-fret']} />
      {fretBuffered && <p className="editor-fret-buffer" role="status">Fret {fretDraft} typed — press Enter to apply or Escape to cancel.</p>}
      {selection.kind === 'note' && <>
        <label>Move to string<select aria-label="Move to string" value={moveString} onChange={event => onMoveString(event.target.value)}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value} disabled={value === selection.string}>{value}</option>)}</select></label>
        <label>When moving<select aria-label="Move keeps" value={moveMode} onChange={event => onMoveMode(event.target.value as 'fret' | 'pitch')}>
          <option value="fret">Keep fret</option><option value="pitch">Keep pitch</option></select></label>
        {moveOutcome && <p className="editor-rhythm-reason" role="status">{moveOutcome.reason ?? `Result: string ${moveOutcome.destination}, fret ${moveOutcome.fret}, ${moveOutcome.pitch}.`}</p>}
        <CommandButton id="move-string" command={commands['move-string']} />
        <CommandButton id="remove-note" command={commands['remove-note']} />
      </>}
    </div>}
    {!commands['make-rest'].hidden && <div className="editor-event-tools"><CommandButton id="make-rest" command={commands['make-rest']} /></div>}
  </>;
}
