import type { RootDatabase, Transaction } from "lmdb";
import { z } from "zod";

import { ChangeSequenceV2Schema, type ClipboardJournalChangeEventV2 } from "@pasteboard-pro/core";
import { readDeletedHeadV2, readTombstoneV2, tombstoneKeyV2 } from "./deletion-records.js";
import { storeErrorV2 } from "./errors.js";
import {
  canonicalJsonV2,
  isSnapshotStoreError,
  parseEventJsonV2,
  parseAttemptRecordV2,
  parseManifestJsonV2,
  parseReceiptJsonV2,
  sha256V2,
  tupleKeyV2,
  validateCommitV2,
  RawObjectBindingSchemaV2,
} from "./journal-validation.js";
import type { RawObjectBindingV2 } from "./types.js";

const IDENTIFIER = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);
export const JournalManifestRecordSchemaV2 = z.object({
  snapshotId: IDENTIFIER,
  manifestRevision: IDENTIFIER,
  manifestJson: z.string().max(8 * 1024 * 1024),
  sha256: SHA256,
}).strict();
export const JournalReceiptRecordSchemaV2 = z.object({
  receiptId: IDENTIFIER,
  snapshotId: IDENTIFIER,
  manifestRevision: IDENTIFIER,
  attemptId: IDENTIFIER,
  receiptJson: z.string().max(8 * 1024 * 1024),
  sha256: SHA256,
}).strict();
export const JournalRawRecordSchemaV2 = z.object({
  snapshotId: IDENTIFIER,
  manifestRevision: IDENTIFIER,
  bindings: z.array(RawObjectBindingSchemaV2).max(1024),
}).strict();
export const JournalHeadSchemaV2 = z.object({
  snapshotId: IDENTIFIER,
  manifestRevision: IDENTIFIER,
}).strict();
export const JournalReferenceSchemaV2 = z.object({
  snapshotId: IDENTIFIER,
  manifestRevision: IDENTIFIER,
  binding: RawObjectBindingSchemaV2,
}).strict();

export type JournalStateV2 = Readonly<{
  hostEpoch: string;
  headSeq: string;
  retentionFloor: string;
}>;

export const JOURNAL_META_V2 = Object.freeze({
  schema: "meta:schema",
  hostEpoch: "meta:hostEpoch",
  headSeq: "meta:headSeq",
  retentionFloor: "meta:retentionFloor",
});

export function manifestKeyV2(snapshotId: string, revision: string): string {
  return tupleKeyV2("manifest:", [snapshotId, revision]);
}
export function receiptKeyV2(receiptId: string): string {
  return "receipt:" + receiptId;
}
export function rawRecordKeyV2(snapshotId: string, revision: string): string {
  return tupleKeyV2("raw:", [snapshotId, revision]);
}
export function headKeyV2(snapshotId: string): string {
  return "head:" + snapshotId;
}
export function eventKeyV2(sequence: string): string {
  return "event:" + sequence.padStart(20, "0");
}
export function outboxKeyV2(sequence: string): string {
  return "outbox:" + sequence.padStart(20, "0");
}
export function attemptKeyV2(attemptId: string): string {
  return "attempt:" + attemptId;
}
export function referenceKeyV2(
  snapshotId: string,
  revision: string,
  representationKey: string,
): string {
  return tupleKeyV2("ref:", [snapshotId, revision, representationKey]);
}

