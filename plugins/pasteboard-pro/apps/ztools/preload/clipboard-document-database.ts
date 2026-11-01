import type { ZToolsDocumentDatabase } from "./clipboard-store-types";

type DatabaseDocument = Record<string, unknown>;

/** The promise based database API exposed by the ZTools host. */
export interface RawZToolsDocumentDatabase {
  get(id: string): Promise<unknown>;
  put(document: DatabaseDocument): Promise<unknown>;
  allDocs(key?: string | string[]): Promise<unknown>;
  remove(document: unknown): Promise<unknown>;
}

const checkedDatabaseCache = new WeakMap<
  RawZToolsDocumentDatabase,
  ZToolsDocumentDatabase
>();

class CheckedDatabaseError extends Error {
  readonly status: number;
  readonly statusCode: number;

  constructor(status: number) {
    super(status === 409 ? "Database conflict" : status === 404 ? "Document not found" : "Storage operation failed");
    this.name = "ZToolsDatabaseError";
    this.status = status;
    this.statusCode = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function statusFrom(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const status = value.status ?? value.statusCode;
  if (status === 404 || status === 409) return status;
  if (value.name === "not_found") return 404;
  if (value.name === "conflict") return 409;
  return undefined;
}

function isFailedResult(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    !("_id" in value) &&
    (value.error === true || value.ok === false ||
      value.name === "conflict" || value.name === "not_found")
  );
}

function errorFor(value: unknown): CheckedDatabaseError {
  return new CheckedDatabaseError(statusFrom(value) ?? 500);
}

function requirePositiveAck(value: unknown, expectedId: string): void {
  if (isFailedResult(value)) throw errorFor(value);
  if (!isRecord(value)) throw new CheckedDatabaseError(500);

  const allowedKeys = new Set(["ok", "id", "rev", "error"]);
  const hasUnknownKey = Object.keys(value).some((key) => !allowedKeys.has(key));
  const validRevision = typeof value.rev === "string" && value.rev.trim().length > 0;
  if (
    hasUnknownKey ||
    value.ok !== true ||
    value.id !== expectedId ||
    !validRevision ||
    ("error" in value && value.error !== false)
  ) {
    throw new CheckedDatabaseError(500);
  }
}

function requireRemoveAck(value: unknown, expectedId: string): void {
  if (isFailedResult(value)) throw errorFor(value);
  if (!isRecord(value)) throw new CheckedDatabaseError(500);

  const allowedKeys = new Set(["ok", "id", "rev", "error"]);
  const hasUnknownKey = Object.keys(value).some((key) => !allowedKeys.has(key));
  const validRevision = value.rev === undefined ||
    (typeof value.rev === "string" && value.rev.trim().length > 0);
  if (
    hasUnknownKey ||
    value.ok !== true ||
    value.id !== expectedId ||
    !validRevision ||
    ("error" in value && value.error !== false)
  ) {
    throw new CheckedDatabaseError(500);
  }
}

function checkedError(error: unknown): CheckedDatabaseError {
  return errorFor(error);
}

function requireDocumentId(value: unknown, expectedId?: string): string {
  const id = isRecord(value) ? value._id : undefined;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    (expectedId !== undefined && expectedId !== id)
  ) {
    throw new CheckedDatabaseError(500);
  }
  return id;
}

function removalEnvelope(
  document: unknown,
  expectedId?: string,
): string | Readonly<{ _id: string; _rev: string }> {
  if (typeof document === "string") {
    if (document.length === 0 || (expectedId !== undefined && expectedId !== document)) {
      throw new CheckedDatabaseError(500);
    }
    return document;
  }

  const id = requireDocumentId(document, expectedId);
  if (
    !isRecord(document) ||
    typeof document._rev !== "string" ||
    document._rev.trim().length === 0
  ) {
    throw new CheckedDatabaseError(500);
  }
  return { _id: id, _rev: document._rev };
}

function nativeOptions(options: Readonly<Record<string, unknown>>):
  | Readonly<{ kind: "prefix"; key: string; endkey: string }>
  | Readonly<{ kind: "keys"; keys: string[] }> {
  if (options.include_docs !== true) throw new CheckedDatabaseError(500);

  if (
    typeof options.startkey === "string" &&
    options.endkey === `${options.startkey}\uffff` &&
    Object.keys(options).every((key) => ["include_docs", "startkey", "endkey"].includes(key))
  ) {
    return { kind: "prefix", key: options.startkey, endkey: options.endkey };
  }

  if (
    Array.isArray(options.keys) &&
    options.keys.every((key) => typeof key === "string" && key.length > 0) &&
    Object.keys(options).every((key) => ["include_docs", "keys"].includes(key))
  ) {
    return { kind: "keys", keys: [...options.keys] as string[] };
  }

  throw new CheckedDatabaseError(500);
}

