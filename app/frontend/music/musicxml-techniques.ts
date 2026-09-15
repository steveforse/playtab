import { Settings, type model } from '@coderline/alphatab';

type Marker = { bar: number; tick: number; staff: number; voice: string; string: number; fret: number; kind: string; type: string; number: string };
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
      for (const tag of children(technical)) {
        let kind = tag.localName;
        let number = tag.localName === 'fingering' ? tag.textContent?.trim() || '' : tag.getAttribute('number') || '1';
        if (tag.localName === 'other-technical') {
          const unresolved = tag.textContent?.match(/(?:Unresolved TEF fingering annotation code|TEF fingering code)\s+(\d+)/i);
          const thumb = tag.textContent?.match(/TEF fingering\s+T(?:humb)?$/i);
          if (!unresolved && !thumb) continue;
          kind = 'tef-fingering';
          number = unresolved?.[1] ?? 'T';
        }
        if (kind !== 'hammer-on' && kind !== 'pull-off' && kind !== 'fingering' && kind !== 'tef-fingering') continue;
        if (child(item, 'grace')) throw new Error('Grace-note techniques are not supported by this preview yet.');
        markers.push({ bar, tick: onset, staff: Number(value(item, 'staff') || 1) - 1, voice: value(item, 'voice') || '1',
          string: Number(value(technical, 'string')), fret: Number(value(technical, 'fret')),
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
  for (const marker of markers.filter(m => m.staff === staffIndex)) {
    const notes = tab.bars[marker.bar].voices.flatMap(v => v.beats.filter(b => Math.abs(b.playbackStart - marker.tick) < 0.01).flatMap(b => b.notes))
      .filter(n => n.string === 6 - marker.string && n.fret === marker.fret);
    if (notes.length !== 1) throw new Error('Cannot uniquely locate a MusicXML technique note.');
    const note = notes[0];
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
      const label = marker.number === '6' || marker.number === 'T' ? 'T' : `TEF ${marker.number}`;
      note.beat.text = [note.beat.text, label].filter(Boolean).join(' ');
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
