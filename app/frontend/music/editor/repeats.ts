// Repeat regions and first/second endings.
import type { model } from '@coderline/alphatab';
import { child, children, descendants, directMeasures, parseDocument, readDocument, scorePart } from './xml';

export type RepeatRegion = { start: number; end: number; count: number };

export function sourceRepeatRegions(measures: Element[]): RepeatRegion[] {
  const regions: RepeatRegion[] = [];
  let opening: number | null = null;
  for (const [index, measure] of measures.entries()) {
    for (const marker of descendants(measure, 'repeat')) {
      const direction = marker.getAttribute('direction');
      if (direction === 'forward') {
        if (opening !== null) throw new Error('Nested or overlapping imported repeats are preserved but cannot be edited here.');
        opening = index;
      } else if (direction === 'backward') {
        if (opening === null) throw new Error('An imported repeat end has no explicit start; redefine it before authoring another repeat.');
        const count = Number(marker.getAttribute('times') || '2');
        if (!Number.isInteger(count) || count < 2) throw new Error('An imported repeat has an unsupported play count.');
        regions.push({ start: opening, end: index, count });
        opening = null;
      } else throw new Error('An imported repeat has an unsupported direction.');
    }
  }
  if (opening !== null) throw new Error('An imported repeat start has no end; redefine it before authoring another repeat.');
  return regions;
}

export function inspectMusicXmlRepeats(source: string): RepeatRegion[] {
  const document = readDocument(source);
  const part = scorePart(document);
  if (!part) throw new Error('The repeat source has no music part.');
  return sourceRepeatRegions(directMeasures(part));
}

export function repeatBarline(document: Document, measure: Element, location: 'left' | 'right'): Element {
  let value = children(measure).find(item => item.localName === 'barline' && item.getAttribute('location') === location);
  if (!value) {
    value = document.createElement('barline'); value.setAttribute('location', location);
    if (location === 'left') measure.insertBefore(value, children(measure).find(item => item.localName === 'note') ?? null);
    else measure.appendChild(value);
  }
  return value;
}

export function addMusicXmlRepeat(source: string, score: model.Score, start: number, end: number, count: number): string {
  const document = parseDocument(source);
  const part = scorePart(document);
  const measures = part ? directMeasures(part) : [];
  if (!part || measures.length !== score.masterBars.length) throw new Error('The repeat source measures do not match the rendered score.');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= measures.length || start >= end) {
    throw new Error('Choose a repeat start before its end within this score.');
  }
  if (!Number.isInteger(count) || count < 2 || count > 8) throw new Error('Repeat count must be from 2 to 8.');
  const existing = sourceRepeatRegions(measures);
  const endingRanges = existing.map(region => knownRepeatEndings(measures, existing, region))
    .filter((item): item is RepeatEndings => item !== null);
  const endingMarkers = measures.reduce((total, measure) => total + descendants(measure, 'ending').length, 0);
  if (endingMarkers !== endingRanges.length * 4) {
    throw new Error('Existing repeat endings must be reviewed before adding another repeat.');
  }
  if (existing.some(region => start <= region.end && end >= region.start)) {
    throw new Error('Nested or overlapping repeat regions cannot be authored.');
  }
  if (endingRanges.some(item => start <= item.secondEnd && end >= item.firstStart)) {
    throw new Error('A new repeat cannot overlap existing first or second endings.');
  }
  const visits = measures.length + [...existing, { start, end, count }]
    .reduce((total, region) => total + (region.end - region.start + 1) * (region.count - 1), 0);
  if (visits > 4096) throw new Error('Repeat playback would exceed 4096 played measures.');
  const forward = document.createElement('repeat'); forward.setAttribute('direction', 'forward');
  repeatBarline(document, measures[start], 'left').appendChild(forward);
  const backward = document.createElement('repeat'); backward.setAttribute('direction', 'backward');
  backward.setAttribute('times', String(count));
  repeatBarline(document, measures[end], 'right').appendChild(backward);
  return new XMLSerializer().serializeToString(document);
}

export function addMusicXmlEndings(source: string, score: model.Score, repeatStart: number, repeatEnd: number,
  firstStart: number, secondEnd: number): string {
  const document = parseDocument(source);
  const part = scorePart(document);
  const measures = part ? directMeasures(part) : [];
  if (measures.length !== score.masterBars.length) throw new Error('The ending source measures do not match the rendered score.');
  const regions = sourceRepeatRegions(measures);
  const region = regions.find(item => item.start === repeatStart && item.end === repeatEnd);
  if (!region) throw new Error('Choose a known repeat region before adding endings.');
  if (region.count !== 2) throw new Error('First and second endings require a repeat count of 2.');
  if (!Number.isInteger(firstStart) || firstStart < repeatStart || firstStart > repeatEnd) {
    throw new Error('The first ending must start inside its repeat and end at the backward-repeat measure.');
  }
  const secondStart = repeatEnd + 1;
  if (!Number.isInteger(secondEnd) || secondEnd < secondStart || secondEnd >= measures.length) {
    throw new Error('The second ending must start immediately after the repeat and end within this score.');
  }
  if (regions.some(item => item !== region && item.start <= secondEnd && item.end >= firstStart)) {
    throw new Error('Ending measures cannot overlap another repeat.');
  }
  if (measures.slice(firstStart, secondEnd + 1).some(measure => descendants(measure, 'ending').length)) {
    throw new Error('Imported endings in this range must be reviewed before authoring new endings.');
  }
  const ending = (measure: Element, location: 'left' | 'right', number: string, type: 'start' | 'stop') => {
    const marker = document.createElement('ending'); marker.setAttribute('number', number); marker.setAttribute('type', type);
    const barline = repeatBarline(document, measure, location);
    if (type === 'stop') barline.insertBefore(marker, child(barline, 'repeat') ?? null);
    else barline.appendChild(marker);
  };
  ending(measures[firstStart], 'left', '1', 'start');
  ending(measures[repeatEnd], 'right', '1', 'stop');
  ending(measures[secondStart], 'left', '2', 'start');
  ending(measures[secondEnd], 'right', '2', 'stop');
  return new XMLSerializer().serializeToString(document);
}

