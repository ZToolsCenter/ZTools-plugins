import type { RootDatabase } from "lmdb";

import {
  parseReadResultV2,
  isSnapshotStoreError,
} from "./journal-validation.js";
import { storeErrorV2 } from "./errors.js";
import {
  consumerCheckpointKeyV2,
  consumerInboxKeyV2,
  MAX_CHANGE_SEQUENCE_V2,
  MAX_CONSUMERS_V2,
  MAX_CONSUMER_OUTSTANDING_V2,
  parseConsumerCheckpointV2,
  readConsumerValueV2,
  consumerTaskToInboxSummaryV2,
  writeConsumerJsonV2,
  type ConsumerCheckpointRecordV2,
  type ConsumerFaultV2,
} from "./consumer-records.js";
import type { ClipboardJournalCursorExpiredV2, ClipboardJournalHostResetV2 } from "@pasteboard-pro/core";
import {
  eventKeyV2,
  parseEventAtKey,
  readJournalStateV2,
  transactionRead,
} from "./journal-records.js";
import {
  consumerDeliveryIdV2,
  validateConsumerIdV2,
  validateConsumerEventSourceV2,
  validateConsumerCheckpointBoundsV2,
  validateConsumerPrefixHeadV2,
  readConsumerTaskBySequenceV2,
  validateConsumerTaskSourceV2,
  validateReadConsumerInboxRequestV2,
  validateStageConsumerRequestV2,
} from "./consumer-validation.js";
import type {
  ConsumerCheckpointV2,
  StageConsumerRequestV2,
  StageConsumerResultV2,
} from "./consumer-types.js";

type DatabaseV2 = RootDatabase<string, string>;
type AtomicWriteV2 = <T>(callback: () => T) => T;

function cloneCheckpoint(checkpoint: ConsumerCheckpointRecordV2): ConsumerCheckpointV2 {
  return Object.freeze({ ...checkpoint });
}

function readStateForWrite(db: DatabaseV2, hostEpoch: string) {
  const state = readJournalStateV2((key) => readConsumerValueV2(db, undefined, key));
  if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
  return state;
}

function checkpointForWrite(
  db: DatabaseV2,
  consumerId: string,
  hostEpoch: string,
): ConsumerCheckpointRecordV2 | undefined {
  const json = readConsumerValueV2(db, undefined, consumerCheckpointKeyV2(consumerId));
  return json === undefined ? undefined : parseConsumerCheckpointV2(json, consumerId, hostEpoch);
}

function validateConsumerCount(db: DatabaseV2, hostEpoch: string): number {
  let count = 0;
  for (const entry of db.getRange({ start: "consumer:", end: "consumer;" })) {
    if (typeof entry.key !== "string" || typeof entry.value !== "string") {
      storeErrorV2("storage-corrupt");
    }
    const checkpoint = parseConsumerCheckpointV2(entry.value, undefined, hostEpoch);
    if (entry.key !== consumerCheckpointKeyV2(checkpoint.consumerId)) {
      storeErrorV2("storage-corrupt");
    }
    count += 1;
  }
  if (count > MAX_CONSUMERS_V2) storeErrorV2("storage-corrupt");
  return count;
}

function injectFault(
  fault: ConsumerFaultV2 | undefined,
  point: Parameters<NonNullable<ConsumerFaultV2>>[0],
): void {
  try {
    fault?.(point);
  } catch {
    storeErrorV2("storage-failed");
  }
}

function hostReset(
  request: StageConsumerRequestV2,
  hostEpoch: string,
  retentionFloor: string,
): ClipboardJournalHostResetV2 {
  const result = parseReadResultV2({
    status: "host-reset",
    expectedHostEpoch: request.hostEpoch,
    hostEpoch,
    requestedCursor: request.after,
    retentionFloor,
    reason: "host-epoch-changed",
  });
  if (result.status !== "host-reset") storeErrorV2("storage-corrupt");
  return result;
}

function cursorExpired(
  request: StageConsumerRequestV2,
  hostEpoch: string,
  retentionFloor: string,
): ClipboardJournalCursorExpiredV2 {
  const result = parseReadResultV2({
    status: "cursor-expired",
    hostEpoch,
    requestedCursor: request.after,
    retentionFloor,
    reason: "retention",
  });
  if (result.status !== "cursor-expired") storeErrorV2("storage-corrupt");
  return result;
}

