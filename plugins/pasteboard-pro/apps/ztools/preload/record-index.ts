/** Shared by all canonical stores in one preload (including the sync store). */
const indexes = new WeakMap<object, {
  documents: Map<string, string>;
  changes: Set<string>;
}>();

function index(database: object) {
  let value = indexes.get(database);
  if (value === undefined) {
    value = { documents: new Map(), changes: new Set() };
    indexes.set(database, value);
  }
  return value;
}

export function rememberRecord(database: object, itemId: string, documentId: string): void {
  index(database).documents.set(itemId, documentId);
}

export function recordDocumentFor(database: object, itemId: string): string | undefined {
  return index(database).documents.get(itemId);
}

export function markRecordChanged(database: object, documentId: string): void {
  index(database).changes.add(documentId);
}

export function takeRecordChanges(database: object): string[] {
  const value = index(database);
  const changes = [...value.changes];
  value.changes.clear();
  return changes;
}
