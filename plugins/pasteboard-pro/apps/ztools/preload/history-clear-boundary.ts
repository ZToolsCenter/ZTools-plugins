import { createHash } from "node:crypto";
import type {
  HistoryClearBoundary,
  HostCursor,
  ZToolsDocumentDatabase,
} from "./clipboard-store-types";
import {
  compareCursor,
} from "./clipboard-host-normalization";
import {
  hasHistoryClearIdentity,
  MAX_HISTORY_CLEAR_IDENTITIES,
} from "./history-clear-identity";
import {
  getOptionalDocument,
  putWithConflictRetry,
} from "./clipboard-document-database";

const DOCUMENT_ID_PREFIX = "pasteboard-pro:history-clear-boundary:";
const DOCUMENT_TYPE = "pasteboard-pro-history-clear-boundary";
const MAX_ID_LENGTH = 4096;

type HistoryClearBoundaryDocument = Readonly<{
  _id: string;
  _rev?: string;
  type: typeof DOCUMENT_TYPE;
  schemaVersion: 1;
  deviceIdHash: string;
  through: HostCursor;
  clearedIdentities: readonly string[];
}>;

const CURSOR_IDENTITY_PATTERN = /^[0-9a-f]{64}$/u;

function invalidBoundary(): TypeError {
  return new TypeError("History clear boundary is invalid");
}

function boundaryCapacityExceeded(): RangeError {
  return new RangeError("History clear boundary capacity exceeded");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function wellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function normalizedDeviceId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    value.trim() !== value ||
    !wellFormedUnicode(value)
  ) {
    throw invalidBoundary();
  }
  return value;
}

function normalizeCursor(value: unknown): HostCursor | undefined {
  try {
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, "id") ||
      !Object.hasOwn(value, "timestamp")
    ) {
      return undefined;
    }

    const id = value.id;
    const timestamp = value.timestamp;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > MAX_ID_LENGTH ||
      id.trim() !== id ||
      typeof timestamp !== "number" ||
      !Number.isFinite(timestamp) ||
      !Number.isFinite(new Date(timestamp).getTime())
    ) {
      return undefined;
    }
    return { id, timestamp };
  } catch {
    return undefined;
  }
}

/** Validate and own the exact snapshot before any asynchronous operation. */
export function copyHistoryClearBoundary(value: unknown): HistoryClearBoundary {
  try {
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, "through") ||
      !Object.hasOwn(value, "clearedIdentities")
    ) {
      throw invalidBoundary();
    }

    const through = normalizeCursor(value.through);
    const identities = value.clearedIdentities;
    if (through === undefined || !Array.isArray(identities)) throw invalidBoundary();
    if (identities.length > MAX_HISTORY_CLEAR_IDENTITIES) {
      throw boundaryCapacityExceeded();
    }
    if (identities.length === 0) throw invalidBoundary();

    const copy: string[] = [];
    for (let index = 0; index < identities.length; index += 1) {
      const identity = identities[index];
      const previous = copy[index - 1];
      if (
        typeof identity !== "string" ||
        !CURSOR_IDENTITY_PATTERN.test(identity) ||
        (index > 0 && previous !== undefined && previous >= identity)
      ) {
        throw invalidBoundary();
      }
      copy.push(identity);
    }

    if (!hasHistoryClearIdentity(copy, through)) throw invalidBoundary();
    return {
      through: { id: through.id, timestamp: through.timestamp },
      clearedIdentities: copy,
    };
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message === "History clear boundary is invalid"
    ) {
      throw error;
    }
    if (
      error instanceof RangeError &&
      error.message === "History clear boundary capacity exceeded"
    ) {
      throw error;
    }
    throw invalidBoundary();
  }
}

function deviceIdentity(deviceId: unknown): Readonly<{ id: string; hash: string }> {
  const normalized = normalizedDeviceId(deviceId);
  const hash = createHash("sha256").update(normalized, "utf8").digest("hex");
  return { id: `${DOCUMENT_ID_PREFIX}${hash}`, hash };
}

function storedBoundary(
  value: unknown,
  expectedId: string,
  expectedDeviceHash: string,
): HistoryClearBoundary | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw invalidBoundary();

  const allowed = new Set([
    "_id",
    "_rev",
    "type",
    "schemaVersion",
    "deviceIdHash",
    "through",
    "clearedIdentities",
  ]);
  const revisionIsValid = !Object.hasOwn(value, "_rev") ||
    (typeof value._rev === "string" && value._rev.trim().length > 0);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    value._id !== expectedId ||
    !revisionIsValid ||
    value.type !== DOCUMENT_TYPE ||
    value.schemaVersion !== 1 ||
    value.deviceIdHash !== expectedDeviceHash
  ) {
    throw invalidBoundary();
  }
  return copyHistoryClearBoundary({
    through: value.through,
    clearedIdentities: value.clearedIdentities,
  });
}

export async function readHistoryClearBoundary(
  database: ZToolsDocumentDatabase,
  deviceId: string,
): Promise<HistoryClearBoundary | undefined> {
  const identity = deviceIdentity(deviceId);
  const document = await getOptionalDocument(database, identity.id);
  return storedBoundary(document, identity.id, identity.hash);
}

export async function advanceHistoryClearBoundary(
  database: ZToolsDocumentDatabase,
  deviceId: string,
  boundary: HistoryClearBoundary,
): Promise<void> {
  const identity = deviceIdentity(deviceId);
  const candidate = copyHistoryClearBoundary(boundary);

  await putWithConflictRetry(
    database,
    identity.id,
    (revision, currentDocument) => {
      const current = storedBoundary(currentDocument, identity.id, identity.hash);
      const through = current !== undefined &&
        compareCursor(current.through, candidate.through) > 0
        ? current.through
        : candidate.through;
      const clearedIdentities = unionIdentities(
        current?.clearedIdentities ?? [],
        candidate.clearedIdentities,
      );
      return {
        _id: identity.id,
        ...(revision === undefined ? {} : { _rev: revision }),
        type: DOCUMENT_TYPE,
        schemaVersion: 1,
        deviceIdHash: identity.hash,
        through: { id: through.id, timestamp: through.timestamp },
        clearedIdentities,
      } satisfies HistoryClearBoundaryDocument;
    },
  );
}

function unionIdentities(
  left: readonly string[],
  right: readonly string[],
): string[] {
  const result: string[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    const leftValue = left[leftIndex];
    const rightValue = right[rightIndex];
    let next: string;
    if (leftValue === undefined) {
      next = rightValue!;
      rightIndex += 1;
    } else if (rightValue === undefined) {
      next = leftValue;
      leftIndex += 1;
    } else if (leftValue < rightValue) {
      next = leftValue;
      leftIndex += 1;
    } else if (rightValue < leftValue) {
      next = rightValue;
      rightIndex += 1;
    } else {
      next = leftValue;
      leftIndex += 1;
      rightIndex += 1;
    }
    result.push(next);
    if (result.length > MAX_HISTORY_CLEAR_IDENTITIES) {
      throw boundaryCapacityExceeded();
    }
  }
  return result;
}
