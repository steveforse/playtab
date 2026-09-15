# Playtab

A Rails 8.1 + React/TypeScript practice room for five-string banjo, using alphaTab for notation and SoundFont playback.

This is the first playable prototype: a local, single-user workspace. Authentication and production deployment hardening are not implemented. Compose binds the app to localhost.

See [TODO.md](TODO.md) for the ordered feature roadmap.

## Run with Docker

Requires Docker and Docker Compose. No host Ruby or PostgreSQL install is needed.

```sh
docker compose -f compose.yml up -d
docker compose -f compose.yml logs -f web
```

Use the current `docker compose` plugin, not legacy `docker-compose` v1 (which can fail with `ContainerConfig` on this Docker engine). Open **http://localhost:3000** after Rails finishes preparing the database. The first start installs dependencies. PostgreSQL data and Ruby/Node dependencies live in named volumes. Container startup clears a stale Rails PID file left by an interrupted shutdown.

```sh
docker compose -f compose.yml stop
```

Stopping preserves scores. Do not use `down --volumes` unless you intend to discard the database.

On the current workstation, `.env` sets `PLAYTAB_PORT=3001`, so open **http://localhost:3001**. Windows already forwards port 3000 to WSL's network interface, which conflicts with this application's loopback-only binding. Set `PLAYTAB_PORT` to choose another host port; the container still listens on 3000. For browser tests on this workstation, also set `PLAYTAB_URL=http://localhost:3001`.

## Run natively

Use Ruby 3.4, Node 22+, and PostgreSQL. Configure `PGHOST`, `PGUSER`, and `PGPASSWORD` for a database role with permission to create development/test databases, then run:

```sh
bin/setup
```

`bin/dev` runs Rails and Vite together. The checked-in Ruby version matches the container runtime. The workspace was bootstrapped in `/mnt/c/Projects/playtab`; Vite polling is enabled for reliable changes on this WSL mounted filesystem.

## Try it

1. Play the original open-G practice exercise. Adjust speed, switch the metronome on, and loop a selected range.
2. Choose **Import a tab** to use the included plaintext example or load a `.txt` file.
3. Choose a note duration. Read the import assumptions before trusting playback.
4. Save to the library; reopen the score after a page reload.
5. Export plaintext, MIDI, Playtab JSON, TEF2, TablEdit TEF3, or use the browser print dialog to save a PDF.

Play/pause and restart are available above and below the score, synchronized to one player.

### Supported score subset

- One five-string banjo track, open G tuning, no capo, 4/4.
- Full measures of equal quarter, eighth, or sixteenth notes; chords supported.
- String numbering is musician-facing: 1 is the top tab line, 5 is the bottom.
- Fifth-string frets are relative to its own nut: 0 sounds G4, 2 sounds A4. **Physical neck fret numbering is not supported yet.**
- JSON can preserve rest beats. ASCII import cannot infer rests or durations from whitespace; ASCII export rejects rests and mixed-duration measures to avoid silent loss.
- The stored version-1 score format remains intentionally limited. Imported MusicXML/TEF previews additionally preserve explicit alternate tunings, chords, section text, fingering, hammer-ons, pull-offs, bends, and selected other techniques where the source format provides enough information.
- The score editor can change native notes and measures, and can edit imported title, tempo, tuning, note strings and frets, measure count, lyrics, chord names, section text, annotations, and supported techniques. Imported edits are applied to the source MusicXML before the score is saved, so untouched source metadata remains available when the score is reopened.

Vector PDF uploads are supported as a reviewable MusicXML preview. The recognizer preserves visible tablature, section labels, chord names, standalone lyrics, and nearby technique/fingering marks where the PDF geometry is clear. It warns when timing, tempo, chord voicings, diagrams, repeats, or other source-only metadata cannot be recovered. Scanned image PDFs are not supported yet. The bundled SoundFont is a starter sound, not an auditioned premium banjo library.

### Direct TEF uploads

