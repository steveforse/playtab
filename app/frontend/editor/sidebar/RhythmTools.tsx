import type { MusicXmlDurationInfo, MusicXmlTripletInfo } from '../../music/musicxml-editor';
import { CommandButton, CommandButtons, type EditorCommands } from '../commands';
import { DURATION_DENOMINATORS } from '../rhythm';

export const DURATION_COMMANDS = DURATION_DENOMINATORS.map(value => `duration-${value}`);

// Duration, tuplet, insertion and tempo actions for the selected event.
export function RhythmTools({ rhythm, triplet, tupletLocked, commands }: {
  rhythm: Pick<MusicXmlDurationInfo, 'denominator' | 'dots' | 'rest' | 'reason'>; triplet: MusicXmlTripletInfo | null; tupletLocked: boolean; commands: EditorCommands;
}) {
  return <div className="editor-rhythm-tools" aria-label="Duration tools">
    <p>Duration</p>
    <div className="editor-duration-buttons"><CommandButtons commands={commands} ids={DURATION_COMMANDS} /></div>
    <CommandButton command={commands.dotted} />
    <CommandButton command={commands['split-rest']} />
    {rhythm.rest && !tupletLocked && rhythm.denominator === 64 && <p className="editor-rhythm-reason">A 1/64 rest is the shortest rest; it cannot be split further.</p>}
    {rhythm.rest && !tupletLocked && rhythm.dots > 0 && <p className="editor-rhythm-reason">A dotted rest cannot be split; choose an undotted duration first.</p>}
    <CommandButtons commands={commands} ids={['insert-event', 'set-tempo', 'triplet', 'remove-triplet']} />
    {rhythm.reason && <p className="editor-rhythm-reason">{rhythm.reason}</p>}
    {triplet?.reason && triplet.reason !== rhythm.reason && <p className="editor-rhythm-reason">{triplet.reason}</p>}
  </div>;
}
