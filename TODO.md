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

- [ ] **5. Add TEF export** — `feature/tef-export`
  - Export supported library scores and edited imports back to `.tef`.
  - Report fields that cannot be represented by the selected TEF version.

- [ ] **6. Add PDF recognition/import** — `feature/pdf-recognition`
  - Extract tablature, lyrics, chords, sections, and annotations from source PDFs.
  - Require reviewable confidence or warnings for uncertain recognition.

- [ ] **7. Improve lyrics and chord presentation** — `feature/lyrics-chord-presentation`
  - Support timed lyrics when source timing is available.
  - Keep untimed lyrics in their standalone section with compact configurable layout.
  - Add optional chord-diagram rendering when requested; imported source chord names do not imply diagrams.

- [ ] **8. Improve banjo audio assets** — `feature/banjo-audio-assets`
  - Evaluate and integrate a higher-quality banjo soundfont or dedicated samples.
  - Preserve attribution and licensing information for every bundled asset.

- [ ] **9. Productize the workspace** — `feature/productize-workspace`
  - Add authentication, multi-user libraries, synchronization, and deployment hardening.
  - Reassess upload limits and service isolation before public hosting.

## Already completed

- Native Ruby TEF2 and TablEdit TEF3 import with bounded Docker/TuxGuitar fallback.
- Imported TEF and MusicXML previews saved as version-2 library documents and reconstructed on reopen.
- Full private Brainjo corpus validation: 375 unique files parsed and loaded by alphaTab.
- TEF chords, sections, fingering, thumb markers, hammer-ons, pull-offs, bends, and standalone lyrics preservation.
- Configurable measures per line, lyric columns, and PDF layout fixes.
- Public GitHub repository with passing Rails, frontend, converter, lint, and security CI.

## Project rules

- Work on the matching feature branch and merge through a pull request.
- Keep private tablature, PDFs, generated MusicXML, credentials, and local artifacts out of the repository.
- Add focused tests and update this roadmap when an item is complete.
