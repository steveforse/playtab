// Parsing a long MusicXML score costs tens of milliseconds, and the editor
// inspects the same revision many times per render. Read-only callers share
// one parsed Document per source string. These documents must never be
// mutated: commands that edit always parse their own fresh copy.
const cache = new Map<string, Document>();
const readOnly = new WeakSet<Document>();
const LIMIT = 6;

export function readSourceDocument(source: string): Document {
  const cached = cache.get(source);
  if (cached) {
    cache.delete(source);
    cache.set(source, cached);
    return cached;
  }
  const document = new DOMParser().parseFromString(source, 'application/xml');
  cache.set(source, document);
  readOnly.add(document);
  while (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
  return document;
}

export function isReadOnlyDocument(document: Document) {
  return readOnly.has(document);
}

// Memoizes a derived value for a shared read-only document only; a fresh,
// mutable document is always recomputed.
export function derived<T>(store: WeakMap<Document, T>, document: Document, compute: () => T): T {
  if (!readOnly.has(document)) return compute();
  if (!store.has(document)) store.set(document, compute());
  return store.get(document)!;
}