export type RepeatEndings = { firstStart: number; firstEnd: number; secondStart: number; secondEnd: number };

export function knownRepeatEndings(measures: Element[], regions: RepeatRegion[], region: RepeatRegion): RepeatEndings | null {
  const nextStart = regions.filter(item => item.start > region.end).map(item => item.start).sort((a, b) => a - b)[0] ?? measures.length;
  const markers = measures.slice(region.start, nextStart).flatMap((measure, offset) =>
    descendants(measure, 'ending').map(ending => ({ measure: region.start + offset,
      location: ending.parentElement?.getAttribute('location'), number: ending.getAttribute('number'),
      type: ending.getAttribute('type') })));
  if (!markers.length) return null;
  const first = markers.find(item => item.number === '1' && item.type === 'start');
  const secondStop = markers.find(item => item.number === '2' && item.type === 'stop');
  const expected = first && secondStop && [
    { measure: first.measure, location: 'left', number: '1', type: 'start' },
    { measure: region.end, location: 'right', number: '1', type: 'stop' },
    { measure: region.end + 1, location: 'left', number: '2', type: 'start' },
    { measure: secondStop.measure, location: 'right', number: '2', type: 'stop' },
  ];
  if (!expected || region.count !== 2 || first.measure < region.start || first.measure > region.end
    || secondStop.measure <= region.end || markers.length !== 4
    || !expected.every(item => markers.some(marker => Object.keys(item).every(key =>
      marker[key as keyof typeof marker] === item[key as keyof typeof item])))) {
    throw new Error('This imported ending map is preserved but cannot be edited safely.');
  }
  return { firstStart: first.measure, firstEnd: region.end, secondStart: region.end + 1, secondEnd: secondStop.measure };
}

export function inspectMusicXmlRepeatEndings(source: string, start: number, end: number): RepeatEndings | null {
  const document = readDocument(source);
  const part = scorePart(document);
  if (!part) throw new Error('The repeat source has no music part.');
  const measures = directMeasures(part);
  const regions = sourceRepeatRegions(measures);
  const region = regions.find(item => item.start === start && item.end === end);
  if (!region) throw new Error('The selected repeat region cannot be identified.');
  return knownRepeatEndings(measures, regions, region);
}

export function removeMusicXmlRepeat(source: string, score: model.Score, start: number, end: number): string {
  const document = parseDocument(source);
  const part = scorePart(document);
  const measures = part ? directMeasures(part) : [];
  if (measures.length !== score.masterBars.length) throw new Error('The repeat source measures do not match the rendered score.');
  const regions = sourceRepeatRegions(measures);
  const region = regions.find(item => item.start === start && item.end === end);
  if (!region) throw new Error('The selected repeat region cannot be identified.');
  const endings = knownRepeatEndings(measures, regions, region);
  const removeMarker = (measure: number, tag: 'repeat' | 'ending', location: 'left' | 'right',
    attributes: Record<string, string>) => {
    const barline = children(measures[measure]).find(item => item.localName === 'barline' && item.getAttribute('location') === location);
    const marker = barline && children(barline).find(item => item.localName === tag &&
      Object.entries(attributes).every(([key, value]) => item.getAttribute(key) === value));
    if (!marker || !barline) throw new Error('The repeat endpoint changed before removal.');
    barline.removeChild(marker);
    if (!children(barline).length) barline.parentNode?.removeChild(barline);
  };
  removeMarker(region.start, 'repeat', 'left', { direction: 'forward' });
  removeMarker(region.end, 'repeat', 'right', { direction: 'backward' });
  if (endings) {
    removeMarker(endings.firstStart, 'ending', 'left', { number: '1', type: 'start' });
    removeMarker(endings.firstEnd, 'ending', 'right', { number: '1', type: 'stop' });
    removeMarker(endings.secondStart, 'ending', 'left', { number: '2', type: 'start' });
    removeMarker(endings.secondEnd, 'ending', 'right', { number: '2', type: 'stop' });
  }
  return new XMLSerializer().serializeToString(document);
}
