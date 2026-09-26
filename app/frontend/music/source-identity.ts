import { sourceTabNoteRecords } from './musicxml-editor';
import { readSourceDocument } from './xml-cache';

// These IDs belong to the editing session, not to MusicXML. They are saved in
// undo snapshots but never written into imported source or the song record.
export type SourceIdentityMap = {
  nextId: number;
  noteIds: string[];
  nextMeasureId: number;
  measureIds: string[];
  nextBeatId: number;
  beatIds: string[];
};
export type IdentityCarry = { id: string; address: string; kind?: 'note' | 'measure' | 'beat' };

function records(source: string) {
  const document = readSourceDocument(source);
  if (document.getElementsByTagName('parsererror').length || document.documentElement.localName !== 'score-partwise') {
    throw new Error('Invalid MusicXML for source identity mapping.');
  }
  return sourceTabNoteRecords(document);
}

function structureRecords(source: string) {
  const document = readSourceDocument(source);
  if (document.getElementsByTagName('parsererror').length || document.documentElement.localName !== 'score-partwise') {
    throw new Error('Invalid MusicXML for source identity mapping.');
  }
  const part = Array.from(document.getElementsByTagName('*')).find(node => node.localName === 'part');
  const measures = part ? Array.from(part.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'measure') : [];
  const tabStaff = Array.from(document.getElementsByTagName('*')).find(node => node.localName === 'staff-details'
    && Array.from(node.childNodes).some(item => item.nodeType === 1 && (item as Element).localName === 'staff-lines' && item.textContent?.trim() === '5'))?.getAttribute('number') ?? '1';
  const serializer = new XMLSerializer();
  const measureRecords = measures.map((measure, index) => {
    const copy = measure.cloneNode(true) as Element;
    copy.removeAttribute('number');
    return { address: String(index), signature: serializer.serializeToString(copy) };
  });
  const beatRecords = measures.flatMap((measure, measureIndex) => {
    const ordinalByVoice = new Map<string, number>();
    return Array.from(measure.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'note')
      .flatMap(note => {
        const children = Array.from(note.childNodes).filter((node): node is Element => node.nodeType === 1);
        const get = (name: string) => children.find(item => item.localName === name)?.textContent?.trim();
        if ((get('staff') || '1') !== tabStaff || children.some(item => item.localName === 'chord')) return [];
        const voice = get('voice') || '1';
        const ordinal = ordinalByVoice.get(voice) ?? 0;
        ordinalByVoice.set(voice, ordinal + 1);
        return [{ address: `${measureIndex}:${voice}:${ordinal}`, measure: measureIndex, voice, ordinal,
          signature: fingerprint(note, serializer) }];
      });
  });
  return { measureRecords, beatRecords };
}

function pushIndex(map: Map<string, number[]>, key: string, index: number) {
  map.set(key, [...(map.get(key) ?? []), index]);
}

function fingerprint(note: Element, serializer: XMLSerializer) {
  const copy = note.cloneNode(true) as Element;
  // Promoting the next chord member after deleting its anchor removes only
  // this positional marker; the surviving musical note is still the same.
  Array.from(copy.childNodes).filter(child => child.nodeType === 1 && (child as Element).localName === 'chord')
    .forEach(child => copy.removeChild(child));
  return serializer.serializeToString(copy);
}

