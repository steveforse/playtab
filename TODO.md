# Playtab feature roadmap

This is the ordered feature backlog for Playtab. Each item has a planned branch name; create that branch when implementation begins and land the work through a pull request into `main` after the required CI checks pass.

## Ordered feature work

- [x] **1. Save imported scores to the library** — `feature/persist-imported-scores`
  - Expand the versioned score document so it can preserve imported alternate tunings, rhythms, techniques, lyrics, chords, sections, and metadata.
  - Save TEF and MusicXML previews without silently simplifying unsupported content.
  - Add reopen, validation, and migration coverage.

- [x] **2. Improve playback fidelity** — `feature/improve-playback-fidelity`
  - Imported hammer-ons and pull-offs use held-note legato pitch transitions instead of destination reattacks.
  - Imported slide and bend MIDI output retains the source note keys while generating pitch movement.
  - alphaTab AudioWorklet output is enabled after start, pause, synchronized transport, and browser playback smoke tests passed.

- [x] **3. Expand TEF compatibility** — `feature/expand-tef-compatibility`
  - Decode verified TEF2 and TablEdit TEF3 effects, tuplets, grace notes, ties, voices, tempo changes, and alternate endings.
  - Preserve fingering and unsupported effect values as explicit MusicXML technical metadata with import warnings.
  - Keep raw TEF2 repeat maps and source-only layout records explicit until their playback semantics are independently verified.

- [x] **4. Add score editing** — `feature/score-editing`
  - Edit notes, measures, tuning, tempo, lyrics, chords, sections, annotations, and techniques after import.
  - Native scores edit their notes, measures, title, and tempo in the bounded JSON model.
  - Imported scores update targeted MusicXML nodes and preserve untouched source information when saved.

- [x] **5. Add TEF export** — `feature/tef-export`
  - Export supported library scores and edited imports back to `.tef`.
  - Export native scores and imported MusicXML through bounded TEF2 and TablEdit TEF3 writers.
  - Report fields that cannot be represented by the selected TEF version before download.

- [x] **6. Add vector PDF recognition/import** — `feature/pdf-recognition`
  - Extract tablature, lyrics, chord names, sections, techniques, and fingering marks from vector source PDFs.
  - Emit a bounded five-string MusicXML preview through the Rails upload flow.
  - Preserve reviewable recognition counts and warnings for inferred timing, missing tempo, unresolved voicings, and uncertain marks.
  - Completed on commit `c561d33`; all 356 paired Brainjo PDFs recognize successfully.
  - Follow-up implementation now detects eighth-, sixteenth-, and 32nd-note spacing per measure, recognizes more section and technique label variants, accepts common selectable metronome markings, and runs entirely through the native Ruby Rails path. `script/check_pdf_corpus.rb` repeats private corpus scans while skipping byte-identical duplicates and can target the paired corpus manifest.
  - Ruby recognition parses all 356 private paired Brainjo PDFs successfully. The Wellerman PDF retains 34 measures, 294 notes, 6 sections, 14 chords, 20 techniques, 4 fingerings, and standalone lyrics; flat chord symbols are preserved.
  - Reference-model differences remain in some PDFs because PDF glyph decoding and close note/annotation placement are ambiguous. Lyrics are preserved as standalone text, although token spacing can differ from the source layout.
  - Remaining: decode graphical rhythm and time-signature markings where the PDF contains no selectable text, improve semantic alignment for PDFs whose written measure layout differs from the matching TEF, and add confidence review for ambiguous marks.

- [x] **7. Improve lyrics and chord presentation** — `feature/lyrics-chord-presentation`
  - Timed MusicXML lyrics remain attached to their alphaTab beats and render with the notation.
  - Untimed lyrics remain in their standalone section with configurable columns and compact print spacing.
  - Imported TEF and MusicXML chord voicings can be shown as diagrams through an explicit control; chord names alone do not enable diagrams.

