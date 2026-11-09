import { createHash } from "node:crypto";
import { getOptionalDocument, putWithConflictRetry } from "./clipboard-document-database";
import { compareCursor } from "./clipboard-host-normalization";
import { readHistoryClearBoundary } from "./history-clear-boundary";
import { hasHistoryClearIdentity, historyClearIdentity } from "./history-clear-identity";
import type { HistoryClearBoundary, HostCursor, ZToolsDocumentDatabase } from "./clipboard-store-types";
import type { MirroredImagePersistenceErrorCode } from "./mirrored-image";
import type { MirrorImageRetrySummary } from "./mirror-image-retry-types";

/** A new image could not be admitted; existing ledger data remains intact. */
export class MirrorImageRetryCapacityError extends Error {
  readonly code = "image-retry-capacity";
  constructor() {
    super("Clipboard image retry capacity exceeded");
    this.name = "MirrorImageRetryCapacityError";
  }
}

export const MAX_MIRROR_IMAGE_RETRY_ENTRIES = 4096;
export const MAX_MIRROR_IMAGE_RETRY_BYTES = 1024 * 1024;
const PREFIX = "pasteboard-pro:mirror-image-retry-journal:";
const TYPE = "pasteboard-pro-mirror-image-retry-journal";
// The host appends a revision after each put. Reserve enough encoded JSON
// space for it so a confirmed near-limit write remains readable afterwards.
const MAX_REVISION_JSON_BYTES = 2048;
const REASONS = new Set<MirroredImagePersistenceErrorCode>([
  "image-path-unavailable", "image-read-failed", "image-storage-failed",
  "image-verification-failed", "image-metadata-invalid",
]);
type RetryEntry = Readonly<{
  identity: string;
  cursor: HostCursor;
  state: "pending" | "failed";
  attempts: number;
  reason?: MirroredImagePersistenceErrorCode;
}>;

type JournalDocument = Readonly<{
  _id: string;
  _rev?: string;
  type: typeof TYPE;
  schemaVersion: 1;
  deviceIdHash: string;
  entries: readonly RetryEntry[];
}>;

function invalid(): TypeError { return new TypeError("Image retry journal is invalid"); }
function capacity(): RangeError { return new RangeError("Image retry journal capacity exceeded"); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}
function copyCursor(value: unknown): HostCursor {
  if (!isRecord(value) || !hasKeys(value, ["id", "timestamp"]) ||
      typeof value.id !== "string" || value.id.length === 0 || value.id.length > 4096 ||
      value.id.trim() !== value.id || typeof value.timestamp !== "number" ||
      !Number.isFinite(value.timestamp) || !Number.isFinite(new Date(value.timestamp).getTime())) throw invalid();
  return { id: value.id, timestamp: value.timestamp };
}
function deviceIdentity(deviceId: string): Readonly<{ id: string; hash: string }> {
  if (typeof deviceId !== "string" || !deviceId || deviceId.length > 4096 ||
      deviceId.trim() !== deviceId || /[\uD800-\uDFFF]/u.test(deviceId)) throw invalid();
  const hash = createHash("sha256").update(deviceId, "utf8").digest("hex");
  return { id: PREFIX + hash, hash };
}
function validateDocument(value: unknown, id: string, deviceHash: string): RetryEntry[] {
  if (value === undefined) return [];
  if (!isRecord(value) || !hasKeys(value, ["_id", "type", "schemaVersion", "deviceIdHash", "entries"], ["_rev"]) ||
      value._id !== id || value.type !== TYPE || value.schemaVersion !== 1 || value.deviceIdHash !== deviceHash ||
      (value._rev !== undefined && (typeof value._rev !== "string" || !value._rev.trim() ||
        Buffer.byteLength(JSON.stringify(value._rev), "utf8") > MAX_REVISION_JSON_BYTES)) ||
      !Array.isArray(value.entries)) throw invalid();
  if (value.entries.length > MAX_MIRROR_IMAGE_RETRY_ENTRIES ||
      Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_MIRROR_IMAGE_RETRY_BYTES) throw capacity();
  const rows: RetryEntry[] = [];
  for (const input of value.entries) {
    if (!isRecord(input) || !hasKeys(input, ["identity", "cursor", "state", "attempts"], ["reason"]) ||
        typeof input.identity !== "string" || !/^[0-9a-f]{64}$/u.test(input.identity) ||
        (input.state !== "pending" && input.state !== "failed") ||
        !Number.isSafeInteger(input.attempts) || (input.attempts as number) < 0) throw invalid();
    const cursor = copyCursor(input.cursor);
    if (historyClearIdentity(cursor) !== input.identity ||
        (rows.length > 0 && rows[rows.length - 1]!.identity >= input.identity) ||
        (input.state === "failed" && ((input.attempts as number) === 0 ||
          typeof input.reason !== "string" || !REASONS.has(input.reason as MirroredImagePersistenceErrorCode))) ||
        (input.state === "pending" && Object.hasOwn(input, "reason"))) throw invalid();
    rows.push({ identity: input.identity, cursor, state: input.state, attempts: input.attempts as number,
      ...(input.state === "failed" ? { reason: input.reason as MirroredImagePersistenceErrorCode } : {}) });
  }
  return rows;
}

