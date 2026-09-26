import { Settings, model } from '@coderline/alphatab';

type Marker = { bar: number; tick: number; staff: number; voice: string; string: number; fret: number; ghost?: boolean; grace?: boolean; kind: string; type: string; number: string };
type PlaytabBeat = model.Beat & { playtabFingerings?: string[]; playtabBaseText?: string };
const children = (node: Element) => Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1);
const child = (node: Element, name: string) => children(node).find(n => n.localName === name);
const value = (node: Element, name: string) => child(node, name)?.textContent ?? '';

// alphaTab 1.8.4 treats stop markers as starts and resolves techniques before
// imported string lookup tables are ready. Read explicit pairs separately.
export function extractTechniques(source: string) {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid MusicXML.');
  const lyricsField = Array.from(doc.getElementsByTagName('miscellaneous-field'))
    .find(field => field.getAttribute('name') === 'playtab-lyrics');
  const lyricsSection = lyricsField?.textContent?.replaceAll('\0', '').replace(/^\s*(?:LYRICS\s*&\s*CHORDS|CHORDS\s*&\s*LYRICS)\s*\r?\n?/i, '').trimEnd() || null;
  const markers: Marker[] = [];
  let divisions = 1;
  const part = child(doc.documentElement, 'part');
  if (!part) throw new Error('MusicXML has no part.');
  children(part).filter(n => n.localName === 'measure').forEach((measure, bar) => {
    let tick = 0, previousTick = 0;
    for (const item of children(measure)) {
      if (item.localName === 'attributes') divisions = Number(value(item, 'divisions')) || divisions;
      if (item.localName === 'backup') tick -= Number(value(item, 'duration')) * 960 / divisions;
      if (item.localName === 'forward') tick += Number(value(item, 'duration')) * 960 / divisions;
      if (item.localName !== 'note') continue;
      const onset = child(item, 'chord') ? previousTick : tick;
      if (!child(item, 'chord')) {
        previousTick = onset;
        tick += Number(value(item, 'duration')) * 960 / divisions;
      }
      const technical = child(item, 'notations') && child(child(item, 'notations')!, 'technical');
      if (!technical) continue;
      // A lone plain <bend> is Playtab's canonical Bend: reach the target by
      // the note midpoint and hold it. alphaTab would otherwise rise linearly
      // across the whole note. Bend-and-release pairs already import exactly.
      const bends = children(technical).filter(tag => tag.localName === 'bend');
      const bendAlter = bends.length === 1 && !bends[0].attributes.length && children(bends[0]).length === 1
        ? Number(value(bends[0], 'bend-alter')) : NaN;
      if ([1, 2, 3, 4].includes(bendAlter)) {
        markers.push({ bar, tick: onset, staff: Number(value(item, 'staff') || 1) - 1, voice: value(item, 'voice') || '1',
          string: Number(value(technical, 'string')), fret: Number(value(technical, 'fret')),
          ghost: child(item, 'notehead')?.getAttribute('parentheses') === 'yes', grace: Boolean(child(item, 'grace')),
          kind: 'playtab-bend', type: '', number: String(bendAlter) });
        technical.removeChild(bends[0]);
      }
      for (const tag of children(technical)) {
        let kind = tag.localName;
        let number = tag.localName === 'fingering' ? tag.textContent?.trim() || '' : tag.getAttribute('number') || '1';
        if (tag.localName === 'other-technical') {
          const unresolved = tag.textContent?.match(/(?:Unresolved TEF fingering annotation code|TEF fingering code)\s+(\d+)/i);
          const thumb = tag.textContent?.match(/TEF fingering\s+T(?:humb)?$/i);
          const rightHand = tag.textContent?.match(/TEF fingering\s+([IMPAC])$/i);
          const pdfRightHand = tag.textContent?.match(/TEF right-hand fingering\s+([mpt])$/i);
          const pdfStrum = tag.textContent?.match(/TEF strum\s+(up|down)$/i);
          const rake = tag.textContent?.match(/TEF rake/i);
          const printedTechnique = tag.textContent?.match(/TEF (slide|bend)\s+(.+)/i);
          if (rake) {
            kind = 'rake';
            number = 'R';
          } else if (pdfStrum) {
            kind = 'tef-strum';
            number = pdfStrum[1].toLowerCase();
          } else if (printedTechnique) {
            kind = `tef-${printedTechnique[1].toLowerCase()}`;
            number = printedTechnique[2].trim();
          } else {
            if (!unresolved && !thumb && !rightHand && !pdfRightHand) continue;
            kind = pdfRightHand ? 'tef-right-hand' : 'tef-fingering';
            number = unresolved?.[1] ?? (thumb ? 'T' : rightHand ? rightHand[1].toUpperCase() : pdfRightHand![1].toLowerCase());
          }
        }
        if (kind !== 'hammer-on' && kind !== 'pull-off' && kind !== 'fingering' && kind !== 'tef-fingering' && kind !== 'tef-right-hand' && kind !== 'rake' && kind !== 'tef-strum' && kind !== 'tef-slide' && kind !== 'tef-bend') continue;
        markers.push({ bar, tick: onset, staff: Number(value(item, 'staff') || 1) - 1, voice: value(item, 'voice') || '1',
          string: Number(value(technical, 'string')), fret: Number(value(technical, 'fret')),
          ghost: child(item, 'notehead')?.getAttribute('parentheses') === 'yes', grace: Boolean(child(item, 'grace')),
          kind, type: tag.getAttribute('type') || '', number });
        technical.removeChild(tag);
      }
    }
  });
  return { source: new XMLSerializer().serializeToString(doc), markers, lyricsSection };
}

