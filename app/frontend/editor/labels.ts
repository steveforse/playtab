import type { AnchorKind, BendAmount, ChordQuality, ChordRoot, ChordSpelling, TransitionKind } from '../music/musicxml-editor';

// User-facing names shared by the editor sidebar, dialogs and messages.
export const BEND_LABELS: Record<BendAmount, string> = { 1: '1/2 step', 2: 'Whole step', 3: '1½ steps', 4: '2 steps' };
export const ANCHOR_NAMES: Record<AnchorKind, { title: string; item: string }> = {
  chord: { title: 'Chord name', item: 'chord' }, words: { title: 'Annotation', item: 'annotation' }, section: { title: 'Section label', item: 'section' } };
export const CHORD_QUALITIES: [ChordQuality, string][] = [['major', 'Major'], ['minor', 'Minor'], ['dominant', '7'], ['major-seventh', 'maj7'],
  ['minor-seventh', 'm7'], ['diminished', 'dim'], ['augmented', 'aug'], ['suspended-fourth', 'sus4']];
export const CHORD_STEPS: ChordRoot['step'][] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
export const DEFAULT_CHORD: ChordSpelling = { step: 'C', alter: 0, quality: 'major', bass: null };
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const midiName = (midi: number) => Number.isInteger(midi) ? `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}` : '—';
export const TRANSITION_NAMES: Record<TransitionKind, string> = { tie: 'tie', 'hammer-on': 'hammer-on', 'pull-off': 'pull-off', slide: 'slide' };
export const capitalized = (value: string) => `${value[0].toUpperCase()}${value.slice(1)}`;
