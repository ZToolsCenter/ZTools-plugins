import type { RootDatabase } from "lmdb";
import {
  type ClipboardJournalChangeEventV2,
  type ClipboardSnapshotTombstoneV2,
} from "@pasteboard-pro/core";
import { storeErrorV2 } from "./errors.js";
import {
  canonicalJsonV2,
  isSnapshotStoreError,
  parseAttemptRecordV2,
  parseEventJsonV2,
  sha256V2,
} from "./journal-validation.js";
import {
  attemptKeyV2,
  eventKeyV2,
  headKeyV2,
  JournalHeadSchemaV2,
  JOURNAL_META_V2,
  outboxKeyV2,
  readCapture,
  readJournalStateV2,
  parseStoredRecordV2,
  transactionRead,
  validateAttemptEventV2,
} from "./journal-records.js";
import type { AttemptRecordV2 } from "./journal-validation.js";
import type { DeletionFaultPointV2, JournalCommitResultV2 } from "./types.js";
import {
  readDeletedHeadV2,
  readTombstoneV2,
  tombstoneKeyV2,
  validateTombstoneInputV2,
  validateTombstoneReadRequestV2,
  writeDeletedHeadV2,
  writeTombstoneRecordV2,
} from "./deletion-records.js";

type DatabaseV2 = RootDatabase<string, string>;
type AtomicWriteV2 = <T>(callback: () => T) => T;
type DeletionAttemptV2 = Readonly<{
  kind: "deletion";
  fingerprint: string;
  event: ClipboardJournalChangeEventV2;
}>;

const MAX_SEQUENCE_V2 = 18_446_744_073_709_551_615n;

function readString(db: DatabaseV2, key: string): string | undefined {
  const value: unknown = db.get(key);
  if (value === undefined) return undefined;
  if (typeof value !== "string") storeErrorV2("storage-corrupt");
  return value;
}

function nextSequence(current: string): string {
  const next = BigInt(current) + 1n;
  if (next > MAX_SEQUENCE_V2) storeErrorV2("over-limit");
  return next.toString();
}

function injectFault(
  fault: ((point: DeletionFaultPointV2) => void) | undefined,
  point: DeletionFaultPointV2,
): void {
  fault?.(point);
}

function buildDeletionEvent(
  tombstone: ClipboardSnapshotTombstoneV2,
  changeSeq: string,
  tombstoneSha256: string,
): ClipboardJournalChangeEventV2 {
  return parseEventJsonV2(canonicalJsonV2({
    hostEpoch: tombstone.hostEpoch,
    changeSeq,
    eventType: "delete",
    snapshotId: tombstone.snapshotId,
    tombstoneRevision: tombstone.tombstoneRevision,
    tombstoneRef: tombstoneKeyV2(tombstone.snapshotId, tombstone.tombstoneRevision),
    tombstoneSha256,
  }));
}

function readPriorAttempt(
  db: DatabaseV2,
  attemptId: string,
  hostEpoch: string,
  headSeq: string,
): AttemptRecordV2 | DeletionAttemptV2 | undefined {
  const json = readString(db, attemptKeyV2(attemptId));
  if (json === undefined) return undefined;
  const record = parseAttemptRecordV2(json);
  if (record.event.hostEpoch !== hostEpoch || BigInt(record.event.changeSeq) > BigInt(headSeq)) {
    storeErrorV2("storage-corrupt");
  }
  const kind: string = record.kind;
  return kind === "deletion"
    ? record as unknown as DeletionAttemptV2
    : record;
}

function validatePriorDeletion(
  db: DatabaseV2,
  hostEpoch: string,
  headSeq: string,
  retentionFloor: string,
  prior: DeletionAttemptV2,
  tombstone: ClipboardSnapshotTombstoneV2,
  fingerprint: string,
): ClipboardJournalChangeEventV2 {
  if (prior.fingerprint !== fingerprint || prior.event.eventType !== "delete" ||
      prior.event.snapshotId !== tombstone.snapshotId ||
      prior.event.tombstoneRevision !== tombstone.tombstoneRevision ||
      prior.event.tombstoneRef !== tombstoneKeyV2(tombstone.snapshotId, tombstone.tombstoneRevision)) {
    storeErrorV2("conflict");
  }
  validateAttemptEventV2(db, undefined, prior.event, hostEpoch, headSeq, retentionFloor);
  const stored = readTombstoneV2(db, undefined, tombstone.snapshotId,
    tombstone.tombstoneRevision, hostEpoch);
  if (!stored || stored.sha256 !== prior.event.tombstoneSha256 ||
      canonicalJsonV2(stored.tombstone) !== canonicalJsonV2(tombstone)) {
    storeErrorV2("storage-corrupt");
  }
  const deletedHead = readDeletedHeadV2(db, undefined, tombstone.snapshotId, hostEpoch);
  if (!deletedHead || canonicalJsonV2(deletedHead) !== canonicalJsonV2(tombstone)) {
    storeErrorV2("storage-corrupt");
  }
  return parseEventJsonV2(canonicalJsonV2(prior.event));
}