export function applyTechniques(score: model.Score, tab: model.Staff, staffIndex: number, markers: Marker[]) {
  // MusicXML assigns string/fret after Beat.addNote; its lookup remains empty.
  for (const bar of tab.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
    beat.noteStringLookup.clear();
    for (const note of beat.notes) if (note.isStringed) beat.noteStringLookup.set(note.string, note);
  }
  const pending = new Map<string, model.Note>();
  const spans: { from: model.Note; to: model.Note; label: string }[] = [];
  const appendFingering = (note: model.Note, label: string) => {
    const beat = note.beat as PlaytabBeat;
    // Keep the beat's own words (such as a section label) and stack picking
    // fingerings above them, so a second fingering never drops the words.
    if (!beat.playtabFingerings) beat.playtabBaseText = beat.text ?? '';
    const fingerings = beat.playtabFingerings ?? [];
    if (!fingerings.includes(label)) fingerings.push(label);
    beat.playtabFingerings = fingerings;
    beat.text = [fingerings.join('\n'), beat.playtabBaseText].filter(Boolean).join('\n');
    if (label === 'T') note.leftHandFinger = 0;
  };
  const beatsInBar = (bar: number) => tab.bars[bar]?.voices.flatMap(v => v.beats) ?? [];
  for (const marker of markers.filter(m => m.staff === staffIndex)) {
    const beats = beatsInBar(marker.bar);
    const normalBeats = beats.filter(b => Math.abs(b.playbackStart - marker.tick) < 0.01);
    // A grace belongs to the ordinary beat at its source time; an
    // end-of-measure (after-)grace has none and forms the bar's trailing group.
    const targetBeats = marker.grace
      ? normalBeats.length ? normalBeats.flatMap(beat => beat.graceGroup?.beats ?? [])
        : beats.filter(beat => beat.graceType && beat.graceGroup && !beat.graceGroup.isComplete)
      : normalBeats;
    const notes = targetBeats.flatMap(b => b.notes)
      .filter(n => n.string === 6 - marker.string && n.fret === marker.fret && (marker.ghost === undefined || n.isGhost === marker.ghost));
    if (notes.length !== 1) {
      throw new Error(`Cannot uniquely locate a MusicXML technique note (bar ${marker.bar + 1}, tick ${marker.tick}, string ${marker.string}, fret ${marker.fret}, matches ${notes.length}).`);
    }
    const note = notes[0];
    if (marker.kind === 'playtab-bend') {
      const quarterTones = Number(marker.number) * 2;
      note.bendPoints = null;
      [[0, 0], [model.BendPoint.MaxPosition / 2, quarterTones], [model.BendPoint.MaxPosition, quarterTones]]
        .forEach(([offset, amount]) => note.addBendPoint(new model.BendPoint(offset, amount)));
      // An explicit type keeps finish() from reducing the hold to alphaTab's
      // linear two-point Bend; playback then follows these three points.
      note.bendType = model.BendType.Bend;
      continue;
    }
    if (marker.kind === 'fingering' && marker.number.toLowerCase() === 't') {
      note.leftHandFinger = model.Fingers.Thumb;
      note.beat.text = [note.beat.text, 'Ⓣ'].filter(Boolean).join(' ');
      continue;
    }
    if (marker.kind === 'fingering') {
      // MusicXML's numeric fretting-hand fingers are not piano finger numbers.
      const finger = Number(marker.number);
      if (!Number.isInteger(finger) || finger < 1 || finger > 4) throw new Error('Preview supports fretting-hand fingers 1–4.');
      note.leftHandFinger = finger;
      const annotation = ['①', '②', '③', '④'][finger - 1];
      note.beat.text = [note.beat.text, annotation].filter(Boolean).join(' ');
      continue;
    }
    if (marker.kind === 'tef-fingering') {
      if (marker.number === '6' || /^[IMT]$/.test(marker.number)) {
        const label = marker.number === '6' ? 'T' : marker.number;
        appendFingering(note, label);
      }
      else note.beat.text = [note.beat.text, `TEF ${marker.number}`].filter(Boolean).join(' ');
      continue;
    }
    if (marker.kind === 'tef-right-hand') {
      const label = marker.number === 'm' ? 'M' : 'T';
      appendFingering(note, label);
      continue;
    }
    if (marker.kind === 'rake') {
      note.beat.text = [note.beat.text, 'R'].filter(Boolean).join(' ');
      note.beat.brushType = model.BrushType.ArpeggioDown;
      continue;
    }
    if (marker.kind === 'tef-strum') {
      // AlphaTab names brush direction by the stroke gesture; its BrushDown
      // glyph is the one with the arrowhead at the top of the tab stem.
      note.beat.brushType = marker.number === 'up' ? model.BrushType.BrushDown : model.BrushType.BrushUp;
      continue;
    }
    if (marker.kind === 'tef-slide' || marker.kind === 'tef-bend') {
      if (marker.kind === 'tef-slide' && marker.number === '/') {
        note.slideInType = model.SlideInType.IntoFromBelow;
        continue;
      }
      note.beat.text = [note.beat.text, marker.number].filter(Boolean).join(' ');
      (note.beat as model.Beat & { playtabSlideAnnotation?: boolean }).playtabSlideAnnotation = true;
      continue;
    }
    const key = `${marker.voice}:${marker.string}:${marker.kind}:${marker.number}`;
    if (marker.type === 'start') {
      if (pending.has(key)) throw new Error('Overlapping MusicXML technique starts.');
      pending.set(key, note);
    } else if (marker.type === 'stop') {
      const from = pending.get(key);
      if (!from) throw new Error('Unpaired MusicXML technique stop.');
      pending.delete(key);
      let next = from.beat.nextBeat;
      while (next && !next.notes.some(n => n.string === from.string)) next = next.nextBeat;
      if (!next?.notes.includes(note)) throw new Error('Technique must end on the next note on the same string.');
      if (marker.kind === 'pull-off' ? from.fret <= note.fret : from.fret >= note.fret) throw new Error('Technique direction disagrees with the frets.');
      from.isHammerPullOrigin = true;
      from.beat.noteStringLookup.set(from.string, from);
      note.beat.noteStringLookup.set(note.string, note);
      spans.push({ from, to: note, label: marker.kind === 'pull-off' ? 'PO' : 'H' });
    } else throw new Error('Unsupported MusicXML technique marker.');
  }
  if (pending.size) throw new Error('Unpaired MusicXML technique start.');
  score.finish(new Settings());
  for (const { from, to } of spans) {
    if (from.hammerPullDestination !== to) throw new Error('Technique connection could not be preserved.');
  }
  // Version-pinned renderer bridge: custom slur text is internal in 1.8.4.
  // Main-thread rendering preserves it; workers do not serialize this field.
  for (const bar of tab.bars) for (const voice of bar.voices) for (const beat of voice.beats) for (const note of beat.notes) {
    const slur = (note as model.Note & { effectSlur?: { segments: { fromNote: model.Note; toNote: model.Note; text: string | null }[] } }).effectSlur;
    for (const segment of slur?.segments ?? []) {
      const span = spans.find(s => s.from === segment.fromNote && s.to === segment.toNote);
      if (span) segment.text = span.label;
    }
  }
}