// A changed beat count disables ordinal matching throughout that voice. An
// unchanged unique XML note can still carry its ID after a structural shift;
// repeated indistinguishable notes receive new IDs unless the command passes
// an explicit carry hint.
function laneCounts(source: string) {
  const document = readSourceDocument(source);
  const part = Array.from(document.getElementsByTagName('*')).find(node => node.localName === 'part');
  const measures = part ? Array.from(part.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'measure') : [];
  const tabStaff = Array.from(document.getElementsByTagName('*')).find(node => node.localName === 'staff-details'
    && Array.from(node.childNodes).some(item => item.nodeType === 1 && (item as Element).localName === 'staff-lines' && item.textContent?.trim() === '5'))?.getAttribute('number') ?? '1';
  const counts = new Map<string, number>();
  measures.forEach((measure, measureIndex) => {
    Array.from(measure.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'note').forEach(note => {
      const children = Array.from(note.childNodes).filter((node): node is Element => node.nodeType === 1);
      const get = (name: string) => children.find(item => item.localName === name)?.textContent?.trim();
      if ((get('staff') || '1') !== tabStaff || children.some(item => item.localName === 'chord')) return;
      const key = `${measureIndex}:${get('voice') || '1'}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  });
  return counts;
}

type StructuralRecord = { address: string; signature: string };

function reconcileStructure(
  kind: 'measure' | 'beat', oldRecords: StructuralRecord[], oldIds: string[], newRecords: StructuralRecord[], nextId: number,
  carries: IdentityCarry[], noteLinks: { oldAddress: string; newAddress: string }[],
) {
  if (oldRecords.length !== oldIds.length || new Set(oldIds).size !== oldIds.length) {
    throw new Error(`Source ${kind} identity map no longer matches the current imported score. Reopen it before editing.`);
  }
  const assigned: (string | undefined)[] = Array(newRecords.length).fill(undefined);
  const usedOld = new Set<number>();
  const oldByAddress = new Map(oldRecords.map((record, index) => [record.address, index]));
  const newByAddress = new Map(newRecords.map((record, index) => [record.address, index]));
  const assign = (oldIndex: number, newIndex: number) => {
    if (usedOld.has(oldIndex) || assigned[newIndex]) throw new Error(`Source ${kind} identity carry is ambiguous.`);
    assigned[newIndex] = oldIds[oldIndex];
    usedOld.add(oldIndex);
  };
  carries.filter(carry => carry.kind === kind).forEach(carry => {
    const oldIndex = oldIds.indexOf(carry.id);
    const newIndex = newByAddress.get(carry.address);
    if (oldIndex < 0 || newIndex === undefined) throw new Error(`The carried source ${kind} cannot be identified uniquely.`);
    assign(oldIndex, newIndex);
  });
  const oldToNew = new Map<number, Set<number>>();
  const newToOld = new Map<number, Set<number>>();
  noteLinks.forEach(link => {
    const oldIndex = oldByAddress.get(link.oldAddress);
    const newIndex = newByAddress.get(link.newAddress);
    if (oldIndex === undefined || newIndex === undefined) return;
    oldToNew.set(oldIndex, (oldToNew.get(oldIndex) ?? new Set()).add(newIndex));
    newToOld.set(newIndex, (newToOld.get(newIndex) ?? new Set()).add(oldIndex));
  });
  oldToNew.forEach((targets, oldIndex) => {
    if (targets.size !== 1) return;
    const newIndex = [...targets][0];
    if (newToOld.get(newIndex)?.size === 1 && !usedOld.has(oldIndex) && !assigned[newIndex]) assign(oldIndex, newIndex);
  });
  const oldBySignature = new Map<string, number[]>();
  const newBySignature = new Map<string, number[]>();
  oldRecords.forEach((record, index) => { if (!usedOld.has(index)) pushIndex(oldBySignature, record.signature, index); });
  newRecords.forEach((record, index) => { if (!assigned[index]) pushIndex(newBySignature, record.signature, index); });
  oldBySignature.forEach((oldIndexes, signature) => {
    const newIndexes = newBySignature.get(signature) ?? [];
    if (oldIndexes.length === 1 && newIndexes.length === 1) assign(oldIndexes[0], newIndexes[0]);
  });
  let next = nextId;
  const prefix = kind === 'measure' ? 'm' : 'e';
  return { ids: assigned.map(id => id ?? `${prefix}${next++}`), nextId: next };
}

export function createSourceIdentityMap(source: string): SourceIdentityMap {
  const count = records(source).length;
  const structure = structureRecords(source);
  return { nextId: count + 1, noteIds: Array.from({ length: count }, (_, index) => `n${index + 1}`),
    nextMeasureId: structure.measureRecords.length + 1,
    measureIds: structure.measureRecords.map((_, index) => `m${index + 1}`),
    nextBeatId: structure.beatRecords.length + 1,
    beatIds: structure.beatRecords.map((_, index) => `e${index + 1}`) };
}

export function sourceBeatIdsByAddress(source: string, identity: SourceIdentityMap): Map<string, string> {
  const beats = structureRecords(source).beatRecords;
  if (beats.length !== identity.beatIds.length) throw new Error('Source beat identity map no longer matches this score.');
  return new Map(beats.map((record, index) => [record.address, identity.beatIds[index]]));
}

export function sourceBeatCount(source: string, measure: number, voice: number): number {
  const prefix = `${measure}:${voice}:`;
  return structureRecords(source).beatRecords.filter(record => record.address.startsWith(prefix)).length;
}

export function reconcileSourceIdentityMap(beforeSource: string, before: SourceIdentityMap, afterSource: string, carries: IdentityCarry[] = []): SourceIdentityMap {
  if (beforeSource === afterSource) return before;
  const oldRecords = records(beforeSource);
  const newRecords = records(afterSource);
  const oldStructure = structureRecords(beforeSource);
  const newStructure = structureRecords(afterSource);
  if (oldRecords.length !== before.noteIds.length || new Set(before.noteIds).size !== before.noteIds.length) {
    throw new Error('Source identity map no longer matches the current imported score. Reopen the score before editing.');
  }
  const oldLanes = laneCounts(beforeSource);
  const newLanes = laneCounts(afterSource);
  const carriedMeasures = new Map(carries.filter(carry => carry.kind === 'measure').map(carry => [carry.id, carry.address]));
  const sameMeasure = (index: number) => oldStructure.measureRecords[index]?.signature === newStructure.measureRecords[index]?.signature
    || carriedMeasures.get(before.measureIds[index]) === String(index);
  const stableLane = (measure: number, voice: string) => oldLanes.get(`${measure}:${voice}`) === newLanes.get(`${measure}:${voice}`)
    && oldLanes.has(`${measure}:${voice}`) && oldLanes.size === newLanes.size && sameMeasure(measure);
  const assigned: (string | undefined)[] = Array(newRecords.length).fill(undefined);
  const usedOld = new Set<number>();
  const serializer = new XMLSerializer();
  const oldAddress = new Map<string, number[]>();
  const newAddress = new Map<string, number[]>();
  oldRecords.forEach((record, index) => pushIndex(oldAddress, record.id, index));
  newRecords.forEach((record, index) => pushIndex(newAddress, record.id, index));
  const assign = (oldIndex: number, newIndex: number) => {
    if (usedOld.has(oldIndex) || assigned[newIndex]) throw new Error('Source identity carry is ambiguous.');
    assigned[newIndex] = before.noteIds[oldIndex];
    usedOld.add(oldIndex);
  };
  carries.filter(carry => !carry.kind || carry.kind === 'note').forEach(carry => {
    const oldIndex = before.noteIds.indexOf(carry.id);
    const candidates = newAddress.get(carry.address) ?? [];
    if (oldIndex < 0 || candidates.length !== 1) throw new Error('The moved source note cannot be identified uniquely.');
    assign(oldIndex, candidates[0]);
  });
  oldAddress.forEach((oldIndexes, address) => {
    const newIndexes = newAddress.get(address) ?? [];
    if (oldIndexes.length !== 1 || newIndexes.length !== 1) return;
    const oldRecord = oldRecords[oldIndexes[0]];
    // Address alone is not identity: a replacement at the same ordinal position
    // must not inherit the removed note's ID. Changed notes need a command carry.
    if (stableLane(oldRecord.measure, oldRecord.voice)
      && fingerprint(oldRecord.note, serializer) === fingerprint(newRecords[newIndexes[0]].note, serializer)
      && !usedOld.has(oldIndexes[0]) && !assigned[newIndexes[0]]) assign(oldIndexes[0], newIndexes[0]);
  });
  const oldFingerprint = new Map<string, number[]>();
  const newFingerprint = new Map<string, number[]>();
  oldRecords.forEach((record, index) => { if (!usedOld.has(index)) pushIndex(oldFingerprint, fingerprint(record.note, serializer), index); });
  newRecords.forEach((record, index) => { if (!assigned[index]) pushIndex(newFingerprint, fingerprint(record.note, serializer), index); });
  oldFingerprint.forEach((oldIndexes, fingerprint) => {
    const newIndexes = newFingerprint.get(fingerprint) ?? [];
    if (oldIndexes.length === 1 && newIndexes.length === 1) assign(oldIndexes[0], newIndexes[0]);
  });
  let nextId = before.nextId;
  const noteIds = assigned.map(id => id ?? `n${nextId++}`);
  const oldById = new Map(before.noteIds.map((id, index) => [id, oldRecords[index]]));
  const measureLinks: { oldAddress: string; newAddress: string }[] = [];
  const beatLinks: { oldAddress: string; newAddress: string }[] = [];
  noteIds.forEach((id, index) => {
    const oldNote = oldById.get(id);
    const newNote = newRecords[index];
    if (!oldNote) return;
    measureLinks.push({ oldAddress: String(oldNote.measure), newAddress: String(newNote.measure) });
    beatLinks.push({ oldAddress: `${oldNote.measure}:${oldNote.voice}:${oldNote.beat}`,
      newAddress: `${newNote.measure}:${newNote.voice}:${newNote.beat}` });
  });
  const measures = reconcileStructure('measure', oldStructure.measureRecords, before.measureIds,
    newStructure.measureRecords, before.nextMeasureId, carries, measureLinks);
  const beatStructure = reconcileStructure('beat', oldStructure.beatRecords, before.beatIds,
    newStructure.beatRecords, before.nextBeatId, carries, beatLinks);
  return { nextId, noteIds, nextMeasureId: measures.nextId, measureIds: measures.ids,
    nextBeatId: beatStructure.nextId, beatIds: beatStructure.ids };
}