function nextSourceEvents(
  db: DatabaseV2,
  hostEpoch: string,
  request: StageConsumerRequestV2,
  headSeq: string,
  retentionFloor: string,
) {
  const after = BigInt(request.after);
  const head = BigInt(headSeq);
  if (after >= head) return [];
  const expectedCount = Number(head - after > BigInt(request.limit)
    ? BigInt(request.limit)
    : head - after);
  const first = after + 1n;
  const last = first + BigInt(expectedCount) - 1n;
  const end = last === MAX_CHANGE_SEQUENCE_V2
    ? "event;"
    : eventKeyV2((last + 1n).toString());
  const events: ReturnType<typeof parseEventAtKey>[] = [];
  let expected = first;
  for (const entry of db.getRange({
    start: eventKeyV2(first.toString()),
    end,
    limit: expectedCount,
  })) {
    if (typeof entry.key !== "string" || typeof entry.value !== "string" ||
        entry.key !== eventKeyV2(expected.toString())) storeErrorV2("storage-corrupt");
    const event = parseEventAtKey(db, undefined, entry.key, "event:", hostEpoch);
    validateConsumerEventSourceV2(
      db, undefined, event, hostEpoch, headSeq, retentionFloor,
    );
    events.push(event);
    expected += 1n;
  }
  if (expected !== last + 1n) storeErrorV2("storage-corrupt");
  return events;
}

export function createStageConsumerPageMethodV2(
  db: DatabaseV2,
  hostEpoch: string,
  ensureOpen: () => void,
  runWrite: AtomicWriteV2,
  fault: ConsumerFaultV2 | undefined,
): (request: StageConsumerRequestV2) => StageConsumerResultV2 {
  return (input) => {
    ensureOpen();
    const request = validateStageConsumerRequestV2(input);
    return runWrite(() => {
      try {
        const state = readStateForWrite(db, hostEpoch);
        if (request.hostEpoch !== state.hostEpoch) {
          return hostReset(request, state.hostEpoch, state.retentionFloor);
        }

        const prior = checkpointForWrite(db, request.consumerId, hostEpoch);
        if (prior) {
          validateConsumerCheckpointBoundsV2(
            prior, request.consumerId, hostEpoch, state.headSeq, state.retentionFloor,
          );
          validateConsumerPrefixHeadV2(db, undefined, prior, hostEpoch);
          if (BigInt(request.after) < BigInt(prior.enqueuedThrough)) {
            return Object.freeze({
              status: "staged" as const,
              checkpoint: cloneCheckpoint(prior),
              stagedCount: 0,
              replayed: true,
            });
          }
          if (BigInt(request.after) > BigInt(prior.enqueuedThrough)) storeErrorV2("conflict");
        } else {
          if (request.after !== "0") storeErrorV2("conflict");
        }

        const after = BigInt(request.after);
        if (after > BigInt(state.headSeq)) storeErrorV2("conflict");
        if (BigInt(state.retentionFloor) > after + 1n) {
          return cursorExpired(request, state.hostEpoch, state.retentionFloor);
        }
        if (!prior && validateConsumerCount(db, hostEpoch) >= MAX_CONSUMERS_V2) {
          storeErrorV2("over-limit");
        }

        const events = nextSourceEvents(
          db, hostEpoch, request, state.headSeq, state.retentionFloor,
        );
        const acknowledgedThrough = prior?.acknowledgedThrough ?? "0";
        const outstanding = BigInt(prior?.enqueuedThrough ?? "0") -
          BigInt(acknowledgedThrough);
        if (outstanding + BigInt(events.length) > BigInt(MAX_CONSUMER_OUTSTANDING_V2)) {
          if (!prior) storeErrorV2("storage-corrupt");
          return Object.freeze({
            status: "queue-full" as const,
            checkpoint: cloneCheckpoint(prior),
            capacity: MAX_CONSUMER_OUTSTANDING_V2,
          });
        }

        for (const event of events) {
          const key = consumerInboxKeyV2(request.consumerId, event.changeSeq);
          if (readConsumerValueV2(db, undefined, key) !== undefined) storeErrorV2("storage-corrupt");
          writeConsumerJsonV2(db, key, {
            consumerId: request.consumerId,
            hostEpoch,
            event,
            deliveryId: consumerDeliveryIdV2(hostEpoch, request.consumerId, event.changeSeq),
            attempts: 0,
            state: "pending",
          });
        }
        if (events.length > 0) injectFault(fault, "after-inbox-write");

        const checkpoint: ConsumerCheckpointRecordV2 = {
          consumerId: request.consumerId,
          hostEpoch,
          enqueuedThrough: events.length > 0
            ? events[events.length - 1]!.changeSeq
            : prior?.enqueuedThrough ?? "0",
          acknowledgedThrough,
        };
        const advancesCursor = !prior || checkpoint.enqueuedThrough !== prior.enqueuedThrough;
        if (advancesCursor) {
          injectFault(fault, "before-cursor-advance");
          writeConsumerJsonV2(db, consumerCheckpointKeyV2(request.consumerId), checkpoint);
        }
        return Object.freeze({
          status: "staged" as const,
          checkpoint: cloneCheckpoint(checkpoint),
          stagedCount: events.length,
          replayed: false,
        });
      } catch (error) {
        if (isSnapshotStoreError(error)) throw error;
        storeErrorV2("storage-failed");
      }
    });
  };
}