Choose **Import a tab → Open a file** and select the original `.tef` or a vector `.pdf`. Rails first uses the native Ruby TEF parser for TEF files and sends PDF files to the bounded vector recognizer; both open as playable MusicXML previews. The pinned TuxGuitar converter remains as a bounded TEF fallback for formats or records the native path cannot handle. No separate conversion or XML file selection is needed.

The native path supports legacy TEF2 and modern TablEdit TEF 3.00 files with one five-string track, bounded file size and measure count, source time signatures, alternate tunings, fingering, verified note effects, tuplets, grace notes, ties, voices, tempo changes, and alternate endings. Unsupported or malformed files return an error without replacing the current score. Values without a verified MusicXML equivalent remain explicit technical metadata and conversion warnings remain visible. Raw TEF2 repeat maps and source-only layout records are retained as bounded warnings until their playback semantics are verified. Save an imported TEF or PDF preview to the library to preserve its generated MusicXML document, then reopen it with the imported tuning, rhythm, techniques, chords, sections, and lyrics intact. TEF2 and TablEdit TEF3 export is available with explicit loss warnings.

`docker compose up -d --build` builds and starts the TEF fallback converter along with the app. Its image downloads the pinned TuxGuitar 2.1.0 archive and verifies SHA-256; it does not depend on workstation `/tmp` installs. Rails handles vector PDF recognition in-process with the MIT-licensed Ruby `pdf-reader` gem and Nokogiri, so PDF uploads do not enter the converter container. Rails connects to the converter through `TEF_CONVERTER_URL` only for the bounded TEF fallback. The converter has no published port, uses an internal-only network, runs as an unprivileged user with a read-only filesystem, bounded temporary storage, memory/CPU/process limits, and a 15-second conversion deadline. Temporary uploads and XML are deleted after each conversion. This remains a local single-user prototype, not a hardened public upload service.

Test the converter with `python3 -m unittest discover -s converter -p 'test_*.py'`. Set `PLAYTAB_TEFSOURCE` to a private `.tef` path to enable the real browser upload/conversion/playback regression. Never commit private arrangements as fixtures.

Run `bundle exec ruby script/check_pdf_corpus.rb /private/path/to/pdfs` to scan a local vector-PDF corpus. Use `--manifest tmp/pdf-corpus/manifest.json` for a paired corpus report; the checker skips byte-identical duplicates and writes no source files to the repository.

### MusicXML preview

Import an uncompressed `.musicxml` or `.xml` file containing one five-string tablature part (up to 2 MB and 256 measures). Preview supports explicit alternate tuning and offers playback, MIDI, printing, download of the original XML, and saving the imported document to the library. It cannot be exported to the restricted JSON/plaintext format. Verified duplicate notation/TAB staves are combined for playback; independent staff music is rejected.

Explicit hammer-on/pull-off pairs are connected and labeled H/PO. The adapter repairs alphaTab 1.8.4's imported string lookup and start/stop handling; ambiguous, unpaired, or wrong-direction spans are rejected. Preview rendering and printing run on the main thread to preserve the renderer's custom PO label (a version-pinned internal field); normal v1 scores still use rendering workers. A version-pinned patch makes both H/PO slurs arch upward; `npm ci` applies it automatically. Synthetic technique tests cover both labels, resize, and print preview. Fretting-hand fingers 1–4 remain separate from fret/pitch and are shown as circled annotations above the tablature. Imported TEF previews retain a standalone Lyrics & chords section when the source has untimed lyrics text, with configurable measures per line and lyric columns for the print layout.

Playback tests verify pitch-changing MIDI events for imported slides and bends. H/PO currently soften the destination attack but still trigger another picked sample; realistic legato articulation is **not yet implemented**. General TEF technique fidelity and dedicated banjo articulations remain follow-up work.

This is an experimental preview, not lossless TEF import. `script/TefProbe.java` exercises separately installed TuxGuitar 2.1.0 libraries; `script/compare-tef.mjs XML REPORT` checks decoded note timing, duration, string, and fret against alphaTab's import. The probe fills explicit rests without reflowing note starts, then sorts beats before MusicXML export. Converter technique omissions still require review against the original. Private input and generated artifacts belong in ignored `tmp/`, never public fixtures.

