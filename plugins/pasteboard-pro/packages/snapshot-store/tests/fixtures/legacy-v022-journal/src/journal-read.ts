import type { RootDatabase } from "lmdb";
import { z } from "zod";

import {
  ChangeSequenceV2Schema,
  type ClipboardJournalChangeEventV2,
  type ClipboardJournalReadResultV2,
  type ClipboardSnapshotManifestV2,
  type CaptureContentPolicyReceiptV2,
} from "@pasteboard-pro/core";
import { readDeletedHeadV2 } from "./deletion-records.js";
import { storeErrorV2 } from "./errors.js";
import {
  canonicalJsonV2,
  isSnapshotStoreError,
  parseEventJsonV2,
  parseManifestJsonV2,
  parseReadResultV2,
  parseReceiptJsonV2,
  validateReadRequestV2,
} from "./journal-validation.js";
import {
  eventKeyV2,
  getInSnapshot,
  headKeyV2,
  JournalHeadSchemaV2,
  manifestKeyV2,
  outboxKeyV2,
  parseEventAtKey,
  parseStoredRecordV2,
  rangeInSnapshot,
  readCapture,
  readJournalStateV2,
  readReceiptRecord,
  sequenceFromKey,
  transactionRead,
} from "./journal-records.js";
import { listReferencedObjectsInSnapshotV2 } from "./journal-roots.js";
import type { RawObjectBindingV2, SnapshotHeadV2 } from "./types.js";

const IDENTIFIER = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

