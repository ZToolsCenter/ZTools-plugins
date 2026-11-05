import type { RootDatabase, Transaction } from "lmdb";

import { validatePayloadLifecycleRootsV2 } from "./payload-lifecycle-records.js";
import { validateOutboxAcknowledgementRootsV2 } from "./outbox-acknowledgements.js";
import { JournalTombstoneRecordSchemaV2, JournalDeletedHeadSchemaV2,
  tombstoneKeyV2, deletedHeadKeyV2, readTombstoneV2, readDeletedHeadV2 } from "./deletion-records.js";
import { validateConsumerInboxRootsV2 } from "./consumer-roots.js";
import { storeErrorV2 } from "./errors.js";
import {
  attemptKeyV2,
  eventKeyV2,
  getInSnapshot,
  headKeyV2,
  JOURNAL_META_V2,
  JournalHeadSchemaV2,
  JournalManifestRecordSchemaV2,
  JournalRawRecordSchemaV2,
  JournalReceiptRecordSchemaV2,
  JournalReferenceSchemaV2,
  manifestKeyV2,
  outboxKeyV2,
  parseEventAtKey,
  parseStoredRecordV2,
  rangeInSnapshot,
  rawRecordKeyV2,
  readCapture,
  readJournalStateV2,
  readReceiptRecord,
  receiptKeyV2,
  referenceKeyV2,
  sequenceFromKey,
  validateAttemptEventV2,
} from "./journal-records.js";
import {
  canonicalJsonV2,
  isSnapshotStoreError,
  parseAttemptRecordV2,
  sha256V2,
  validateCommitV2,
} from "./journal-validation.js";

type DatabaseV2 = RootDatabase<string, string>;
type CaptureV2 = NonNullable<ReturnType<typeof readCapture>>;
type CaptureRootV2 = Readonly<{
  snapshotId: string;
  manifestRevision: string;
  capture: CaptureV2;
}>;

const PREFIXES = [
  "manifest:", "receipt:", "raw:", "head:", "event:", "outbox:", "attempt:", "ref:", "consumer:", "inbox:", "tombstone:", "deleted:", "outbox-ack:", "payload-expired:", "payload-pin:", "payload-pin-released:",
] as const;
const META_KEYS = new Set<string>(Object.values(JOURNAL_META_V2));

function keyOf(snapshotId: string, manifestRevision: string): string {
  return canonicalJsonV2([snapshotId, manifestRevision]);
}

function requireEntry(entry: { key: unknown; value: unknown }): { key: string; value: string } {
  if (typeof entry.key !== "string" || typeof entry.value !== "string") {
    storeErrorV2("storage-corrupt");
  }
  return { key: entry.key, value: entry.value };
}

function entriesWithPrefix(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  prefix: string,
): Iterable<{ key: unknown; value: unknown }> {
  if (!prefix.endsWith(":")) storeErrorV2("storage-corrupt");
  const successor = prefix.slice(0, -1) + ";";
  return rangeInSnapshot(db, transaction, prefix, successor);
}

