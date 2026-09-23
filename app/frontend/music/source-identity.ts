import { sourceTabNoteRecords } from './musicxml-editor';

// These IDs belong to the editing session, not to MusicXML. They are saved in
// undo snapshots but never written into imported source or the song record.
export type SourceIdentityMap = { nextId: number; noteIds: string[] };
export type IdentityCarry = { id: string; address: string };

function records(source: string) {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length || document.documentElement.localName !== 'score-partwise') {
    throw new Error('Invalid MusicXML for source identity mapping.');
  }
  return sourceTabNoteRecords(document);
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

// A changed event count disables ordinal matching throughout that voice. An
// unchanged unique XML note can still carry its ID after a structural shift;
// repeated indistinguishable notes receive new IDs unless the command passes
// an explicit carry hint.
function laneCounts(source: string) {
  const document = new DOMParser().parseFromString(source, 'application/xml');
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

export function createSourceIdentityMap(source: string): SourceIdentityMap {
  const count = records(source).length;
  return { nextId: count + 1, noteIds: Array.from({ length: count }, (_, index) => `n${index + 1}`) };
}

export function reconcileSourceIdentityMap(beforeSource: string, before: SourceIdentityMap, afterSource: string, carries: IdentityCarry[] = []): SourceIdentityMap {
  if (beforeSource === afterSource) return before;
  const oldRecords = records(beforeSource);
  const newRecords = records(afterSource);
  if (oldRecords.length !== before.noteIds.length || new Set(before.noteIds).size !== before.noteIds.length) {
    throw new Error('Source identity map no longer matches the current imported score. Reopen the score before editing.');
  }
  const oldLanes = laneCounts(beforeSource);
  const newLanes = laneCounts(afterSource);
  const stableLane = (measure: number, voice: string) => oldLanes.get(`${measure}:${voice}`) === newLanes.get(`${measure}:${voice}`)
    && oldLanes.has(`${measure}:${voice}`) && oldLanes.size === newLanes.size;
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
  carries.forEach(carry => {
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
  return { nextId: nextId + assigned.filter(id => !id).length,
    noteIds: assigned.map(id => id ?? `n${nextId++}`) };
}