export function createJournalDeletionMethodsV2(
  db: DatabaseV2,
  hostEpoch: string,
  fault: ((point: DeletionFaultPointV2) => void) | undefined,
  ensureOpen: () => void,
  runWrite: AtomicWriteV2,
): Readonly<{
  commitDeletion(tombstone: ClipboardSnapshotTombstoneV2, guard: () => void): JournalCommitResultV2;
  getTombstone(snapshotId: string, tombstoneRevision: string): ClipboardSnapshotTombstoneV2 | undefined;
  getDeletedHead(snapshotId: string): ClipboardSnapshotTombstoneV2 | undefined;
}> {
  const commitDeletion = (input: unknown, guard: unknown): JournalCommitResultV2 => {
    ensureOpen();
    if (typeof guard !== "function") storeErrorV2("invalid-input");
    const tombstone = validateTombstoneInputV2(input, hostEpoch);
    const fingerprint = sha256V2(canonicalJsonV2(tombstone));
    return runWrite(() => {
      (guard as () => void)();
      const state = readJournalStateV2((key) => {
        const value: unknown = db.get(key);
        if (value === undefined) return undefined;
        if (typeof value !== "string") storeErrorV2("storage-corrupt");
        return value;
      });
      if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");

      const prior = readPriorAttempt(db, tombstone.attemptId, hostEpoch, state.headSeq);
      if (prior) {
        const priorKind: string = prior.kind;
        if (priorKind !== "deletion") storeErrorV2("conflict");
        const event = validatePriorDeletion(
          db, hostEpoch, state.headSeq, state.retentionFloor,
          prior as unknown as DeletionAttemptV2, tombstone, fingerprint,
        );
        return Object.freeze({ event, replayed: true });
      }

      const deleted = readDeletedHeadV2(db, undefined, tombstone.snapshotId, hostEpoch);
      if (deleted) {
        if (deleted.attemptId === tombstone.attemptId) storeErrorV2("storage-corrupt");
        storeErrorV2("conflict");
      }
      const headJson = readString(db, headKeyV2(tombstone.snapshotId));
      if (headJson === undefined) storeErrorV2("conflict");
      const liveHead = parseStoredRecordV2(headJson, JournalHeadSchemaV2);
      if (liveHead.snapshotId !== tombstone.snapshotId) storeErrorV2("storage-corrupt");
      if (liveHead.manifestRevision !== tombstone.previousManifestRevision) {
        storeErrorV2("conflict");
      }
      const capture = readCapture(db, undefined, tombstone.snapshotId,
        liveHead.manifestRevision, hostEpoch);
      if (!capture) storeErrorV2("storage-corrupt");

      const changeSeq = nextSequence(state.headSeq);
      if (readString(db, eventKeyV2(changeSeq)) !== undefined ||
          readString(db, outboxKeyV2(changeSeq)) !== undefined ||
          readString(db, attemptKeyV2(tombstone.attemptId)) !== undefined) {
        storeErrorV2("storage-corrupt");
      }
      const key = tombstoneKeyV2(tombstone.snapshotId, tombstone.tombstoneRevision);
      if (readString(db, key) !== undefined) storeErrorV2("conflict");
      const stored = writeTombstoneRecordV2(db, tombstone);
      injectFault(fault, "after-tombstone");

      const event = buildDeletionEvent(tombstone, changeSeq, stored.sha256);
      db.putSync(eventKeyV2(changeSeq), canonicalJsonV2(event));
      db.putSync(outboxKeyV2(changeSeq), canonicalJsonV2(event));
      db.putSync(attemptKeyV2(tombstone.attemptId), canonicalJsonV2({
        kind: "deletion",
        fingerprint,
        event,
      }));
      db.putSync(JOURNAL_META_V2.headSeq, changeSeq);
      injectFault(fault, "after-delete-event");
      injectFault(fault, "before-delete-head");
      (guard as () => void)();
      if (!db.removeSync(headKeyV2(tombstone.snapshotId))) storeErrorV2("storage-corrupt");
      writeDeletedHeadV2(db, tombstone.snapshotId, tombstone.tombstoneRevision);
      injectFault(fault, "after-delete-head");
      return Object.freeze({ event, replayed: false });
    });
  };

  const getTombstone = (snapshotId: unknown, tombstoneRevision: unknown) => {
    ensureOpen();
    validateTombstoneReadRequestV2(snapshotId, tombstoneRevision, hostEpoch);
    try {
      return transactionRead(db, (transaction) => readTombstoneV2(
        db, transaction, snapshotId, tombstoneRevision as string, hostEpoch,
      )?.tombstone);
    } catch (error) {
      if (isSnapshotStoreError(error)) throw error;
      storeErrorV2("storage-corrupt");
    }
  };

  const getDeletedHead = (snapshotId: unknown) => {
    ensureOpen();
    if (typeof snapshotId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(snapshotId)) {
      storeErrorV2("invalid-input");
    }
    try {
      return transactionRead(db, (transaction) => readDeletedHeadV2(
        db, transaction, snapshotId, hostEpoch,
      ));
    } catch (error) {
      if (isSnapshotStoreError(error)) throw error;
      storeErrorV2("storage-corrupt");
    }
  };

  return Object.freeze({ commitDeletion, getTombstone, getDeletedHead });
}
