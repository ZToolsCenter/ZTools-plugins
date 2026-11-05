import type { HostCursor, ZToolsDocumentDatabase } from "./clipboard-store-types";
import {
  getOptionalDocument,
  putWithConflictRetry,
} from "./clipboard-document-database";

export const MIRROR_IMAGE_RETRY_PROGRESS_ID = "pasteboard-pro:mirror-image-retry";
const DOCUMENT_TYPE = "pasteboard-pro-mirror-image-retry";
const MAX_CURSOR_ID_LENGTH = 4096;

type RetryProgressDocument = Readonly<{
  _id: string;
  _rev?: string;
  type: typeof DOCUMENT_TYPE;
  schemaVersion: 1;
  before: HostCursor | null;
}>;

function invalidProgress(): TypeError {
  return new TypeError("Mirror image retry progress is invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validCursor(value: unknown): value is HostCursor {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, "id") || !Object.hasOwn(value, "timestamp")) return false;
  return typeof value.id === "string" && value.id.length > 0 &&
    value.id.length <= MAX_CURSOR_ID_LENGTH && value.id.trim() === value.id &&
    typeof value.timestamp === "number" && Number.isFinite(value.timestamp) &&
    Number.isFinite(new Date(value.timestamp).getTime());
}

function storedBoundary(value: unknown): HostCursor | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw invalidProgress();
  const allowed = new Set(["_id", "_rev", "type", "schemaVersion", "before"]);
  if (Object.keys(value).some((key) => !allowed.has(key)) ||
      value._id !== MIRROR_IMAGE_RETRY_PROGRESS_ID ||
      (value._rev !== undefined &&
        (typeof value._rev !== "string" || value._rev.trim().length === 0)) ||
      value.type !== DOCUMENT_TYPE || value.schemaVersion !== 1 ||
      (value.before !== null && !validCursor(value.before))) {
    throw invalidProgress();
  }
  return value.before === null ? undefined : { ...value.before };
}

export async function readMirrorImageRetryBoundary(
  database: ZToolsDocumentDatabase,
): Promise<HostCursor | undefined> {
  return storedBoundary(await getOptionalDocument(database, MIRROR_IMAGE_RETRY_PROGRESS_ID));
}

export async function writeMirrorImageRetryBoundary(
  database: ZToolsDocumentDatabase,
  boundary: HostCursor | undefined,
): Promise<void> {
  if (boundary !== undefined && !validCursor(boundary)) throw invalidProgress();
  const before: HostCursor | null = boundary === undefined
    ? null
    : { id: boundary.id, timestamp: boundary.timestamp };
  await readMirrorImageRetryBoundary(database);
  await putWithConflictRetry(database, MIRROR_IMAGE_RETRY_PROGRESS_ID, (revision) => ({
    _id: MIRROR_IMAGE_RETRY_PROGRESS_ID,
    ...(revision === undefined ? {} : { _rev: revision }),
    type: DOCUMENT_TYPE,
    schemaVersion: 1,
    before,
  } satisfies RetryProgressDocument));
}
