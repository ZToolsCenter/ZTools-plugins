import type { RootDatabase, Transaction } from "lmdb";
import { z } from "zod";

import { ChangeSequenceV2Schema } from "@pasteboard-pro/core";
import { storeErrorV2 } from "./errors.js";
import {
  canonicalJsonV2,
  isSnapshotStoreError,
  parseAttemptRecordV2,
  sha256V2,
  tupleKeyV2,
} from "./journal-validation.js";
import {
  attemptKeyV2,
  getInSnapshot,
  headKeyV2,
  JournalHeadSchemaV2,
  manifestKeyV2,
  readCapture,
  readJournalStateV2,
  parseStoredRecordV2,
  validateAttemptEventV2,
} from "./journal-records.js";
import {
  readDeletedHeadV2,
  readTombstoneV2,
  tombstoneKeyV2,
} from "./deletion-records.js";
import {
  consumerCheckpointKeyV2,
  MAX_CONSUMERS_V2,
  parseConsumerCheckpointV2,
} from "./consumer-records.js";
import { validateConsumerCheckpointBoundsV2 } from "./consumer-validation.js";
import { readOutboxAcknowledgementV2 } from "./outbox-acknowledgements.js";
import type {
  PayloadExpiryRecordV2,
  PayloadLeaseV2,
} from "./payload-lifecycle-types.js";

type DatabaseV2 = RootDatabase<string, string>;

const IDENTIFIER = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const UUID_V4 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);
const PURPOSE = z.enum(["export", "paste", "sync", "pending-target"]);

export const PayloadLeaseRecordSchemaV2 = z.object({
  hostEpoch: UUID_V4,
  leaseId: UUID_V4,
  token: UUID_V4,
  snapshotId: IDENTIFIER,
  manifestRevision: IDENTIFIER,
  purpose: PURPOSE,
}).strict();

export const PayloadLeaseReleasedRecordSchemaV2 = z.object({
  hostEpoch: UUID_V4,
  leaseId: UUID_V4,
  snapshotId: IDENTIFIER,
  manifestRevision: IDENTIFIER,
  purpose: PURPOSE,
  tokenSha256: SHA256,
  fingerprint: SHA256,
}).strict();

export const PayloadExpiryRecordSchemaV2 = z.object({
  schemaVersion: z.literal(2),
  hostEpoch: UUID_V4,
  snapshotId: IDENTIFIER,
  manifestRevision: IDENTIFIER,
  manifestSha256: SHA256,
  tombstoneRevision: IDENTIFIER,
  upsertChangeSeq: ChangeSequenceV2Schema,
  deleteChangeSeq: ChangeSequenceV2Schema,
}).strict();

export type PayloadLeaseReleasedRecordV2 = z.infer<typeof PayloadLeaseReleasedRecordSchemaV2>;
export type PayloadExpiryCandidateV2 = Readonly<{
  record: PayloadExpiryRecordV2;
  sourcePruned: boolean;
  consumersAcknowledged: boolean;
  outboxAcknowledged: boolean;
  activeLease: boolean;
}>;
export type PayloadExpiryInspectionV2 =
  | Readonly<{ status: "snapshot-live" }>
  | Readonly<{ status: "candidate"; candidate: PayloadExpiryCandidateV2 }>;

export const MAX_ACTIVE_PAYLOAD_LEASES_V2 = 128;

export function payloadExpiryKeyV2(snapshotId: string, manifestRevision: string): string {
  return tupleKeyV2("payload-expired:", [snapshotId, manifestRevision]);
}

export function payloadPinKeyV2(leaseId: string): string {
  return `payload-pin:${leaseId}`;
}

export function payloadPinReleasedKeyV2(leaseId: string): string {
  return `payload-pin-released:${leaseId}`;
}

export function payloadLeaseMetadataV2(
  lease: Pick<PayloadLeaseV2, "hostEpoch" | "leaseId" | "snapshotId" | "manifestRevision" | "purpose">,
) {
  return Object.freeze({
    hostEpoch: lease.hostEpoch,
    leaseId: lease.leaseId,
    snapshotId: lease.snapshotId,
    manifestRevision: lease.manifestRevision,
    purpose: lease.purpose,
  });
}

