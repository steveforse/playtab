import { describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
vi.stubGlobal('DOMParser', DOMParser);
const { derived, isReadOnlyDocument, readSourceDocument } = await import('../../app/frontend/music/xml-cache');

describe('read-only MusicXML cache', () => {
  it('shares one parse per source, evicts the least recently used, and memoizes only shared documents', () => {
    const first = readSourceDocument('<score-partwise id="0"/>');
    expect(readSourceDocument('<score-partwise id="0"/>')).toBe(first);
    expect(isReadOnlyDocument(first)).toBe(true);
    for (let index = 1; index <= 6; index++) readSourceDocument(`<score-partwise id="${index}"/>`);
    expect(readSourceDocument('<score-partwise id="0"/>')).not.toBe(first);
    const store = new WeakMap<Document, number>();
    const compute = vi.fn(() => 42);
    const shared = readSourceDocument('<score-partwise id="shared"/>');
    expect(derived(store, shared, compute)).toBe(42);
    expect(derived(store, shared, compute)).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1);
    const fresh = new DOMParser().parseFromString('<score-partwise/>', 'application/xml') as unknown as Document;
    derived(store, fresh, compute); derived(store, fresh, compute);
    expect(compute).toHaveBeenCalledTimes(3);
    expect(isReadOnlyDocument(fresh)).toBe(false);
  });
});