function nativeDocuments(
  value: unknown,
  selection: ReturnType<typeof nativeOptions>,
): DatabaseDocument[] {
  if (isFailedResult(value)) throw errorFor(value);
  if (!Array.isArray(value)) throw new CheckedDatabaseError(500);

  const selectedIds = selection.kind === "keys" ? new Set(selection.keys) : undefined;
  const result: DatabaseDocument[] = [];
  for (const document of value) {
    if (!isRecord(document) || typeof document._id !== "string") {
      throw new CheckedDatabaseError(500);
    }
    const inRange = selection.kind === "prefix"
      ? document._id.startsWith(selection.key) && document._id <= selection.endkey
      : selectedIds!.has(document._id);
    if (inRange) result.push(document);
  }
  return result;
}

/**
 * Adapt ZTools' native key-based allDocs API to the plugin's old Pouch-style
 * options port, while rejecting host error objects and unconfirmed writes.
 */
export function createCheckedZToolsDocumentDatabase(
  raw: RawZToolsDocumentDatabase,
): ZToolsDocumentDatabase {
  const cached = checkedDatabaseCache.get(raw);
  if (cached !== undefined) return cached;

  const checked: ZToolsDocumentDatabase = {
    get: async (id) => {
      try {
        const value = await raw.get(id);
        if (isFailedResult(value)) throw errorFor(value);
        if (value === null) return undefined;
        if (
          !isRecord(value) ||
          value._id !== id ||
          typeof value._rev !== "string" ||
          value._rev.trim().length === 0
        ) {
          throw new CheckedDatabaseError(500);
        }
        return value;
      } catch (error) {
        throw checkedError(error);
      }
    },
    put: async (document) => {
      const id = requireDocumentId(document);
      try {
        const result = await raw.put(document);
        requirePositiveAck(result, id);
        return result;
      } catch (error) {
        throw checkedError(error);
      }
    },
    allDocs: async (options) => {
      const selection = nativeOptions(options);
      try {
        const result = selection.kind === "prefix"
          ? await raw.allDocs(selection.key)
          : await raw.allDocs(selection.keys);
        return nativeDocuments(result, selection);
      } catch (error) {
        throw checkedError(error);
      }
    },
    remove: async (document) => {
      const envelope = removalEnvelope(document);
      const id = typeof envelope === "string" ? envelope : envelope._id;
      try {
        const result = await raw.remove(envelope);
        requireRemoveAck(result, id);
        return result;
      } catch (error) {
        throw checkedError(error);
      }
    },
  };

  checkedDatabaseCache.set(raw, checked);
  return checked;
}

export function documentsFromAllDocs(
  result: unknown,
  errorMessage: string,
): unknown[] {
  if (Array.isArray(result)) return result;
  if (isRecord(result) && Array.isArray(result.rows)) {
    return result.rows.flatMap((row) =>
      isRecord(row) && "doc" in row ? [row.doc] : [],
    );
  }
  throw new TypeError(errorMessage);
}

export function documentRevision(value: unknown): string | undefined {
  return isRecord(value) && typeof value._rev === "string" && value._rev.trim().length > 0
    ? value._rev
    : undefined;
}

export function isDatabaseStatus(error: unknown, status: number): boolean {
  return statusFrom(error) === status;
}

export async function getOptionalDocument(
  database: ZToolsDocumentDatabase,
  id: string,
): Promise<unknown | undefined> {
  try {
    const document = await database.get(id);
    if (isFailedResult(document)) throw errorFor(document);
    return document === null || document === undefined ? undefined : document;
  } catch (error) {
    if (isDatabaseStatus(error, 404)) return undefined;
    throw checkedError(error);
  }
}

export async function putWithConflictRetry(
  database: ZToolsDocumentDatabase,
  id: string,
  build: (revision?: string, currentDocument?: unknown) => Record<string, unknown>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await getOptionalDocument(database, id);
    const document = build(documentRevision(current), current);
    if (document._id !== id) throw new CheckedDatabaseError(500);

    try {
      const result = await database.put(document);
      requirePositiveAck(result, id);
      return;
    } catch (error) {
      if (!isDatabaseStatus(error, 409) || attempt === 2) {
        throw checkedError(error);
      }
    }
  }

  throw new CheckedDatabaseError(409);
}

export async function removeDocument(
  database: ZToolsDocumentDatabase,
  document: unknown,
  expectedId?: string,
): Promise<void> {
  const envelope = removalEnvelope(document, expectedId);
  const id = typeof envelope === "string" ? envelope : envelope._id;
  if (database.remove === undefined) throw new CheckedDatabaseError(500);

  try {
    const result = await database.remove(envelope);
    requireRemoveAck(result, id);
  } catch (error) {
    if (isDatabaseStatus(error, 404)) return;
    throw checkedError(error);
  }
}