function cloneManifest(value: ClipboardSnapshotManifestV2): ClipboardSnapshotManifestV2 {
  return parseManifestJsonV2(canonicalJsonV2(value));
}
function cloneReceipt(value: CaptureContentPolicyReceiptV2): CaptureContentPolicyReceiptV2 {
  return parseReceiptJsonV2(canonicalJsonV2(value));
}
function executeRead<T>(callback: () => T): T {
  try {
    return callback();
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}

export function createJournalReadMethodsV2(
  db: RootDatabase<string, string>,
  hostEpoch: string,
  ensureOpen: () => void,
): Readonly<{
  readChanges(request: unknown): ClipboardJournalReadResultV2;
  getManifest(snapshotId: string, manifestRevision: string): ClipboardSnapshotManifestV2 | undefined;
  getReceipt(receiptId: string): CaptureContentPolicyReceiptV2 | undefined;
  getRawObjects(snapshotId: string, manifestRevision: string): readonly RawObjectBindingV2[] | undefined;
  getHead(snapshotId: string): SnapshotHeadV2 | undefined;
  readOutbox(limit: number): readonly ClipboardJournalChangeEventV2[];
  listReferencedObjects(): readonly string[];
}> {
  const readChanges = (input: unknown): ClipboardJournalReadResultV2 => {
    ensureOpen();
    const request = validateReadRequestV2(input);
    return executeRead(() => transactionRead(db, (transaction) => {
      const state = readJournalStateV2((key) => getInSnapshot(db, transaction, key));
      if (request.hostEpoch !== state.hostEpoch) {
        return parseReadResultV2({
          status: "host-reset",
          expectedHostEpoch: request.hostEpoch,
          hostEpoch: state.hostEpoch,
          requestedCursor: request.after,
          retentionFloor: state.retentionFloor,
          reason: "host-epoch-changed",
        });
      }
      const after = BigInt(request.after);
      const latest = BigInt(state.headSeq);
      const floor = BigInt(state.retentionFloor);
      if (after > latest) storeErrorV2("invalid-input");
      if (floor > after + 1n) {
        return parseReadResultV2({
          status: "cursor-expired",
          hostEpoch,
          requestedCursor: request.after,
          retentionFloor: state.retentionFloor,
          reason: "retention",
        });
      }

      const events: ClipboardJournalChangeEventV2[] = [];
      let expected = after + 1n;
      if (expected <= latest) {
        const start = eventKeyV2(expected.toString());
        const headSequence = BigInt(state.headSeq);
        const end = headSequence === 18_446_744_073_709_551_615n
          ? "event;"
          : eventKeyV2((headSequence + 1n).toString());
        for (const entry of rangeInSnapshot(db, transaction, start, end, request.limit)) {
          if (typeof entry.key !== "string" || BigInt(sequenceFromKey(entry.key, "event:")) !== expected) {
            storeErrorV2("storage-corrupt");
          }
          const event = parseEventAtKey(db, transaction, entry.key, "event:", hostEpoch);
          events.push(event);
          expected += 1n;
        }
      }
      const nextCursor = events.length === 0
        ? request.after
        : events[events.length - 1]!.changeSeq;
      return parseReadResultV2({
        status: "ok",
        hostEpoch,
        after: request.after,
        nextCursor,
        retentionFloor: state.retentionFloor,
        latestChangeSeq: state.headSeq,
        limit: request.limit,
        events,
      });
    }));
  };

  const getManifest = (snapshotId: string, manifestRevision: string) => {
    ensureOpen();
    if (!IDENTIFIER.safeParse(snapshotId).success ||
        !IDENTIFIER.safeParse(manifestRevision).success) storeErrorV2("invalid-input");
    return executeRead(() => transactionRead(db, (transaction) => {
      const state = readJournalStateV2((key) => getInSnapshot(db, transaction, key));
      const capture = readCapture(db, transaction, snapshotId, manifestRevision, state.hostEpoch);
      return capture ? cloneManifest(capture.manifest) : undefined;
    }));
  };

  const getReceipt = (receiptId: string) => {
    ensureOpen();
    if (!IDENTIFIER.safeParse(receiptId).success) storeErrorV2("invalid-input");
    return executeRead(() => transactionRead(db, (transaction) => {
      const state = readJournalStateV2((key) => getInSnapshot(db, transaction, key));
      const result = readReceiptRecord(db, transaction, receiptId);
      if (!result) return undefined;
      const capture = readCapture(
        db, transaction, result.record.snapshotId, result.record.manifestRevision, state.hostEpoch,
      );
      if (!capture || capture.receipt.receiptId !== receiptId) storeErrorV2("storage-corrupt");
      return cloneReceipt(result.receipt);
    }));
  };

  const getRawObjects = (snapshotId: string, manifestRevision: string) => {
    ensureOpen();
    if (!IDENTIFIER.safeParse(snapshotId).success ||
        !IDENTIFIER.safeParse(manifestRevision).success) storeErrorV2("invalid-input");
    return executeRead(() => transactionRead(db, (transaction) => {
      const state = readJournalStateV2((key) => getInSnapshot(db, transaction, key));
      const capture = readCapture(db, transaction, snapshotId, manifestRevision, state.hostEpoch);
      if (!capture) return undefined;
      return Object.freeze(capture.bindings.map((binding) => Object.freeze({ ...binding })));
    }));
  };

  const getHead = (snapshotId: string) => {
    ensureOpen();
    if (!IDENTIFIER.safeParse(snapshotId).success) storeErrorV2("invalid-input");
    return executeRead(() => transactionRead(db, (transaction) => {
      const state = readJournalStateV2((key) => getInSnapshot(db, transaction, key));
      if (readDeletedHeadV2(db, transaction, snapshotId, state.hostEpoch)) return undefined;
      const json = getInSnapshot(db, transaction, headKeyV2(snapshotId));
      if (json === undefined) return undefined;
      const head = parseStoredRecordV2(json, JournalHeadSchemaV2);
      if (head.snapshotId !== snapshotId) storeErrorV2("storage-corrupt");
      const capture = readCapture(db, transaction, snapshotId, head.manifestRevision, state.hostEpoch);
      if (!capture) storeErrorV2("storage-corrupt");
      return Object.freeze({ snapshotId: head.snapshotId, manifestRevision: head.manifestRevision });
    }));
  };

  const readOutbox = (limit: number): readonly ClipboardJournalChangeEventV2[] => {
    ensureOpen();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) storeErrorV2("invalid-input");
    return executeRead(() => transactionRead(db, (transaction) => {
      const state = readJournalStateV2((key) => getInSnapshot(db, transaction, key));
      const events: ClipboardJournalChangeEventV2[] = [];
      if (BigInt(state.headSeq) > 0n) {
        const start = outboxKeyV2("1");
        const headSequence = BigInt(state.headSeq);
        const end = headSequence === 18_446_744_073_709_551_615n
          ? "outbox;"
          : outboxKeyV2((headSequence + 1n).toString());
        for (const entry of rangeInSnapshot(db, transaction, start, end, limit)) {
          if (typeof entry.key !== "string") storeErrorV2("storage-corrupt");
          events.push(parseEventAtKey(db, transaction, entry.key, "outbox:", state.hostEpoch));
        }
      }
      return Object.freeze(events.map((event) =>
        parseEventJsonV2(canonicalJsonV2(event))));
    }));
  };

  const listReferencedObjects = (): readonly string[] => {
    ensureOpen();
    return executeRead(() => transactionRead(db, (transaction) =>
      listReferencedObjectsInSnapshotV2(db, transaction, hostEpoch)));
  };

  return Object.freeze({
    readChanges,
    getManifest,
    getReceipt,
    getRawObjects,
    getHead,
    readOutbox,
    listReferencedObjects,
  });
}
