import type { ScoreSelection } from '../../Player';
import type { FrettingHand, NoteTechniqueInfo, NoteTransition, PickingHand, TransitionKind } from '../../music/musicxml-editor';
import { CommandButton, type EditorCommands } from '../commands';
import { capitalized, TRANSITION_NAMES } from '../labels';

export const TRANSITION_COMMANDS: readonly TransitionKind[] = ['hammer-on', 'pull-off', 'slide', 'tie'];

// Grace notes, hand annotations, bends and note-to-note transitions.
export function TechniqueTools({ selection, techniques, onHand, transitions, onRemoveTransition, pendingTransition, onCompleteTransition, onCancelTransition, commands }: {
  selection: ScoreSelection; techniques: NoteTechniqueInfo | null;
  onHand: (hand: 'picking' | 'fretting', value: PickingHand | FrettingHand) => void;
  transitions: NoteTransition[]; onRemoveTransition: (transition: NoteTransition) => void;
  pendingTransition: { origin: ScoreSelection; kind: TransitionKind } | null;
  onCompleteTransition: () => void; onCancelTransition: () => void; commands: EditorCommands;
}) {
  return <details className="editor-technique-tools"><summary>Techniques</summary>
    <CommandButton id="remove-grace" command={commands['remove-grace']} />
    {techniques && <div className="editor-hand-tools">
      <label>Picking hand<select aria-label="Picking hand" value={techniques.picking ?? ''} disabled={techniques.picking === null}
        onChange={event => onHand('picking', event.target.value as PickingHand)}>
        {techniques.picking === null && <option value="">Kept as written</option>}
        <option value="none">None</option><option value="T">T</option><option value="I">I</option><option value="M">M</option></select></label>
      {techniques.pickingReason && <p className="editor-rhythm-reason">{techniques.pickingReason}</p>}
      <label>Fretting hand<select aria-label="Fretting hand" value={techniques.fretting ?? ''} disabled={techniques.fretting === null}
        onChange={event => onHand('fretting', event.target.value as FrettingHand)}>
        {techniques.fretting === null && <option value="">Kept as written</option>}
        <option value="none">None</option>{['1', '2', '3', '4'].map(value => <option key={value} value={value}>{value}</option>)}<option value="T">Thumb</option></select></label>
      {techniques.frettingReason && <p className="editor-rhythm-reason">{techniques.frettingReason}</p>}
    </div>}
    <CommandButton id="remove-tie" command={commands['remove-tie']} />
    {transitions.map(item => <button key={`${item.kind}:${item.direction}`} type="button" onClick={() => onRemoveTransition(item)}>
      Remove {TRANSITION_NAMES[item.kind]} {item.direction === 'outgoing' ? 'to' : 'from'} {item.other ? `m${item.other.measure} e${item.other.event}` : 'its other note'}</button>)}
    {pendingTransition && <div className="editor-tie-pending" role="status">
      <p>{pendingTransition.kind === 'tie' ? 'Origin' : `${capitalized(TRANSITION_NAMES[pendingTransition.kind])} origin`}: measure {pendingTransition.origin.measure}, event {pendingTransition.origin.event}, string {pendingTransition.origin.string}, fret {pendingTransition.origin.fret}. Select the destination note.</p>
      <button type="button" disabled={selection.kind !== 'note'} onClick={onCompleteTransition}>Use selected note</button>
      <button type="button" onClick={onCancelTransition}>Cancel {TRANSITION_NAMES[pendingTransition.kind]}</button>
    </div>}
  </details>;
}