- [x] **8. Improve banjo audio assets** — `feature/banjo-audio-assets`
  - Replaced the former SONiVOX starter bank with MuseScore General Lite 0.2.1 SF3 for General MIDI program 105 (banjo).
  - Preserved the Debian source attribution and complete MIT/public-domain/CC0 notices beside the bundled asset.
  - Added asset-integrity and player-configuration tests; browser playback exercises the bank through alphaTab.
  - Follow-up on `feature/realistic-banjo-articulation` holds the picked H/PO origin voice, applies an immediate destination pitch step, and adds a short quiet attack transient from the selected bank without a second picked attack.
  - Dedicated sampled banjo articulations and bank-specific legato samples remain future audio-quality work.

- [x] **9. Productize the workspace** — `feature/productize-workspace`
  - Add authentication, multi-user libraries, synchronization, and deployment hardening.
  - Reassess upload limits and service isolation before public hosting.
  - Added password authentication, account registration, password reset, secure production sessions, and sign-out.
  - Scoped every saved score and import/export API operation to the signed-in account; database persistence provides cross-session library synchronization.
  - Existing unowned prototype scores are claimed by the first newly registered account during the local-to-account transition.
  - Protected upload endpoints with CSRF, production host authorization, HTTPS enforcement, secure cookies, and a pre-parse 12 MB request cap. Native parsers remain in-process with endpoint-specific limits and no converter service.

- [ ] **10. Add scanned PDF recognition/import** — `feature/scanned-pdf-recognition`
  - Detect image-only PDFs and route them to a separate recognition pipeline.
  - Render pages at a controlled resolution, deskew and clean the images, then recognize tablature staff lines, fret numbers, rhythms, lyrics, chords, sections, and techniques.
  - Attach confidence scores and provide a review workflow for uncertain recognition before creating MusicXML.
  - Build a labeled, private evaluation corpus and enforce resource, timeout, and upload limits for OCR/OMR processing.
  - In progress on `feature/scanned-pdf-recognition`: image-only pages now use a 300-DPI Ruby `ruby-vips`/Tesseract pipeline for staff geometry and fret-digit recovery, while the existing vector recognizer remains the first path. Raster imports now detect printed time signatures, recover open strings split by staff lines, and preserve direction-validated hammer-on/pull-off marks; title and tuning are preserved when recognized.
  - Remaining work is scan deskew, broader reliable rhythm recovery, confidence-aware review, and recognition of raster chords, lyrics, sections, fingerings, and repeats.

- [x] **11. Audit editor UI against parsed TEF3 fields** — `chore/editor-parity-audit`
  - Check `app/frontend/music/editor/*` and `app/frontend/music/score.ts` for whether capo, clef, per-note dynamics, pick-stroke direction, and the second voice-per-string are exposed anywhere in the editing UI, given that the TEF3 parser already reads them.
  - Result determines scope for items 12 and 17 below: fields with existing (even partial) editor support only need export wiring; fields with none need editor work too.
  - No code changes expected beyond findings; produces a short note per field (present / absent / partial) to fold into the affected tickets.
  - Findings (2026-09-26). TEF3 export reads the edited MusicXML (`Exporter::Model.from_musicxml`), not the parsed TEF, so a field survives a round trip only if the importer writes it into MusicXML, the editor keeps it, and the exporter reads it back.
    - **Capo — partial.** Import writes only a "Capo N" words direction (item 20). The editor reads that, converts it to `<capo>`, and edits capo and 5th-string capo in Score settings. The exporter ignores both, so the TEF instrument capo is always 0.
    - **Clef — absent.** The importer hardcodes treble-8vb notation plus TAB and never uses the parsed `clef`/`middle_c`. The editor keeps `<clef>` attributes but offers no control. The exporter writes no clef. Export wiring only; no editor work unless a non-default clef turns up in the corpus.
    - **Per-note dynamics — absent.** Parsed (`dynamic`, byte 2 bits 5–7) but never written to MusicXML, so nothing reaches the editor or exporter. Needs an importer representation (MusicXML `<dynamics>`, or `<note dynamics="…">` for velocity), editor controls, and export.
    - **Pick-stroke direction — partial.** Only `stroke == 1` is used, as the thumb marker ("TEF fingering T"), which the editor exposes as the Thumb fingering choice. The exporter writes thumb as fingering code 6, not as a stroke. Other stroke values are dropped on import, so the editor has nothing to show.
    - **Second voice per string — partial.** The importer writes `<voice>2</voice>`. The editor addresses beats by voice (Properties → Go to → Voice 1–4) and edits existing voice-2 beats in place. It cannot create a voice-2 beat where the source has none. The exporter reads no voice and writes none, and warns that independent voices are not preserved.