export function readConsumerCheckpointMethodV2(
  db: DatabaseV2,
  hostEpoch: string,
  ensureOpen: () => void,
  consumerIdInput: string,
): ConsumerCheckpointV2 | undefined {
  ensureOpen();
  const consumerId = validateConsumerIdV2(consumerIdInput);
  return transactionRead(db, (transaction) => {
    const state = readJournalStateV2((key) => readConsumerValueV2(db, transaction, key));
    if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
    const json = readConsumerValueV2(db, transaction, consumerCheckpointKeyV2(consumerId));
    if (json === undefined) return undefined;
    const checkpoint = parseConsumerCheckpointV2(json, consumerId, hostEpoch);
    validateConsumerCheckpointBoundsV2(
      checkpoint, consumerId, hostEpoch, state.headSeq, state.retentionFloor,
    );
    validateConsumerPrefixHeadV2(db, transaction, checkpoint, hostEpoch);
    return cloneCheckpoint(checkpoint);
  });
}

export function readConsumerInboxPageMethodV2(
  db: DatabaseV2,
  hostEpoch: string,
  ensureOpen: () => void,
  input: unknown,
) {
  ensureOpen();
  const request = validateReadConsumerInboxRequestV2(input);
  return transactionRead(db, (transaction) => {
    const state = readJournalStateV2((key) => readConsumerValueV2(db, transaction, key));
    if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
    const json = readConsumerValueV2(
      db, transaction, consumerCheckpointKeyV2(request.consumerId),
    );
    if (json === undefined) return undefined;
    const checkpoint = parseConsumerCheckpointV2(json, request.consumerId, hostEpoch);
    validateConsumerCheckpointBoundsV2(
      checkpoint, request.consumerId, hostEpoch, state.headSeq, state.retentionFloor,
    );
    const span = BigInt(checkpoint.enqueuedThrough) - BigInt(checkpoint.acknowledgedThrough);
    const first = validateConsumerPrefixHeadV2(db, transaction, checkpoint, hostEpoch);
    const count = Number(span < BigInt(request.limit) ? span : BigInt(request.limit));
    const tasks = [];
    for (let offset = 1; offset <= count; offset += 1) {
      const changeSeq = (BigInt(checkpoint.acknowledgedThrough) + BigInt(offset)).toString();
      const row = offset === 1
        ? first
        : readConsumerTaskBySequenceV2(db, transaction, request.consumerId, hostEpoch, changeSeq);
      if (!row) storeErrorV2("storage-corrupt");
      validateConsumerTaskSourceV2(
        db, transaction, row.task, request.consumerId, hostEpoch,
        state.headSeq, state.retentionFloor,
      );
      tasks.push(consumerTaskToInboxSummaryV2(row.task));
    }
    return Object.freeze({ checkpoint: cloneCheckpoint(checkpoint), tasks: Object.freeze(tasks) });
  });
}