function assertKnownKeys(db: DatabaseV2, transaction: Transaction | undefined, storageSchemaVersion: 2 | 3): void {
  for (const rawEntry of rangeInSnapshot(db, transaction, "", undefined)) {
    const { key } = requireEntry(rawEntry);
    if (storageSchemaVersion === 2 && ["outbox-ack:", "payload-pin:", "payload-pin-released:", "payload-expired:"].some((prefix) => key.startsWith(prefix))) {
      storeErrorV2("storage-corrupt");
    }
    if (META_KEYS.has(key) || PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    storeErrorV2("storage-corrupt");
  }
}

function assertContiguousRetainedEvents(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  hostEpoch: string,
  headSeq: string,
  retentionFloor: string,
): Map<string, ReturnType<typeof parseEventAtKey>> {
  const events = new Map<string, ReturnType<typeof parseEventAtKey>>();
  const head = BigInt(headSeq);
  let expected = BigInt(retentionFloor);
  for (const rawEntry of entriesWithPrefix(db, transaction, "event:")) {
    const { key } = requireEntry(rawEntry);
    const sequence = sequenceFromKey(key, "event:");
    if (BigInt(sequence) !== expected) storeErrorV2("storage-corrupt");
    const event = parseEventAtKey(db, transaction, key, "event:", hostEpoch);
    events.set(sequence, event);
    expected += 1n;
  }
  if (expected !== head + 1n) storeErrorV2("storage-corrupt");
  return events;
}

function listReferencedObjectsInSnapshot(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  hostEpoch: string,
): readonly string[] {
  const state = readJournalStateV2((key) => getInSnapshot(db, transaction, key));
  if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
  assertKnownKeys(db, transaction, state.storageSchemaVersion);
  const expiredPayloads = validatePayloadLifecycleRootsV2(db, transaction, hostEpoch);

  const captures = new Map<string, CaptureRootV2>();
  for (const rawEntry of entriesWithPrefix(db, transaction, "manifest:")) {
    const { key, value } = requireEntry(rawEntry);
    const record = parseStoredRecordV2(value, JournalManifestRecordSchemaV2);
    if (key !== manifestKeyV2(record.snapshotId, record.manifestRevision)) {
      storeErrorV2("storage-corrupt");
    }
    const id = keyOf(record.snapshotId, record.manifestRevision);
    if (captures.has(id)) storeErrorV2("storage-corrupt");
    const capture = readCapture(
      db, transaction, record.snapshotId, record.manifestRevision, hostEpoch,
    );
    if (!capture) storeErrorV2("storage-corrupt");
    captures.set(id, Object.freeze({
      snapshotId: record.snapshotId,
      manifestRevision: record.manifestRevision,
      capture,
    }));
  }

  const captureByReceipt = new Map<string, CaptureRootV2>();
  const expectedReferences = new Map<string, string>();
  const blobRefs = new Set<string>();
  for (const root of captures.values()) {
    const receiptId = root.capture.receipt.receiptId;
    if (captureByReceipt.has(receiptId)) storeErrorV2("storage-corrupt");
    captureByReceipt.set(receiptId, root);
    for (const binding of root.capture.bindings) {
      const key = referenceKeyV2(
        root.snapshotId, root.manifestRevision, binding.representationKey,
      );
      if (expectedReferences.has(key)) storeErrorV2("storage-corrupt");
      expectedReferences.set(key, canonicalJsonV2({
        snapshotId: root.snapshotId,
        manifestRevision: root.manifestRevision,
        binding,
      }));
      if (!expiredPayloads.has(keyOf(root.snapshotId, root.manifestRevision))) blobRefs.add(binding.blobRef);
    }
  }

  const receipts = new Set<string>();
  for (const rawEntry of entriesWithPrefix(db, transaction, "receipt:")) {
    const { key, value } = requireEntry(rawEntry);
    const record = parseStoredRecordV2(value, JournalReceiptRecordSchemaV2);
    if (key !== receiptKeyV2(record.receiptId)) storeErrorV2("storage-corrupt");
    const root = captureByReceipt.get(record.receiptId);
    const receipt = readReceiptRecord(db, transaction, record.receiptId);
    if (!root || !receipt || receipts.has(record.receiptId) ||
        root.snapshotId !== record.snapshotId ||
        root.manifestRevision !== record.manifestRevision ||
        receipt.record.attemptId !== root.capture.receipt.attemptId) {
      storeErrorV2("storage-corrupt");
    }
    receipts.add(record.receiptId);
  }
  if (receipts.size !== captures.size) storeErrorV2("storage-corrupt");

  const rawRecords = new Set<string>();
  for (const rawEntry of entriesWithPrefix(db, transaction, "raw:")) {
    const { key, value } = requireEntry(rawEntry);
    const record = parseStoredRecordV2(value, JournalRawRecordSchemaV2);
    const id = keyOf(record.snapshotId, record.manifestRevision);
    if (key !== rawRecordKeyV2(record.snapshotId, record.manifestRevision) ||
        !captures.has(id) || rawRecords.has(id)) storeErrorV2("storage-corrupt");
    rawRecords.add(id);
  }
  if (rawRecords.size !== captures.size) storeErrorV2("storage-corrupt");

  const actualReferences = new Set<string>();
  for (const rawEntry of entriesWithPrefix(db, transaction, "ref:")) {
    const { key, value } = requireEntry(rawEntry);
    const reference = parseStoredRecordV2(value, JournalReferenceSchemaV2);
    const expectedKey = referenceKeyV2(
      reference.snapshotId,
      reference.manifestRevision,
      reference.binding.representationKey,
    );
    if (key !== expectedKey || actualReferences.has(key) ||
        expectedReferences.get(key) !== canonicalJsonV2(reference)) {
      storeErrorV2("storage-corrupt");
    }
    actualReferences.add(key);
  }
  if (actualReferences.size !== expectedReferences.size) storeErrorV2("storage-corrupt");

  const tombstones = new Map<string, NonNullable<ReturnType<typeof readTombstoneV2>>>();
  for (const rawEntry of entriesWithPrefix(db, transaction, "tombstone:")) {
    const { key, value } = requireEntry(rawEntry);
    const record = parseStoredRecordV2(value, JournalTombstoneRecordSchemaV2);
    const id = keyOf(record.snapshotId, record.tombstoneRevision);
    const stored = readTombstoneV2(db, transaction, record.snapshotId, record.tombstoneRevision, hostEpoch);
    if (!stored || key !== tombstoneKeyV2(record.snapshotId, record.tombstoneRevision) ||
        tombstones.has(id) || !captures.has(keyOf(record.snapshotId, stored.tombstone.previousManifestRevision))) {
      storeErrorV2("storage-corrupt");
    }
    tombstones.set(id, stored);
  }
  const deletedHeads = new Map<string, string>();
  for (const rawEntry of entriesWithPrefix(db, transaction, "deleted:")) {
    const { key, value } = requireEntry(rawEntry);
    const record = parseStoredRecordV2(value, JournalDeletedHeadSchemaV2);
    const tombstone = readDeletedHeadV2(db, transaction, record.snapshotId, hostEpoch);
    if (!tombstone || key !== deletedHeadKeyV2(record.snapshotId) || deletedHeads.has(record.snapshotId) ||
        !tombstones.has(keyOf(record.snapshotId, record.tombstoneRevision))) storeErrorV2("storage-corrupt");
    deletedHeads.set(record.snapshotId, record.tombstoneRevision);
  }

  const heads = new Map<string, string>();
  for (const rawEntry of entriesWithPrefix(db, transaction, "head:")) {
    const { key, value } = requireEntry(rawEntry);
    const head = parseStoredRecordV2(value, JournalHeadSchemaV2);
    const id = keyOf(head.snapshotId, head.manifestRevision);
    if (key !== headKeyV2(head.snapshotId) || !captures.has(id) ||
        heads.has(head.snapshotId)) storeErrorV2("storage-corrupt");
    heads.set(head.snapshotId, head.manifestRevision);
  }

  const eventsBySequence = assertContiguousRetainedEvents(
    db, transaction, hostEpoch, state.headSeq, state.retentionFloor,
  );
  const outboxBySequence = new Map<string, ReturnType<typeof parseEventAtKey>>();
  for (const rawEntry of entriesWithPrefix(db, transaction, "outbox:")) {
    const { key } = requireEntry(rawEntry);
    const sequence = sequenceFromKey(key, "outbox:");
    if (BigInt(sequence) > BigInt(state.headSeq)) storeErrorV2("storage-corrupt");
    const event = parseEventAtKey(db, transaction, key, "outbox:", hostEpoch);
    if (outboxBySequence.has(sequence)) storeErrorV2("storage-corrupt");
    outboxBySequence.set(sequence, event);
  }

  const acknowledgedOutbox = validateOutboxAcknowledgementRootsV2(db, transaction, hostEpoch);
  const attemptsBySequence = new Map<string, ReturnType<typeof parseAttemptRecordV2>>();
  const attemptIds = new Map<string, ReturnType<typeof parseAttemptRecordV2>>();
  const attempts: Array<{ attemptId: string; record: ReturnType<typeof parseAttemptRecordV2> }> = [];
  for (const rawEntry of entriesWithPrefix(db, transaction, "attempt:")) {
    const { key, value } = requireEntry(rawEntry);
    const attemptId = key.slice("attempt:".length);
    const record = parseAttemptRecordV2(value);
    if (!attemptId || key !== attemptKeyV2(attemptId) || attemptIds.has(attemptId) ||
        BigInt(record.event.changeSeq) > BigInt(state.headSeq) ||
        attemptsBySequence.has(record.event.changeSeq)) storeErrorV2("storage-corrupt");
    validateAttemptEventV2(
      db, transaction, record.event, hostEpoch, state.headSeq, state.retentionFloor,
    );
    if (record.kind === "capture") {
      if (record.event.eventType !== "upsert") storeErrorV2("storage-corrupt");
    } else if (record.kind === "deletion") {
      const event = record.event;
      if (event.eventType !== "delete") storeErrorV2("storage-corrupt");
      const stored = tombstones.get(keyOf(event.snapshotId, event.tombstoneRevision));
      if (!stored || stored.tombstone.attemptId !== attemptId ||
          record.fingerprint !== sha256V2(canonicalJsonV2(stored.tombstone))) storeErrorV2("storage-corrupt");
    } else if (record.event.eventType !== "outcome" ||
        record.event.attemptId !== attemptId ||
        record.fingerprint !== sha256V2(canonicalJsonV2({
          attemptId,
          outcomeCode: record.event.outcomeCode,
        }))) {
      storeErrorV2("storage-corrupt");
    }
    attemptIds.set(attemptId, record);
    attemptsBySequence.set(record.event.changeSeq, record);
    attempts.push({ attemptId, record });
  }

  const latestManifestBySnapshot = new Map<string, string>();
  const latestDeletionBySnapshot = new Map<string, string>();
  const tombstonesWithAttempts = new Set<string>();
  attempts.sort((left, right) =>
    BigInt(left.record.event.changeSeq) < BigInt(right.record.event.changeSeq) ? -1 : 1);
  const capturesWithAttempts = new Set<string>();
  for (const { attemptId, record } of attempts) {
    const event = record.event;
    if (record.kind === "capture") {
      if (event.eventType === "upsert" && latestDeletionBySnapshot.has(event.snapshotId)) {
        storeErrorV2("storage-corrupt");
      }
      if (event.eventType !== "upsert") storeErrorV2("storage-corrupt");
      const root = captures.get(keyOf(event.snapshotId, event.manifestRevision));
      if (!root || root.capture.receipt.attemptId !== attemptId ||
          event.manifestRef !== manifestKeyV2(event.snapshotId, event.manifestRevision) ||
          event.manifestSha256 !== root.capture.manifestSha256) {
        storeErrorV2("storage-corrupt");
      }
      const expectedManifestRevision = latestManifestBySnapshot.get(event.snapshotId) ?? null;
      try {
        const validated = validateCommitV2({
          manifest: root.capture.manifest,
          receipt: root.capture.receipt,
          rawObjects: root.capture.bindings,
          expectedManifestRevision,
        }, hostEpoch);
        if (validated.fingerprint !== record.fingerprint ||
            validated.manifestSha256 !== event.manifestSha256) {
          storeErrorV2("storage-corrupt");
        }
      } catch (error) {
        if (isSnapshotStoreError(error) &&
            (error as { code?: unknown }).code === "storage-corrupt") throw error;
        storeErrorV2("storage-corrupt");
      }
      latestManifestBySnapshot.set(event.snapshotId, event.manifestRevision);
      capturesWithAttempts.add(keyOf(event.snapshotId, event.manifestRevision));
    } else if (record.kind === "deletion") {
      if (event.eventType !== "delete") storeErrorV2("storage-corrupt");
      const id = keyOf(event.snapshotId, event.tombstoneRevision);
      const stored = tombstones.get(id);
      if (!stored || latestDeletionBySnapshot.has(event.snapshotId) ||
          latestManifestBySnapshot.get(event.snapshotId) !== stored.tombstone.previousManifestRevision) {
        storeErrorV2("storage-corrupt");
      }
      latestManifestBySnapshot.delete(event.snapshotId);
      latestDeletionBySnapshot.set(event.snapshotId, event.tombstoneRevision);
      tombstonesWithAttempts.add(id);
    }
  }

  if (capturesWithAttempts.size !== captures.size ||
      [...captures.keys()].some((id) => !capturesWithAttempts.has(id))) {
    storeErrorV2("storage-corrupt");
  }

  for (const [sequence, event] of eventsBySequence) {
    const attempt = attemptsBySequence.get(sequence);
    if (!attempt || canonicalJsonV2(attempt.event) !== canonicalJsonV2(event)) {
      storeErrorV2("storage-corrupt");
    }
  }
  for (const [sequence, event] of outboxBySequence) {
    const indexed = eventsBySequence.get(sequence);
    if (indexed && canonicalJsonV2(indexed) !== canonicalJsonV2(event)) {
      storeErrorV2("storage-corrupt");
    }
    const attempt = attemptsBySequence.get(sequence);
    if (!attempt || canonicalJsonV2(attempt.event) !== canonicalJsonV2(event)) {
      storeErrorV2("storage-corrupt");
    }
  }

  for (const sequence of attemptsBySequence.keys()) {
    if (BigInt(sequence) > BigInt(state.outboxAckLegacyHeadSeq) &&
        outboxBySequence.has(sequence) === acknowledgedOutbox.has(sequence)) storeErrorV2("storage-corrupt");
  }
  if (tombstonesWithAttempts.size !== tombstones.size ||
      [...tombstones.keys()].some((id) => !tombstonesWithAttempts.has(id)) ||
      deletedHeads.size !== latestDeletionBySnapshot.size) storeErrorV2("storage-corrupt");
  for (const [snapshotId, revision] of latestDeletionBySnapshot) {
    if (deletedHeads.get(snapshotId) !== revision) storeErrorV2("storage-corrupt");
  }
  if (heads.size !== latestManifestBySnapshot.size) storeErrorV2("storage-corrupt");
  for (const [snapshotId, manifestRevision] of latestManifestBySnapshot) {
    if (heads.get(snapshotId) !== manifestRevision) storeErrorV2("storage-corrupt");
  }
  validateConsumerInboxRootsV2(db, transaction, hostEpoch);
  return Object.freeze([...blobRefs].sort());
}

export function listReferencedObjectsInSnapshotV2(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  hostEpoch: string,
): readonly string[] {
  try {
    return listReferencedObjectsInSnapshot(db, transaction, hostEpoch);
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}