export function payloadLeaseReleaseFingerprintV2(
  record: Pick<PayloadLeaseReleasedRecordV2,
    "hostEpoch" | "leaseId" | "snapshotId" | "manifestRevision" | "purpose" | "tokenSha256">,
): string {
  return sha256V2(canonicalJsonV2({
    ...payloadLeaseMetadataV2(record),
    tokenSha256: record.tokenSha256,
  }));
}

function readString(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  key: string,
): string | undefined {
  return getInSnapshot(db, transaction, key);
}

function parseCanonicalRecord<T>(json: string, schema: z.ZodType<T>): T {
  try {
    const result = schema.safeParse(JSON.parse(json) as unknown);
    if (!result.success || canonicalJsonV2(result.data) !== json) {
      storeErrorV2("storage-corrupt");
    }
    return result.data;
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}

function prefixEntries(db: DatabaseV2, transaction: Transaction | undefined, prefix: string) {
  return transaction === undefined
    ? db.getRange({ start: prefix, end: `${prefix.slice(0, -1)};` })
    : db.getRange({ start: prefix, end: `${prefix.slice(0, -1)};`, transaction });
}

function validateLeaseCaptureSource(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  lease: Pick<PayloadLeaseV2, "hostEpoch" | "snapshotId" | "manifestRevision">,
  hostEpoch: string,
): void {
  if (lease.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
  const capture = readCapture(db, transaction, lease.snapshotId, lease.manifestRevision, hostEpoch);
  if (!capture) storeErrorV2("storage-corrupt");
  const state = readJournalStateV2((key) => readString(db, transaction, key));
  const attemptJson = readString(db, transaction, attemptKeyV2(capture.receipt.attemptId));
  if (state.hostEpoch !== hostEpoch || attemptJson === undefined) storeErrorV2("storage-corrupt");
  const attempt = parseAttemptRecordV2(attemptJson);
  const event = attempt.event;
  if (attempt.kind !== "capture" || event.eventType !== "upsert" ||
      event.snapshotId !== lease.snapshotId || event.manifestRevision !== lease.manifestRevision ||
      event.manifestRef !== manifestKeyV2(lease.snapshotId, lease.manifestRevision) ||
      event.manifestSha256 !== capture.manifestSha256) storeErrorV2("storage-corrupt");
  validateAttemptEventV2(db, transaction, event, hostEpoch, state.headSeq, state.retentionFloor);
}

export function parsePayloadLeaseRecordV2(
  json: string,
  leaseId: string,
  hostEpoch: string,
): PayloadLeaseV2 {
  const record = parseCanonicalRecord(json, PayloadLeaseRecordSchemaV2);
  if (record.leaseId !== leaseId || record.hostEpoch !== hostEpoch) {
    storeErrorV2("storage-corrupt");
  }
  return Object.freeze({ ...record });
}

export function readPayloadLeaseRecordV2(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  leaseId: string,
  hostEpoch: string,
): PayloadLeaseV2 | undefined {
  const json = readString(db, transaction, payloadPinKeyV2(leaseId));
  if (json === undefined) return undefined;
  const lease = parsePayloadLeaseRecordV2(json, leaseId, hostEpoch);
  validateLeaseCaptureSource(db, transaction, lease, hostEpoch);
  if (readString(db, transaction, payloadExpiryKeyV2(lease.snapshotId, lease.manifestRevision)) !== undefined) {
    storeErrorV2("storage-corrupt");
  }
  return lease;
}

export function parsePayloadLeaseReleasedRecordV2(
  json: string,
  leaseId: string,
  hostEpoch: string,
): PayloadLeaseReleasedRecordV2 {
  const record = parseCanonicalRecord(json, PayloadLeaseReleasedRecordSchemaV2);
  if (record.leaseId !== leaseId || record.hostEpoch !== hostEpoch ||
      record.fingerprint !== payloadLeaseReleaseFingerprintV2(record)) {
    storeErrorV2("storage-corrupt");
  }
  return Object.freeze({ ...record });
}

export function readPayloadLeaseReleasedRecordV2(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  leaseId: string,
  hostEpoch: string,
): PayloadLeaseReleasedRecordV2 | undefined {
  const json = readString(db, transaction, payloadPinReleasedKeyV2(leaseId));
  if (json === undefined) return undefined;
  const record = parsePayloadLeaseReleasedRecordV2(json, leaseId, hostEpoch);
  validateLeaseCaptureSource(db, transaction, record, hostEpoch);
  return record;
}

export function readAllPayloadLeaseRecordsV2(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  hostEpoch: string,
): readonly PayloadLeaseV2[] {
  const leases: PayloadLeaseV2[] = [];
  const ids = new Set<string>();
  for (const entry of prefixEntries(db, transaction, "payload-pin:")) {
    if (typeof entry.key !== "string" || typeof entry.value !== "string") {
      storeErrorV2("storage-corrupt");
    }
    const leaseId = entry.key.slice("payload-pin:".length);
    if (!UUID_V4.safeParse(leaseId).success || entry.key !== payloadPinKeyV2(leaseId) || ids.has(leaseId)) {
      storeErrorV2("storage-corrupt");
    }
    const lease = parsePayloadLeaseRecordV2(entry.value, leaseId, hostEpoch);
    validateLeaseCaptureSource(db, transaction, lease, hostEpoch);
    if (readString(db, transaction, payloadExpiryKeyV2(lease.snapshotId, lease.manifestRevision)) !== undefined) {
      storeErrorV2("storage-corrupt");
    }
    ids.add(leaseId);
    leases.push(lease);
    if (leases.length > MAX_ACTIVE_PAYLOAD_LEASES_V2) storeErrorV2("storage-corrupt");
  }
  return Object.freeze(leases);
}

export function readAllPayloadLeaseReleasedRecordsV2(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  hostEpoch: string,
): readonly PayloadLeaseReleasedRecordV2[] {
  const records: PayloadLeaseReleasedRecordV2[] = [];
  const ids = new Set<string>();
  for (const entry of prefixEntries(db, transaction, "payload-pin-released:")) {
    if (typeof entry.key !== "string" || typeof entry.value !== "string") {
      storeErrorV2("storage-corrupt");
    }
    const leaseId = entry.key.slice("payload-pin-released:".length);
    if (!UUID_V4.safeParse(leaseId).success || entry.key !== payloadPinReleasedKeyV2(leaseId) || ids.has(leaseId)) {
      storeErrorV2("storage-corrupt");
    }
    const record = parsePayloadLeaseReleasedRecordV2(entry.value, leaseId, hostEpoch);
    validateLeaseCaptureSource(db, transaction, record, hostEpoch);
    ids.add(leaseId);
    records.push(record);
  }
  return Object.freeze(records);
}

function readConsumerAcknowledgements(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  hostEpoch: string,
  deleteChangeSeq: string,
): boolean {
  const state = readJournalStateV2((key) => readString(db, transaction, key));
  if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
  let count = 0;
  let acknowledged = true;
  const seen = new Set<string>();
  for (const entry of prefixEntries(db, transaction, "consumer:")) {
    if (typeof entry.key !== "string" || typeof entry.value !== "string") {
      storeErrorV2("storage-corrupt");
    }
    const checkpoint = parseConsumerCheckpointV2(entry.value, undefined, hostEpoch);
    if (entry.key !== consumerCheckpointKeyV2(checkpoint.consumerId) || seen.has(checkpoint.consumerId)) {
      storeErrorV2("storage-corrupt");
    }
    validateConsumerCheckpointBoundsV2(
      checkpoint, checkpoint.consumerId, hostEpoch, state.headSeq, state.retentionFloor,
    );
    count += 1;
    seen.add(checkpoint.consumerId);
    if (count > MAX_CONSUMERS_V2) storeErrorV2("storage-corrupt");
    if (BigInt(checkpoint.acknowledgedThrough) < BigInt(deleteChangeSeq)) {
      // Keep validating the remaining registered checkpoint rows.
      acknowledged = false;
    }
  }
  return acknowledged;
}

export function inspectPayloadExpiryCandidateV2(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  snapshotId: string,
  manifestRevision: string,
  tombstoneRevision: string,
  hostEpoch: string,
): PayloadExpiryInspectionV2 | undefined {
  const capture = readCapture(db, transaction, snapshotId, manifestRevision, hostEpoch);
  if (!capture) return undefined;
  const liveHeadJson = readString(db, transaction, headKeyV2(snapshotId));
  if (liveHeadJson !== undefined) {
    const parsedHead = parseStoredRecordV2(liveHeadJson, JournalHeadSchemaV2);
    if (parsedHead.snapshotId !== snapshotId ||
        !readCapture(db, transaction, snapshotId, parsedHead.manifestRevision, hostEpoch)) storeErrorV2("storage-corrupt");
    return Object.freeze({ status: "snapshot-live" });
  }

  const deletedHead = readDeletedHeadV2(db, transaction, snapshotId, hostEpoch);
  if (!deletedHead || deletedHead.tombstoneRevision !== tombstoneRevision) return undefined;
  const storedTombstone = readTombstoneV2(db, transaction, snapshotId, tombstoneRevision, hostEpoch);
  if (!storedTombstone) storeErrorV2("storage-corrupt");
  const state = readJournalStateV2((key) => readString(db, transaction, key));
  if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");

  const captureAttemptJson = readString(db, transaction, attemptKeyV2(capture.receipt.attemptId));
  if (captureAttemptJson === undefined) storeErrorV2("storage-corrupt");
  const captureAttempt = parseAttemptRecordV2(captureAttemptJson);
  const upsert = captureAttempt.event;
  if (captureAttempt.kind !== "capture" || upsert.eventType !== "upsert" ||
      upsert.snapshotId !== snapshotId || upsert.manifestRevision !== manifestRevision ||
      upsert.manifestRef !== manifestKeyV2(snapshotId, manifestRevision) ||
      upsert.manifestSha256 !== capture.manifestSha256) storeErrorV2("storage-corrupt");
  validateAttemptEventV2(db, transaction, upsert, hostEpoch, state.headSeq, state.retentionFloor);

  const deletionAttemptJson = readString(db, transaction, attemptKeyV2(storedTombstone.tombstone.attemptId));
  if (deletionAttemptJson === undefined) storeErrorV2("storage-corrupt");
  const deletionAttempt = parseAttemptRecordV2(deletionAttemptJson);
  const deletion = deletionAttempt.event;
  if (deletionAttempt.kind !== "deletion" || deletion.eventType !== "delete" ||
      deletion.snapshotId !== snapshotId || deletion.tombstoneRevision !== tombstoneRevision ||
      deletion.tombstoneRef !== tombstoneKeyV2(snapshotId, tombstoneRevision) ||
      deletion.tombstoneSha256 !== storedTombstone.sha256 ||
      deletionAttempt.fingerprint !== sha256V2(canonicalJsonV2(storedTombstone.tombstone))) {
    storeErrorV2("storage-corrupt");
  }
  validateAttemptEventV2(db, transaction, deletion, hostEpoch, state.headSeq, state.retentionFloor);
  if (BigInt(upsert.changeSeq) >= BigInt(deletion.changeSeq)) storeErrorV2("storage-corrupt");

  const recordResult = PayloadExpiryRecordSchemaV2.safeParse({
    schemaVersion: 2,
    hostEpoch,
    snapshotId,
    manifestRevision,
    manifestSha256: capture.manifestSha256,
    tombstoneRevision,
    upsertChangeSeq: upsert.changeSeq,
    deleteChangeSeq: deletion.changeSeq,
  });
  if (!recordResult.success) storeErrorV2("storage-corrupt");
  const record = recordResult.data;

  const upsertAck = readOutboxAcknowledgementV2(db, transaction, upsert.changeSeq, hostEpoch);
  const deleteAck = readOutboxAcknowledgementV2(db, transaction, deletion.changeSeq, hostEpoch);
  if ((upsertAck && canonicalJsonV2(upsertAck.event) !== canonicalJsonV2(upsert)) ||
      (deleteAck && canonicalJsonV2(deleteAck.event) !== canonicalJsonV2(deletion))) {
    storeErrorV2("storage-corrupt");
  }
  const leases = readAllPayloadLeaseRecordsV2(db, transaction, hostEpoch);
  const candidate = Object.freeze({
    record,
    sourcePruned: BigInt(state.retentionFloor) > BigInt(deletion.changeSeq),
    consumersAcknowledged: readConsumerAcknowledgements(db, transaction, hostEpoch, deletion.changeSeq),
    outboxAcknowledged: upsertAck !== undefined && deleteAck !== undefined,
    activeLease: leases.some((lease) =>
      lease.snapshotId === snapshotId && lease.manifestRevision === manifestRevision),
  });
  return Object.freeze({ status: "candidate", candidate });
}

export function readPayloadExpiryV2(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  snapshotId: string,
  manifestRevision: string,
  hostEpoch: string,
): PayloadExpiryRecordV2 | undefined {
  try {
    if (!IDENTIFIER.safeParse(snapshotId).success || !IDENTIFIER.safeParse(manifestRevision).success ||
        !UUID_V4.safeParse(hostEpoch).success) storeErrorV2("invalid-input");
    const json = readString(db, transaction, payloadExpiryKeyV2(snapshotId, manifestRevision));
    if (json === undefined) return undefined;
    const record = parseCanonicalRecord(json, PayloadExpiryRecordSchemaV2);
    if (record.snapshotId !== snapshotId || record.manifestRevision !== manifestRevision ||
        record.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
    const inspection = inspectPayloadExpiryCandidateV2(
      db, transaction, snapshotId, manifestRevision, record.tombstoneRevision, hostEpoch,
    );
    if (!inspection || inspection.status !== "candidate" ||
        canonicalJsonV2(inspection.candidate.record) !== canonicalJsonV2(record) ||
        !inspection.candidate.sourcePruned || !inspection.candidate.consumersAcknowledged ||
        !inspection.candidate.outboxAcknowledged || inspection.candidate.activeLease) {
      storeErrorV2("storage-corrupt");
    }
    return Object.freeze({ ...record });
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}

export function validatePayloadLifecycleRootsV2(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  hostEpoch: string,
): ReadonlySet<string> {
  try {
    if (!UUID_V4.safeParse(hostEpoch).success) storeErrorV2("invalid-input");
    const state = readJournalStateV2((key) => readString(db, transaction, key));
    if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");

    const leases = readAllPayloadLeaseRecordsV2(db, transaction, hostEpoch);
    const released = readAllPayloadLeaseReleasedRecordsV2(db, transaction, hostEpoch);
    const activeIds = new Set(leases.map((lease) => lease.leaseId));
    for (const receipt of released) {
      if (activeIds.has(receipt.leaseId)) storeErrorV2("storage-corrupt");
    }

    const expired = new Set<string>();
    const seen = new Set<string>();
    for (const entry of prefixEntries(db, transaction, "payload-expired:")) {
      if (typeof entry.key !== "string" || typeof entry.value !== "string") {
        storeErrorV2("storage-corrupt");
      }
      const record = parseCanonicalRecord(entry.value, PayloadExpiryRecordSchemaV2);
      const expectedKey = payloadExpiryKeyV2(record.snapshotId, record.manifestRevision);
      if (entry.key !== expectedKey || record.hostEpoch !== hostEpoch || seen.has(expectedKey)) {
        storeErrorV2("storage-corrupt");
      }
      const validated = readPayloadExpiryV2(
        db, transaction, record.snapshotId, record.manifestRevision, hostEpoch,
      );
      if (!validated) storeErrorV2("storage-corrupt");
      seen.add(expectedKey);
      expired.add(canonicalJsonV2([record.snapshotId, record.manifestRevision]));
    }
    return expired;
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}
