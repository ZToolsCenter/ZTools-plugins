import type { Transaction } from "lmdb";
import { z } from "zod";

import {
  ChangeSequenceV2Schema,
  type ClipboardJournalChangeEventV2,
} from "@pasteboard-pro/core";
import { storeErrorV2 } from "./errors.js";
import {
  canonicalJsonV2,
  isSnapshotStoreError,
  parseAttemptRecordV2,
  parseEventJsonV2,
  sha256V2,
} from "./journal-validation.js";
import { attemptKeyV2, readJournalStateV2, validateAttemptEventV2, validateDeletionEventSourceV2 } from "./journal-records.js";
import {
  consumerCheckpointKeyV2,
  consumerInboxKeyV2,
  MAX_CONSUMER_READ_PAGE_V2,
  MAX_CONSUMER_STAGE_PAGE_V2,
  MAX_CONSUMER_OUTSTANDING_V2,
  parseConsumerTaskAtKeyV2,
  readConsumerValueV2,
  type ConsumerCheckpointRecordV2,
  type ConsumerDatabaseV2,
  type ConsumerTaskRecordV2,
} from "./consumer-records.js";
import type {
  ClaimConsumerRequestV2,
  ConsumerLeaseRequestV2,
  ReadConsumerInboxRequestV2,
  StageConsumerRequestV2,
} from "./consumer-types.js";

const IDENTIFIER = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const HOST_EPOCH = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const UUID_V4 = HOST_EPOCH;

const StageRequestSchema = z.object({
  consumerId: IDENTIFIER,
  hostEpoch: HOST_EPOCH,
  after: ChangeSequenceV2Schema,
  limit: z.number().int().min(1).max(MAX_CONSUMER_STAGE_PAGE_V2).safe(),
}).strict();
const ClaimRequestSchema = z.object({
  consumerId: IDENTIFIER,
  hostEpoch: HOST_EPOCH,
  leaseMs: z.number().int().min(1_000).max(300_000).safe(),
}).strict();
const LeaseRequestSchema = z.object({
  consumerId: IDENTIFIER,
  hostEpoch: HOST_EPOCH,
  changeSeq: ChangeSequenceV2Schema.refine((value) => BigInt(value) > 0n),
  token: UUID_V4,
}).strict();
const ReadRequestSchema = z.object({
  consumerId: IDENTIFIER,
  limit: z.number().int().min(1).max(MAX_CONSUMER_READ_PAGE_V2).safe(),
}).strict();

function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) storeErrorV2("invalid-input");
  return parsed.data;
}

export function validateStageConsumerRequestV2(value: unknown): StageConsumerRequestV2 {
  return parseRequest(StageRequestSchema, value);
}

export function validateClaimConsumerRequestV2(value: unknown): ClaimConsumerRequestV2 {
  return parseRequest(ClaimRequestSchema, value);
}

export function validateConsumerLeaseRequestV2(value: unknown): ConsumerLeaseRequestV2 {
  return parseRequest(LeaseRequestSchema, value);
}

export function validateReadConsumerInboxRequestV2(value: unknown): ReadConsumerInboxRequestV2 {
  return parseRequest(ReadRequestSchema, value);
}

export function validateConsumerIdV2(value: unknown): string {
  const parsed = IDENTIFIER.safeParse(value);
  if (!parsed.success) storeErrorV2("invalid-input");
  return parsed.data;
}

export function consumerDeliveryIdV2(
  hostEpoch: string,
  consumerId: string,
  changeSeq: string,
): string {
  return sha256V2(canonicalJsonV2([hostEpoch, consumerId, changeSeq]));
}

/**
 * Binds a metadata-only inbox event to the immutable journal attempt record.
 * This also validates the retained capture for upserts, including all reference
 * rows, and permits pruned event-index rows only while the attempt remains.
 */