- [x] **12. Close TEF3 export data loss** — `feature/tef3-export-parity`
  - `lib/tef2/exporter.rb::TableditWriter.note_record` currently hardcodes `effect2`/`effect3` to `0, 0, 0` on every note regardless of source data — fix so parsed effect bytes round-trip.
  - Write back `dynamic`, `stroke` (pick direction), and grace-note effect/fret, all of which are parsed but currently dropped on export.
  - Write back per-instrument `capo` and `clef`, parsed in `parse_instruments` but never referenced in `TableditWriter`.
  - Stop hardcoding MIDI program 105 (banjo) in export; write the source instrument's actual `midi_voice`/`midi_bank`.
  - Add round-trip tests: import a fixture exercising each field, export, re-import, assert values match the original.
  - Scope from item 11: capo, clef, stroke/thumb and grace fields need exporter wiring only (MusicXML already carries them, or the importer can add them without new editor UI). Dynamics also need an importer representation before export can round-trip them; editor controls for dynamics can follow in item 17. Raw `effect2`/`effect3` bytes are not in MusicXML today, so round-tripping them means writing them as `other-technical` metadata on import (as unsupported effect codes already are).
  - Done (2026-09-26). TEF3 import now keeps the raw secondary effects, non-default dynamics and pick strokes as per-note `TEF …` metadata, writes the real one-based MIDI program and bank, and keeps non-default clef, middle-C and 5th-string capo bytes as `playtab-tef-*` identification fields. Export reads them back, reads the capo from `<capo>` or the legacy "Capo N" words (no longer exported as a text), restores absolute 5th-string frets, derives the remaining primary and secondary effects from MusicXML that did not come from TEF, folds each grace note into the TablEdit note it leads into (warning when a grace cannot be represented), and lays out the instrument record as TablEdit does. The parser no longer reads byte 2's top bit (the dynamic's high bit) as a tie.
  - Private corpus check (104 TEF3 files, 28,778 notes): every note and instrument field round-trips except known equivalents. Hammer-on/pull-off take their direction from fret movement on import. An open 5th string written as the capo fret returns as 0; it looks and plays the same. Two same-fret legato markers were already dropped on import.
  - Dynamics have no documented TablEdit value order, so they carry no playback meaning yet.