export function parseStoredRecordV2<T>(json: string, schema: z.ZodType<T>): T {
  try {
    const value = JSON.parse(json) as unknown;
    const parsed = schema.safeParse(value);
    if (!parsed.success || canonicalJsonV2(parsed.data) !== json) {
      storeErrorV2("storage-corrupt");
    }
    return parsed.data;
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}

export function readJournalStateV2(get: (key: string) => string | undefined): JournalStateV2 {
  const schemaVersion = get(JOURNAL_META_V2.schema);
  const hostEpoch = get(JOURNAL_META_V2.hostEpoch);
  const headSeq = get(JOURNAL_META_V2.headSeq);
  const retentionFloor = get(JOURNAL_META_V2.retentionFloor);
  if (
    schemaVersion !== "2" ||
    typeof hostEpoch !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(hostEpoch) ||
    !ChangeSequenceV2Schema.safeParse(headSeq).success ||
    !ChangeSequenceV2Schema.safeParse(retentionFloor).success ||
    BigInt(retentionFloor as string) > BigInt(headSeq as string) + 1n
  ) storeErrorV2("storage-corrupt");
  return Object.freeze({
    hostEpoch,
    headSeq: headSeq as string,
    retentionFloor: retentionFloor as string,
  });
}

export function transactionRead<T>(
  db: RootDatabase<string, string>,
  callback: (transaction: Transaction) => T,
): T {
  const transaction = db.useReadTransaction();
  try {
    return callback(transaction);
  } finally {
    transaction.done();
  }
}

export function getInSnapshot(
  db: RootDatabase<string, string>,
  transaction: Transaction | undefined,
  key: string,
): string | undefined {
  const value: unknown = transaction ? db.get(key, { transaction }) : db.get(key);
  if (value === undefined) return undefined;
  if (typeof value !== "string") storeErrorV2("storage-corrupt");
  return value;
}

export function rangeInSnapshot(
  db: RootDatabase<string, string>,
  transaction: Transaction | undefined,
  start: string,
  end: string | undefined,
  limit?: number,
) {
  const snapshot = transaction === undefined ? {} : { transaction };
  const range = end === undefined
    ? { start, ...snapshot }
    : { start, end, ...snapshot };
  const options = limit === undefined ? range : { ...range, limit };
  return db.getRange(options);
}

export function readManifestRecord(
  db: RootDatabase<string, string>,
  transaction: Transaction | undefined,
  snapshotId: string,
  revision: string,
) {
  const stored = getInSnapshot(db, transaction, manifestKeyV2(snapshotId, revision));
  if (stored === undefined) return undefined;
  const record = parseStoredRecordV2(stored, JournalManifestRecordSchemaV2);
  if (record.snapshotId !== snapshotId || record.manifestRevision !== revision) {
    storeErrorV2("storage-corrupt");
  }
  if (sha256V2(record.manifestJson) !== record.sha256) storeErrorV2("storage-corrupt");
  const manifest = parseManifestJsonV2(record.manifestJson);
  if (manifest.snapshotId !== snapshotId || manifest.manifestRevision !== revision) {
    storeErrorV2("storage-corrupt");
  }
  return { record, manifest };
}

export function readReceiptRecord(
  db: RootDatabase<string, string>,
  transaction: Transaction | undefined,
  receiptId: string,
) {
  const stored = getInSnapshot(db, transaction, receiptKeyV2(receiptId));
  if (stored === undefined) return undefined;
  const record = parseStoredRecordV2(stored, JournalReceiptRecordSchemaV2);
  if (record.receiptId !== receiptId || sha256V2(record.receiptJson) !== record.sha256) {
    storeErrorV2("storage-corrupt");
  }
  const receipt = parseReceiptJsonV2(record.receiptJson);
  if (
    receipt.receiptId !== receiptId ||
    receipt.snapshotId !== record.snapshotId ||
    receipt.manifestRevision !== record.manifestRevision ||
    receipt.attemptId !== record.attemptId
  ) storeErrorV2("storage-corrupt");
  return { record, receipt };
}

export function readRawRecord(
  db: RootDatabase<string, string>,
  transaction: Transaction | undefined,
  snapshotId: string,
  revision: string,
) {
  const stored = getInSnapshot(db, transaction, rawRecordKeyV2(snapshotId, revision));
  if (stored === undefined) return undefined;
  const record = parseStoredRecordV2(stored, JournalRawRecordSchemaV2);
  if (record.snapshotId !== snapshotId || record.manifestRevision !== revision) {
    storeErrorV2("storage-corrupt");
  }
  return record;
}

export function readCapture(
  db: RootDatabase<string, string>,
  transaction: Transaction | undefined,
  snapshotId: string,
  revision: string,
  hostEpoch: string,
) {
  const manifestRecord = readManifestRecord(db, transaction, snapshotId, revision);
  if (!manifestRecord) return undefined;
  const receiptResult = readReceiptRecord(
    db,
    transaction,
    manifestRecord.manifest.policyReceiptId,
  );
  const rawRecord = readRawRecord(db, transaction, snapshotId, revision);
  if (!receiptResult || !rawRecord) storeErrorV2("storage-corrupt");
  if (
    receiptResult.record.snapshotId !== snapshotId ||
    receiptResult.record.manifestRevision !== revision
  ) storeErrorV2("storage-corrupt");

  try {
    validateCommitV2({
      manifest: manifestRecord.manifest,
      receipt: receiptResult.receipt,
      rawObjects: rawRecord.bindings,
      expectedManifestRevision: null,
    }, hostEpoch);
  } catch (error) {
    if (isSnapshotStoreError(error)) {
      const code = (error as { code: string }).code;
      if (code === "invalid-input" || code === "over-limit") storeErrorV2("storage-corrupt");
      throw error;
    }
    storeErrorV2("storage-corrupt");
  }

  for (const binding of rawRecord.bindings) {
    const key = referenceKeyV2(snapshotId, revision, binding.representationKey);
    const stored = getInSnapshot(db, transaction, key);
    if (stored === undefined) storeErrorV2("storage-corrupt");
    const reference = parseStoredRecordV2(stored, JournalReferenceSchemaV2);
    if (
      reference.snapshotId !== snapshotId ||
      reference.manifestRevision !== revision ||
      canonicalJsonV2(reference.binding) !== canonicalJsonV2(binding)
    ) storeErrorV2("storage-corrupt");
  }

  return {
    manifest: manifestRecord.manifest,
    receipt: receiptResult.receipt,
    bindings: rawRecord.bindings,
    manifestSha256: manifestRecord.record.sha256,
  };
}

/** Validate an immutable deletion even after its event index has been pruned. */
export function validateDeletionEventSourceV2(
  db: RootDatabase<string, string>,
  transaction: Transaction | undefined,
  event: Extract<ClipboardJournalChangeEventV2, { eventType: "delete" }>,
  hostEpoch: string,
) {
  const stored = readTombstoneV2(db, transaction, event.snapshotId, event.tombstoneRevision, hostEpoch);
  const deleted = readDeletedHeadV2(db, transaction, event.snapshotId, hostEpoch);
  if (!stored || !deleted || event.hostEpoch !== hostEpoch ||
      event.tombstoneRef !== tombstoneKeyV2(event.snapshotId, event.tombstoneRevision) ||
      event.tombstoneSha256 !== stored.sha256 ||
      canonicalJsonV2(deleted) !== canonicalJsonV2(stored.tombstone) ||
      !readCapture(db, transaction, event.snapshotId, stored.tombstone.previousManifestRevision, hostEpoch)) {
    storeErrorV2("storage-corrupt");
  }
  const attemptJson = getInSnapshot(db, transaction, attemptKeyV2(stored.tombstone.attemptId));
  if (attemptJson === undefined) storeErrorV2("storage-corrupt");
  const attempt = parseAttemptRecordV2(attemptJson);
  if (attempt.kind !== "deletion" || attempt.fingerprint !== sha256V2(canonicalJsonV2(stored.tombstone)) ||
      canonicalJsonV2(attempt.event) !== canonicalJsonV2(event)) storeErrorV2("storage-corrupt");
  return stored.tombstone;
}

export function sequenceFromKey(key: string, prefix: "event:" | "outbox:"): string {
  if (!key.startsWith(prefix)) storeErrorV2("storage-corrupt");
  const padded = key.slice(prefix.length);
  if (!/^[0-9]{20}$/.test(padded)) storeErrorV2("storage-corrupt");
  const sequence = BigInt(padded).toString();
  if (!ChangeSequenceV2Schema.safeParse(sequence).success) storeErrorV2("storage-corrupt");
  return sequence;
}

export function parseEventAtKey(
  db: RootDatabase<string, string>,
  transaction: Transaction | undefined,
  key: string,
  prefix: "event:" | "outbox:",
  hostEpoch: string,
): ClipboardJournalChangeEventV2 {
  const sequence = sequenceFromKey(key, prefix);
  const json = getInSnapshot(db, transaction, key);
  if (json === undefined) storeErrorV2("storage-corrupt");
  const event = parseEventJsonV2(json);
  if (event.changeSeq !== sequence || event.hostEpoch !== hostEpoch) {
    storeErrorV2("storage-corrupt");
  }
  if (event.eventType === "delete") validateDeletionEventSourceV2(db, transaction, event, hostEpoch);
  if (event.eventType === "upsert") {
    const capture = readCapture(db, transaction, event.snapshotId, event.manifestRevision, hostEpoch);
    if (
      !capture ||
      event.manifestRef !== manifestKeyV2(event.snapshotId, event.manifestRevision) ||
      capture.manifestSha256 !== event.manifestSha256
    ) storeErrorV2("storage-corrupt");
  }
  return event;
}



export function validateStoredCaptureV2(
  db: RootDatabase<string, string>,
  snapshotId: string,
  revision: string,
  hostEpoch: string,
): void {
  if (!readCapture(db, undefined, snapshotId, revision, hostEpoch)) {
    storeErrorV2("storage-corrupt");
  }
}

export function validateJournalEventEntryV2(
  db: RootDatabase<string, string>,
  key: string,
  prefix: "event:" | "outbox:",
  hostEpoch: string,
): ClipboardJournalChangeEventV2 {
  return parseEventAtKey(db, undefined, key, prefix, hostEpoch);
}

export function validateAttemptEventV2(
  db: RootDatabase<string, string>,
  transaction: Transaction | undefined,
  event: ClipboardJournalChangeEventV2,
  hostEpoch: string,
  headSeq: string,
  retentionFloor: string,
) {
  const sequence = BigInt(event.changeSeq);
  if (event.hostEpoch !== hostEpoch ||
      sequence < 1n || sequence > BigInt(headSeq)) {
    storeErrorV2("storage-corrupt");
  }

  if (event.eventType === "delete") validateDeletionEventSourceV2(db, transaction, event, hostEpoch);
  let capture: ReturnType<typeof readCapture>;
  if (event.eventType === "upsert") {
    capture = readCapture(db, transaction, event.snapshotId, event.manifestRevision, hostEpoch);
    if (!capture ||
        event.manifestRef !== manifestKeyV2(event.snapshotId, event.manifestRevision) ||
        event.manifestSha256 !== capture.manifestSha256) {
      storeErrorV2("storage-corrupt");
    }
  }

  const eventKey = eventKeyV2(event.changeSeq);
  const indexedEvent = getInSnapshot(db, transaction, eventKey);
  if (sequence >= BigInt(retentionFloor) || indexedEvent !== undefined) {
    const storedEvent = parseEventAtKey(db, transaction, eventKey, "event:", hostEpoch);
    if (canonicalJsonV2(storedEvent) !== canonicalJsonV2(event)) {
      storeErrorV2("storage-corrupt");
    }
  }

  const outboxKey = outboxKeyV2(event.changeSeq);
  if (getInSnapshot(db, transaction, outboxKey) !== undefined) {
    const outboxEvent = parseEventAtKey(db, transaction, outboxKey, "outbox:", hostEpoch);
    if (canonicalJsonV2(outboxEvent) !== canonicalJsonV2(event)) {
      storeErrorV2("storage-corrupt");
    }
  }
  return capture;
}