The probe also restores TEF2 effect1=2 to TuxGuitar's shared hammer/pull flag and corrects descending exported technique pairs to MusicXML `pull-off`. It rejects ambiguous mappings and overlapping spans rather than guessing. This is still a bounded diagnostic converter, not a general TEF library.

TEF2 annotation-flagged records are normalized before decoding: annotation payloads are preserved separately and never added to frets or interpreted as ordinary effect bytes. Known codes 2 and 4 become circled fretting-hand fingers 1 and 3; code 6 becomes the visible right-hand thumb marker `T`. Other codes remain `other-technical` XML metadata with a preview warning. `script/TefAnnotationTest.java` tests the byte-level rule on synthetic records, including unchanged unflagged effects and original input preservation. Optional `PLAYTAB_CORRECTED_XML` plus `PLAYTAB_TEFSOURCE` enables an all-annotated-notes regression against the private TEF.

`script/review_musicxml.py INPUT_XML REVIEW_JSON OUTPUT_XML` applies explicit, human-reviewed fret/pitch/fingering corrections to both duplicate staves. Reviews are bound to the input XML SHA-256 and expected original note values. The original XML is retained; private review manifests and outputs belong in ignored `tmp/`. This workflow does not imply a general annotation-decoding fix.

To include the private conversion in browser checks, set `PLAYTAB_TEFPREVIEW_XML` to its absolute MusicXML path along with `PLAYTAB_URL`.

### TEF export

Use the export menu on a native library score or an imported and edited preview to choose TEF2 or TablEdit TEF3. Playtab writes one five-string track and preserves notes, tuning, rhythm, supported techniques, fingering, chord names, section text, and the standalone lyric page where the selected format has a corresponding field. The download reports any source details that the selected format cannot represent, including timed lyrics, independent voices, rests, and some layout techniques. TEF2 is limited to 4/4 measures and frets 0–24; choose TablEdit TEF3 for larger frets or changing time signatures.

## Checks

```sh
npm ci
npm run typecheck
npm test
npm run build
docker compose -f compose.yml exec -T web bash -c 'RAILS_ENV=test bundle exec rails db:prepare && bundle exec rails test'
docker compose -f compose.yml exec -T web bundle exec rubocop
docker compose -f compose.yml exec -T web bundle exec brakeman --no-pager
npx playwright install --with-deps chromium
npm run test:browser
```

Browser tests expect the development app running at localhost:3000 (`PLAYTAB_URL` overrides it). They exercise playback, imports, exports, and mobile layout without saving test songs to the development library. Screenshots are written to `tmp/`.

On this WSL machine, Chromium's missing ALSA library was extracted under `/tmp/playtab-browser-deps` without changing system packages. Until the system dependency is installed, run browser checks with `LD_LIBRARY_PATH=/tmp/playtab-browser-deps/usr/lib/x86_64-linux-gnu npm run test:browser`.

## Code map

- `app/frontend/music/`: independent score schema, ASCII parser/exporter, alphaTab adapter.
- `app/frontend/Player.tsx`: notation and audio lifecycle; React does not schedule audio.
- `app/services/score_document.rb`: server-side validation of the same bounded document contract.
- `app/models/song.rb`: JSONB score plus original plaintext source.
- `tests/unit/`: musical meaning and conversion checks.
- `test/`: database/API validation and persistence checks.

The schema is intentionally versioned. Expand it before attempting general TEF/MusicXML conversion; reject unsupported features rather than simplifying them silently.

Playback currently selects alphaTab's supported ScriptProcessor output: 1.8.4's AudioWorklet output has a start/pause race that surfaced in browser testing. Synthesis still runs in a worker. Revisit AudioWorklet output when upgrading alphaTab.

See [THIRD_PARTY.md](THIRD_PARTY.md) for asset attribution. The production Dockerfile includes a frontend build stage, but this prototype has not been deployed publicly.