- [x] **13. Restore TEF3 repeat support** — `feature/tef3-repeats`
  - `lib/tef2/tabledit_v3_parser.rb` hardcodes `repeats: []` for the modern TEF3 layout even though the older `full_parser.rb` (TEF2) already decodes a repeat table — port/adapt that logic to the TEF3 content stream.
  - **Before implementing**, read TablEdit's own "Reading List" manual page (`reading_list.htm` / `glos_reading_guides.htm` in its help file) in full: TablEdit does not store simple start/end barline pairs. It stores an ordered list of up to 96 measure-range sequences (e.g. "1-16, 3-14, 17-18") and *derives* repeat signs, voltas, Da Capo/Da Segno/Segno markers, and named section labels from that list. Modeling this as flat barline pairs will misrepresent any file using Da Capo/Da Segno or named sequences.
  - Export repeat barlines in `TableditWriter` instead of relying on the existing loss-warning at `exporter.rb:358`.
  - Cover with a fixture containing simple and nested repeat sections, plus at least one using Da Capo/Da Segno.
  - Done (2026-09-26). The reading list sits at header pointer 0x80: a u16 record size (32) and count, then per range a u16 first and last measure (1-based); the rest of each record is the range name, which TablEdit leaves as uninitialized memory. `Tef2::ReadingList` decodes it into repeats (with play counts), first/second endings (first ending up to 4 measures, in the editor's ending shape), and D.C./D.S. al Coda or al Fine with segno and coda. It works out alphaTab's playing order, and export writes the playing order back as a reading list. The frontend reads a D.C./D.S. as al Coda or al Fine when the score has a To Coda or Fine; alphaTab's MusicXML reader only makes plain jumps. Duplicating a measure leaves its jump marks behind.
  - Private corpus: 36 of 104 TEF3 files have a reading list. All decode to TablEdit's playing order except Silver Bell, whose D.S. retakes repeats that alphaTab plays once; the import warns. Import then export reproduces the playing order for 103 of 104 files. Lists may re-split: "1-4, 1-4, 1-4, 5-8" can come back as "1-4, 1-4, 1-8".
  - Nested repeats have no plain form; they fall back to a D.C./D.S. with a warning. None are in the corpus.

- [x] **14. Export alternate endings** — `feature/tef3-alternate-endings`
  - Endings are already parsed (`parser.rb:268-279`) and rendered in MusicXML but never written back to `.tef` — add the write path in `TableditWriter` and remove the now-inapplicable loss warning.
  - Depends on or can be bundled with item 13 since both derive from the same Reading List structure, not independent barline pairs — see item 13's note.
  - Done with item 13: no TEF3 file in the corpus has explicit ending records (0xB7). TablEdit keeps endings in the reading list, so TEF3 export writes them that way and no longer warns. TEF2 export still warns that repeats, endings and jumps are written in order.

- [ ] **15. Support mid-score tempo and time signature changes** — `feature/tef3-tempo-timesig-changes`
  - Tempo changes are parsed (`parser.rb:280-287`) but `TableditWriter` only ever exports the single global header tempo — add mid-score tempo change export.
  - Mid-score time signature changes aren't parsed at all for TEF3 (`time_sig_changes: []` is hardcoded) — determine the TEF3 encoding for a time signature change event and decode it, mirroring how tempo changes are found.
  - Fixture files should include at least one file with a tempo change and one with a time signature change partway through.
  - Status (2026-09-26). Time signatures: TablEdit 3 keeps one per measure in the measure table, which import already reads and TEF3 export writes; `time_sig_changes: []` only matters for TEF2. A round-trip test now covers 3/4 → 4/4 → 6/8, and 3 private files change meter.
  - Tempo changes are **blocked on a sample**: no private TEF (104 TEF3, 271 TEF2) has a mid-score tempo change, and MuseScore's TablEdit importer reads only the header tempo. The parser's 0xFE record is unverified, so export does not write it. Instead it warns that later tempo changes are not represented. Needs a TablEdit file saved with a tempo change.
  - Found alongside: MuseScore's importer (`src/importexport/tabledit/internal/importtef.cpp`) marks a tie on the second note as dynamic value 7 in byte 2. Import and TEF3 export now follow that; byte 8 bit 1 is still read for earlier Playtab exports.

- [x] **16. Add key signature and transpose support** — `feature/key-signature-transpose`
  - Neither exists anywhere in the codebase today. Reverse-engineer where TablEdit stores key signature (likely near the instrument or header block) using minimal-diff sample files the same way prior format work was done.
  - Transpose is an editing operation in TablEdit rather than stored state — decide whether to implement it as a score-level edit action in the frontend editor plus corresponding fret/tuning recalculation, or scope it out if it's genuinely just a transient UI convenience with no persisted effect.
  - Done (2026-09-26). TablEdit 3 stores the key per measure: a signed fifths byte at offset 2 of each measure-table record, which MuseScore's TablEdit importer also reads. Import now writes the opening key and any key change; it no longer hardcodes G major, though TEF2 imports keep G. TEF3 export writes each measure's key back. The private corpus has key 0 (TablEdit's default) in 103 files and A major in one, with no key changes. The editor already edits the key in Score settings.
  - Transpose is scoped out. TablEdit's transpose is a one-off edit with no stored state. On a banjo, the capo (Score settings) transposes while keeping fingerings, and a tuning change with "Keep pitches" rewrites frets. A fret-shifting transpose can't keep open-string fingerings when it goes down. Revisit if a real arrangement needs one.

- [ ] **17. Decode the extended note-effect cluster** — `feature/extended-note-effects`
  - Choke, rasgueado, roll, brush, dead note, ghost note, tapping (as distinct from hammer-on), tremolo, and vibrato currently have no structured decode — they either fall through to generic bend/harmonic/staccato handling or an unlabeled `"TEF effect2 #{low}"` metadata string.
  - Fully decode the remaining bend variants (currently only 3 of TablEdit's bend/choke/tremolo options are distinguished).
  - TablEdit's manual (`special_effects.htm`) documents two dimensions not yet accounted for — confirm scope covers both before considering this done:
    - **Primary + secondary "combination" effects**: a note can carry a primary effect and a secondary combination effect together (e.g. Brush + Choke), and combined effects render differently from either alone (e.g. hammer-on/pull-off slur moves to stem level, Roll finishes early with no curvy line, Harmonic displays an octave low, Brush arrow moves side). Check whether `effect1`/`effect2`/`effect3` already separate primary from secondary before assuming this is undecoded.
    - **Per-effect numeric parameters**: Roll speed (1-8, default 4), Vibrato frequency (1-16, default 12) and amplitude (1-8), Tremolo subdivision, Choke pitch amount, Staccato duration reduction, plus the fixed Muted (-30% volume/-50% duration) and Ghost note (-33% volume) adjustments. Labeling effect *type* without capturing these adjustable values is still lossy — add explicit round-trip coverage for the parameters, not just the type.
  - Double-check the staccato rendering at `full_musicxml_builder.rb:517`, which reuses the hammer-on/pull-off pairing logic — confirm this isn't conflating two distinct effect codes before building on top of it.
  - Each effect needs: parse, MusicXML technique rendering, and TEF3 export — don't repeat the import/export asymmetry from item 12.
  - Reference: MuseScore's TablEdit importer reads byte 7's low five bits as right hand × 6 + left hand (left hand 1 = open, 2–5 = fingers 1–4; right hand 1 = thumb, then index, middle…). Playtab decodes only the single values 2–6. The private corpus uses nothing else.

- [ ] **18. Finish second-voice-per-string support** — `feature/second-voice-support`
  - `voice` is already parsed (`parser.rb:247`) and rendered in MusicXML (`full_musicxml_builder.rb:419,459`), making this the most complete of the unfinished features — but `TableditWriter.note_record` has no voice field at all, and item 11's audit should confirm whether the editor UI supports it.
  - Scope depends on item 11: if the editor already has partial support, this may just need export wiring; if not, editor work is needed too.
  - Item 11 result: partial. The editor navigates to and edits existing voice-2 beats; adding a beat to an empty second voice, and TEF3 export of the voice bits (byte 3 bits 4–5), are the remaining work. MuseScore reads byte 3 bits 4–5 as 0 default, 2 upper and 3 lower voice.

- [ ] **19. Add remaining score markings and symbols** — `feature/musical-symbols`
  - TablEdit's Insert menu musical symbols (trill, mordent, fermata, emphasis points), crescendo/decrescendo markings, and scale diagrams have no code footprint — lowest priority of this list since they're less commonly used than the note-effect cluster.
  - Percussion events are also unimplemented for TEF3 (`percussions: []` hardcoded); the older TEF2 `full_parser.rb` path has some percussion handling worth checking for reusable logic first.

## Already completed

- Native Ruby TEF2 and TablEdit TEF3 import with bounded validation and explicit unsupported-feature warnings.
- Imported TEF and MusicXML previews saved as version-2 library documents and reconstructed on reopen.
- Full private Brainjo corpus validation: 375 unique files parsed and loaded by alphaTab.
- TEF chords, sections, fingering, thumb markers, hammer-ons, pull-offs, bends, and standalone lyrics preservation.
- Configurable measures per line, lyric columns, and PDF layout fixes.
- TEF2 and TablEdit TEF3 export with explicit loss warnings.
- Public GitHub repository with passing Rails, frontend, lint, and security CI.

- [ ] **20. Write a real capo on TEF import** — `fix/tef-capo-element`
  - `lib/tef2/full_musicxml_builder.rb` writes the capo only as a "Capo N" words direction, so imported capo scores play two semitones low until Score settings converts the text into a `<staff-details><capo>` (the editor reads the text as the capo since #77).
  - Write `<capo>` in the first measure's TAB `staff-details` and drop the words direction; if a TEF records a 5th-string capo other than capo + 5, write the `playtab-fifth-string-capo` identification field the editor already reads.
  - Relates to item 12 (capo export). Revalidate the private capo corpus: 5th-string display frets stay capo-relative.

- [ ] **21. Transitions from an earlier note into a before-grace** — `feature/grace-incoming-transitions`
  - After-graces (#83–#84) cover a note sliding, hammering or pulling into a grace note. The remaining case is a transition from an earlier main note into the grace group *before* a later note; the ordinary Techniques commands and the before-grace dialog still exclude it.
  - Only needed if a real arrangement requires it; musically it matches an after-grace on the earlier note.

- [ ] **22. Range selection follow-ups** — `feature/range-selection-followups`
  - Clicking an empty area inside the staff still selects a string position; only the zone above the staff selects the whole measure.
  - Ranges are per voice; support and describe all-voice ranges ("Measures 2–4, all voices").

- [ ] **23. Feel changes within a score** — `feature/feel-changes`
  - Score settings sets one feel (straight, swung 2:1, dotted 3:1) for the whole score; allow a feel change at a chosen measure via `<sound><swing>`, which alphaTab already plays and marks.

- [ ] **24. Editor accessibility and device pass** — `chore/editor-a11y-device-pass`
  - Screen-reader pass over the edit title bar, ribbon menus, context menu, Properties panel and status bar; touch long-press on a real device; printing from edit mode.
  - Known timing-flaky browser tests under 2-worker load (editor-add-note 200% zoom, ED-02 selection, ED-23 phone sheet) should be made deterministic.

- [ ] **25. Finish splitting App.tsx** — `refactor/app-commands-session`
  - App is still about 1,800 lines. Move the editor command table (`useEditorCommands`) and the save / leave / conflict session logic (`useScoreSession`) into their own modules, as R-03–R-05 did for dialogs, selection info and shortcuts.

- [ ] **26. Support the banjo 5th-string partial capo** — `feature/fifth-string-capo`
  - Distinct from the main instrument capo (already tracked in item 12/20): TablEdit has a separate "Capo 5th" field specific to the 5-string banjo's short drone string. Unlike the main capo it does not transpose pitch — it only changes fret-number display (notes at the capo position show as 0, notes above show as negative unless capos are "aligned") and blocks entering frets below the capo position.
  - This is common in real clawhammer banjo arrangements, so worth its own ticket rather than folding into item 12 — it's a distinct field with its own display/validation logic, not just another value to write through on export.
  - See TablEdit's `special_instruments.htm` (Clawhammer banjo section) for the exact display rules to replicate.
  - Editor side already exists (#77): Score settings has a 5th-string capo that follows capo + 5 when the capo changes and can be set separately (or None). Playtab's model differs from TablEdit's: the MusicXML keeps the *open* 5th-string tuning, frets stay capo-relative, and a spike other than capo + 5 is stored as the `playtab-fifth-string-capo` identification field and applied as a playback-only offset (`app/frontend/music/editor/tuning.ts`). TEF import/export must convert between the two (TablEdit's 5th-string tuning is already the sounding pitch), or the 5th string is raised twice. Still missing on the editor side: TablEdit's display rules (negative frets below the capo unless aligned) and blocking fret entry below the capo.

- [ ] **27. Verify structured lyrics round-trip** — `chore/lyrics-structure-audit`
  - TablEdit's lyrics support up to 8 numbered verses, per-syllable inline chord names (e.g. `[C]Twin-kle`), a link to a specific instrument module, and independent Y-position/font settings (`lyrics.htm`) — much richer than a single free-text blob.
  - Check whether `indirect_text(bytes, 0x4C)` (`lyrics_text`) already captures this whole structure as one opaque string (round-trip likely fine even if unparsed) or whether verses/inline chords are separately encoded and currently being dropped. Only build structured parsing if the audit finds real data loss.

- [ ] **28. Verify Title Information fields round-trip** — `chore/title-info-audit`
  - Beyond title/subtitle/comment (already tracked in item A), TablEdit's Title Information dialog has distinct fields for Composer, Date of composition, a Copyright field separate from Comments, password-protection status, and an optional hyperlink + description (`title_information.htm`).
  - Check whether these live in the same indirect-text block already parsed or are separate fields being silently dropped on import/export.
  - Editor side (#77): Score settings edits Subtitle (`<credit>` with `credit-type` subtitle), Composer and Arranger (`<identification><creator>`), which alphaTab prints in the score header. Map TablEdit's fields onto these on import (and back on export) rather than adding new storage; Date, Copyright (`<rights>`) and the hyperlink have no editor field yet.

- [ ] **29. Defensive handling for unrecognized marker types** — `fix/marker-type-coverage`
  - TablEdit's marker/anchor-point taxonomy (`markers.htm`) includes independent fingering indicators (separate from per-note fingering), connection markers, line breaks, beam breaks, stem-length markers, and spacing markers, beyond the already-tracked text/chord/tempo/symbol markers.
  - Mostly print-layout cosmetics, not musical content, so low priority for playback — but audit `parse_contents`'s marker-type switch in `tabledit_v3_parser.rb` to confirm unrecognized marker types are explicitly logged/warned rather than silently skipped, so future gaps surface instead of hiding.

- [x] **30. Rename editor "event" terminology to "beat"** — `refactor/event-to-beat-naming`
  - Done: the selection model (`ScoreSelection.beat`), dialog targets, transitions, source identity (`sourceBeatId`, identity kind `beat`), grace types (`GraceBeatSpec`, `graceBeats`) and all editor identifiers now say beat; user-facing text reads beat (labels such as "M1 B1", "Selection beat", "Insert beat…"). Grace-group entries read "Grace note N" in the UI, since grace notes take no beat time. DOM and MIDI events keep their names.
  - The editor layer (`app/frontend/music/editor/durations.ts`, `grace.ts`, `clipboard.ts`, and others — ~226 occurrences across 14 files) calls a rhythmic position "event" (`eventIndex`, `eventTime`, error messages like "Select an ordinary event"), while the score model one layer down (`app/frontend/music/score.ts`) already calls the same concept `beats` (`bars[...].voices[...].beats[...]`).
  - "Event" is overloaded (DOM events, MIDI events, app-level events) and doesn't match any of the terminology used by MIDI, TablEdit, LilyPond, or MusicXML for this concept; "beat" is what Guitar Pro/alphaTab (which playtab renders through) calls it, and it's already the name playtab's own data model uses.
  - Rename `eventIndex`/`eventTime`/local `event` variables and identifiers to `beat`-based names to match `score.ts`, and reword user-facing error/status strings (e.g. "Select an ordinary event to edit its rhythm" → "Select an ordinary beat to edit its rhythm").
  - Check `app/frontend/App.tsx`/`ContextMenu.tsx` and any other `.tsx` files for the same terminology before considering this complete, not just the `editor/*.ts` files.

## Project rules

- Work on the matching feature branch and merge through a pull request.
- Keep private tablature, PDFs, generated MusicXML, credentials, and local artifacts out of the repository.
- Add focused tests and update this roadmap when an item is complete.