/** Device-scoped metadata ledger; no clipboard bytes, source paths, or exception text. */
export class MirrorImageRetryJournal {
  private readonly identity: Readonly<{ id: string; hash: string }>;
  constructor(private readonly database: ZToolsDocumentDatabase, private readonly deviceId: string,
    private readonly ready: Promise<void> = Promise.resolve()) {
    this.identity = deviceIdentity(deviceId);
  }

  private async readEntries(): Promise<RetryEntry[]> {
    await this.ready;
    return validateDocument(await getOptionalDocument(this.database, this.identity.id), this.identity.id, this.identity.hash);
  }
  private async update(transform: (entries: RetryEntry[]) => RetryEntry[], admissionIdentity?: string): Promise<void> {
    await this.ready;
    await putWithConflictRetry(this.database, this.identity.id, (revision, current) => {
      const previous = validateDocument(current, this.identity.id, this.identity.hash);
      const admitting = admissionIdentity !== undefined && !previous.some((entry) => entry.identity === admissionIdentity);
      const entries = transform(previous);
      entries.sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
      const document: JournalDocument = { _id: this.identity.id, ...(revision === undefined ? {} : { _rev: revision }),
        type: TYPE, schemaVersion: 1, deviceIdHash: this.identity.hash, entries };
      // Reserve the largest supported future attempt count and failure reason
      // for newly admitted tasks. Otherwise a full journal could not record the
      // next attempt or failure and therefore could never drain safely.
      const budgetEntries = admitting ? entries.map((entry) => ({ ...entry, state: "failed" as const,
        attempts: Number.MAX_SAFE_INTEGER, reason: "image-verification-failed" as const })) : entries;
      const maximumRevisionDocument = { ...document, entries: budgetEntries,
        _rev: "x".repeat(MAX_REVISION_JSON_BYTES - 2) };
      if (entries.length > MAX_MIRROR_IMAGE_RETRY_ENTRIES ||
          Buffer.byteLength(JSON.stringify(maximumRevisionDocument), "utf8") > MAX_MIRROR_IMAGE_RETRY_BYTES) {
        if (admitting) throw new MirrorImageRetryCapacityError();
        throw capacity();
      }
      validateDocument(document, this.identity.id, this.identity.hash);
      return document;
    });
  }
  async readSummary(): Promise<MirrorImageRetrySummary> {
    const entries = await this.readEntries();
    const failed = entries.filter((entry) => entry.state === "failed").length;
    return { pending: entries.length - failed, failed, total: entries.length, capacity: MAX_MIRROR_IMAGE_RETRY_ENTRIES };
  }
  async observe(input: HostCursor): Promise<void> {
    const cursor = copyCursor(input), identity = historyClearIdentity(cursor);
    if ((await this.readEntries()).some((entry) => entry.identity === identity)) return;
    await this.update((entries) => entries.some((entry) => entry.identity === identity) ? entries :
      [...entries, { identity, cursor, state: "pending", attempts: 0 }], identity);
  }
  async begin(input: HostCursor): Promise<void> {
    const cursor = copyCursor(input), identity = historyClearIdentity(cursor);
    await this.update((entries) => {
      if (!entries.some((entry) => entry.identity === identity)) throw invalid();
      return entries.map((entry) => {
        if (entry.identity !== identity) return entry;
        if (entry.attempts >= Number.MAX_SAFE_INTEGER) throw capacity();
        return { identity, cursor, state: "pending", attempts: entry.attempts + 1 };
      });
    });
  }
  async fail(input: HostCursor, reason: MirroredImagePersistenceErrorCode): Promise<void> {
    const cursor = copyCursor(input), identity = historyClearIdentity(cursor);
    if (!REASONS.has(reason)) throw invalid();
    await this.update((entries) => {
      const found = entries.find((entry) => entry.identity === identity);
      if (!found || found.state !== "pending" || found.attempts < 1) throw invalid();
      return entries.map((entry) => entry.identity === identity ? { ...entry, state: "failed", reason } : entry);
    });
  }
  async complete(input: HostCursor): Promise<void> {
    const identity = historyClearIdentity(copyCursor(input));
    if (!(await this.readEntries()).some((entry) => entry.identity === identity)) return;
    await this.update((entries) => entries.filter((entry) => entry.identity !== identity));
  }
  /** Only attempted pending entries could have reached an unacknowledged local put. */
  async listReconciliationCandidates(): Promise<readonly HostCursor[]> {
    return (await this.readEntries())
      .filter((entry) => entry.state === "pending" && entry.attempts > 0)
      .map((entry) => ({ ...entry.cursor }));
  }
  async readClearBoundary(): Promise<HistoryClearBoundary | undefined> {
    const entries = await this.readEntries();
    if (!entries.length) return undefined;
    let through = entries[0]!.cursor;
    for (const entry of entries) if (compareCursor(entry.cursor, through) > 0) through = entry.cursor;
    return { through: { ...through }, clearedIdentities: entries.map((entry) => entry.identity) };
  }
  async clear(): Promise<void> {
    const entries = await this.readEntries();
    if (!entries.length) return;
    const boundary = await readHistoryClearBoundary(this.database, this.deviceId);
    if (!boundary) throw invalid();
    await this.update((current) => {
      if (current.some((entry) => !hasHistoryClearIdentity(boundary.clearedIdentities, entry.cursor))) throw invalid();
      return [];
    });
  }
}
