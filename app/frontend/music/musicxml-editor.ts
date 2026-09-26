// The score editing engine lives in ./editor, split by domain. This entry
// point keeps the public API stable for the app and tests.
export { sourceTabNoteRecords } from './editor/records';
export { musicXmlTimingBoundary } from './editor/time';
export type { RhythmPosition } from './editor/time';
export { musicXmlEditorState, replaceTechnique, applyMusicXmlEdits } from './editor/state';
export type { TechniqueChoice, EditableMusicXmlNote, SourceNoteIdentity, MusicXmlEditorState } from './editor/state';
export { removeMusicXmlNotes, addMusicXmlNote } from './editor/notes';
export { inspectMusicXmlDuration, changeMusicXmlDuration, insertMusicXmlEvent, createMusicXmlTriplet, inspectMusicXmlTriplet, removeMusicXmlTriplet } from './editor/durations';
export type { MusicXmlDurationInfo, InsertEventOptions, MusicXmlTripletInfo } from './editor/durations';
export { insertMusicXmlMeasure, duplicateMusicXmlMeasure, deleteMusicXmlMeasure, inspectMusicXmlMeterRange, changeMusicXmlMeter, changeMusicXmlPickup } from './editor/measures';
export type { MeasureDuplication, MeasureDeletion, MeterScope, MeterChange } from './editor/measures';
export { inspectMusicXmlRepeats, addMusicXmlRepeat, addMusicXmlEndings, inspectMusicXmlRepeatEndings, removeMusicXmlRepeat } from './editor/repeats';
export type { RepeatRegion, RepeatEndings } from './editor/repeats';
export { inspectMusicXmlTie, connectMusicXmlTie, removeMusicXmlTie, inspectMusicXmlNoteTechniques, setMusicXmlHand, setMusicXmlBend, inspectMusicXmlTransitions, connectMusicXmlTransition, removeMusicXmlTransition } from './editor/techniques';
export type { TiePosition, GraceTransition, PickingHand, FrettingHand, BendAmount, NoteBend, NoteTechniqueInfo, TransitionKind, NoteTransition } from './editor/techniques';
export { removeMusicXmlGrace, inspectMusicXmlGraceGroup, applyMusicXmlGraceGroup, addMusicXmlGraceGroup, removeMusicXmlGraceGroup, graceEventPlacement, isAfterGraceGroup } from './editor/grace';
export type { GraceRemoval, GraceMember, GraceNoteSpec, GraceEventSpec, GraceGroupInfo, GracePlacement } from './editor/grace';
export { ANCHOR_TEXT_LIMIT, chordSpellingName, inspectMusicXmlAnchor, changeMusicXmlAnchor, LYRIC_VERSES, STANDALONE_LYRICS_LIMIT, inspectMusicXmlLyrics, setMusicXmlLyric, setMusicXmlStandaloneLyrics } from './editor/text';
export type { ChordQuality, ChordRoot, ChordSpelling, AnchorKind, AnchorItem, AnchorInfo, LyricSyllabic, EventLyric } from './editor/text';
export { TEMPO_LIMITS, TUNING_LIMITS, CAPO_LIMIT, defaultFifthCapo, fifthStringOffset, inspectMusicXmlScoreSettings, applyMusicXmlScoreSettings, inspectMusicXmlTempo, setMusicXmlLocalTempo } from './editor/settings';
export type { TuningMode, ScoreSettings, ScoreSettingsInfo, LocalTempoInfo, Feel } from './editor/settings';
export { copyMusicXmlMeasures, pasteMusicXmlMeasures, cutMusicXmlMeasures } from './editor/clipboard';
export type { MeasureClipboard, PasteMode, MeasureCut } from './editor/clipboard';