export function validateConsumerEventSourceV2(
  db: ConsumerDatabaseV2,
  transaction: Transaction | undefined,
  event: ClipboardJournalChangeEventV2,
  hostEpoch: string,
  headSeq: string,
  retentionFloor: string,
): ClipboardJournalChangeEventV2 {
  try {
    if (event.hostEpoch !== hostEpoch || BigInt(event.changeSeq) > BigInt(headSeq)) {
      storeErrorV2("storage-corrupt");
    }
    const capture = validateAttemptEventV2(
      db, transaction, event, hostEpoch, headSeq, retentionFloor,
    );
    const tombstone = event.eventType === "delete"
      ? validateDeletionEventSourceV2(db, transaction, event, hostEpoch) : undefined;
    const sourceAttemptId = event.eventType === "upsert"
      ? capture?.receipt.attemptId
      : event.eventType === "outcome" ? event.attemptId : tombstone?.attemptId;
    if (!sourceAttemptId) storeErrorV2("storage-corrupt");
    const attemptJson = readConsumerValueV2(db, transaction, attemptKeyV2(sourceAttemptId));
    if (attemptJson === undefined) storeErrorV2("storage-corrupt");
    const attempt = parseAttemptRecordV2(attemptJson);
    if (canonicalJsonV2(attempt.event) !== canonicalJsonV2(event)) {
      storeErrorV2("storage-corrupt");
    }
    if (event.eventType === "upsert") {
      if (attempt.kind !== "capture" || !capture ||
          capture.receipt.attemptId !== sourceAttemptId ||
          capture.manifest.snapshotId !== event.snapshotId ||
          capture.manifest.manifestRevision !== event.manifestRevision ||
          capture.manifestSha256 !== event.manifestSha256) {
        storeErrorV2("storage-corrupt");
      }
    } else if (event.eventType === "outcome") {
      if (attempt.kind !== "outcome" || event.attemptId !== sourceAttemptId ||
          attempt.fingerprint !== sha256V2(canonicalJsonV2({
            attemptId: sourceAttemptId,
            outcomeCode: event.outcomeCode,
          }))) {
        storeErrorV2("storage-corrupt");
      }
    }
    if (event.eventType === "delete" &&
        (!tombstone || attempt.kind !== "deletion" || tombstone.attemptId !== sourceAttemptId ||
         attempt.fingerprint !== sha256V2(canonicalJsonV2(tombstone)))) {
      storeErrorV2("storage-corrupt");
    }
    return parseEventJsonV2(canonicalJsonV2(event));
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}

export function validateConsumerCheckpointBoundsV2(
  checkpoint: ConsumerCheckpointRecordV2,
  expectedConsumerId: string,
  expectedHostEpoch: string,
  headSeq: string,
  retentionFloor: string,
): void {
  const outstanding = BigInt(checkpoint.enqueuedThrough) -
    BigInt(checkpoint.acknowledgedThrough);
  if (checkpoint.consumerId !== expectedConsumerId ||
      checkpoint.hostEpoch !== expectedHostEpoch ||
      BigInt(checkpoint.enqueuedThrough) > BigInt(headSeq) ||
      BigInt(checkpoint.enqueuedThrough) + 1n < BigInt(retentionFloor) ||
      outstanding < 0n || outstanding > BigInt(MAX_CONSUMER_OUTSTANDING_V2)) {
    storeErrorV2("storage-corrupt");
  }
}

export function validateConsumerTaskEnvelopeV2(
  task: ConsumerTaskRecordV2,
  expectedConsumerId: string,
  expectedHostEpoch: string,
  expectedChangeSeq: string,
): void {
  if (task.consumerId !== expectedConsumerId || task.hostEpoch !== expectedHostEpoch ||
      task.event.hostEpoch !== expectedHostEpoch || task.event.changeSeq !== expectedChangeSeq ||
      task.deliveryId !== consumerDeliveryIdV2(
        expectedHostEpoch, expectedConsumerId, expectedChangeSeq,
      ) ||
      ((task.state === "leased" || task.state === "acknowledged") && task.attempts < 1)) {
    storeErrorV2("storage-corrupt");
  }
}

export function validateConsumerTaskSourceV2(
  db: ConsumerDatabaseV2,
  transaction: Transaction | undefined,
  task: ConsumerTaskRecordV2,
  expectedConsumerId: string,
  expectedHostEpoch: string,
  headSeq: string,
  retentionFloor: string,
): void {
  validateConsumerTaskEnvelopeV2(
    task, expectedConsumerId, expectedHostEpoch, task.event.changeSeq,
  );
  validateConsumerEventSourceV2(
    db, transaction, task.event, expectedHostEpoch, headSeq, retentionFloor,
  );
}

export function readConsumerTaskBySequenceV2(
  db: ConsumerDatabaseV2,
  transaction: Transaction | undefined,
  consumerId: string,
  hostEpoch: string,
  changeSeq: string,
) {
  const key = consumerInboxKeyV2(consumerId, changeSeq);
  const value = readConsumerValueV2(db, transaction, key);
  if (value === undefined) return undefined;
  const row = parseConsumerTaskAtKeyV2(key, value, consumerId);
  validateConsumerTaskEnvelopeV2(row.task, consumerId, hostEpoch, changeSeq);
  return row;
}

/** The persisted head of an outstanding span is never already ACKed. */
export function validateConsumerPrefixHeadV2(
  db: ConsumerDatabaseV2,
  transaction: Transaction | undefined,
  checkpoint: ConsumerCheckpointRecordV2,
  hostEpoch: string,
) {
  if (checkpoint.enqueuedThrough === checkpoint.acknowledgedThrough) return undefined;
  const firstSequence = (BigInt(checkpoint.acknowledgedThrough) + 1n).toString();
  const first = readConsumerTaskBySequenceV2(
    db, transaction, checkpoint.consumerId, hostEpoch, firstSequence,
  );
  if (!first || first.task.state === "acknowledged") storeErrorV2("storage-corrupt");
  return first;
}

export function validateConsumerJournalStateV2(
  db: ConsumerDatabaseV2,
  transaction: Transaction | undefined,
  expectedHostEpoch: string,
) {
  const state = readJournalStateV2((key) => readConsumerValueV2(db, transaction, key));
  if (state.hostEpoch !== expectedHostEpoch) storeErrorV2("storage-corrupt");
  return state;
}
