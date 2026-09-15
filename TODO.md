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

## Already completed

- Native Ruby TEF2 and TablEdit TEF3 import with bounded validation and explicit unsupported-feature warnings.
- Imported TEF and MusicXML previews saved as version-2 library documents and reconstructed on reopen.
- Full private Brainjo corpus validation: 375 unique files parsed and loaded by alphaTab.
- TEF chords, sections, fingering, thumb markers, hammer-ons, pull-offs, bends, and standalone lyrics preservation.
- Configurable measures per line, lyric columns, and PDF layout fixes.
- TEF2 and TablEdit TEF3 export with explicit loss warnings.
- Public GitHub repository with passing Rails, frontend, lint, and security CI.

## Project rules

- Work on the matching feature branch and merge through a pull request.
- Keep private tablature, PDFs, generated MusicXML, credentials, and local artifacts out of the repository.
- Add focused tests and update this roadmap when an item is complete.
