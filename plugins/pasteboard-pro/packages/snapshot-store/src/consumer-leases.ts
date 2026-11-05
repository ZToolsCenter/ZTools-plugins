import { randomUUID } from "node:crypto";
import type { RootDatabase } from "lmdb";

import { storeErrorV2 } from "./errors.js";
import {
  consumerCheckpointKeyV2,
  consumerTaskToPublicV2,
  parseConsumerCheckpointV2,
  readConsumerValueV2,
  writeConsumerJsonV2,
  type ConsumerCheckpointRecordV2,
  type ConsumerFaultV2,
  type ConsumerTaskRecordV2,
  type ConsumerDatabaseV2,
} from "./consumer-records.js";
import {
  consumerDeliveryIdV2,
  readConsumerTaskBySequenceV2,
  validateClaimConsumerRequestV2,
  validateConsumerCheckpointBoundsV2,
  validateConsumerJournalStateV2,
  validateConsumerLeaseRequestV2,
  validateConsumerTaskSourceV2,
  validateConsumerPrefixHeadV2,
} from "./consumer-validation.js";
import { isSnapshotStoreError } from "./journal-validation.js";
import type {
  AcknowledgeConsumerResultV2,
  ClaimConsumerRequestV2,
  ClaimConsumerResultV2,
  ConsumerInboxFaultPointV2,
  ConsumerLeaseRequestV2,
  ConsumerCheckpointV2,
} from "./consumer-types.js";
import type { ConsumerInboxOptionsV2 } from "./consumer-types.js";

type DatabaseV2 = RootDatabase<string, string>;
type AtomicWriteV2 = <T>(callback: () => T) => T;

function cloneCheckpoint(checkpoint: ConsumerCheckpointRecordV2): ConsumerCheckpointV2 {
  return Object.freeze({ ...checkpoint });
}

function injectFault(
  fault: ConsumerFaultV2 | undefined,
  point: ConsumerInboxFaultPointV2,
): void {
  try {
    fault?.(point);
  } catch {
    storeErrorV2("storage-failed");
  }
}

function checkpointForWrite(
  db: DatabaseV2,
  consumerId: string,
  hostEpoch: string,
) {
  const json = readConsumerValueV2(db, undefined, consumerCheckpointKeyV2(consumerId));
  return json === undefined ? undefined : parseConsumerCheckpointV2(json, consumerId, hostEpoch);
}

function readNow(options: ConsumerInboxOptionsV2): number {
  let value: unknown;
  try {
    value = options.now ? options.now() : Date.now();
  } catch {
    storeErrorV2("storage-failed");
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    storeErrorV2("storage-failed");
  }
  return value;
}

function snapshotLockKey(task: ConsumerTaskRecordV2): string | undefined {
  return task.event.eventType === "outcome" ? undefined : task.event.snapshotId;
}

export function createConsumerLeaseMethodsV2(
  db: DatabaseV2,
  hostEpoch: string,
  ensureOpen: () => void,
  runWrite: AtomicWriteV2,
  options: ConsumerInboxOptionsV2,
): Readonly<{
  claimConsumerEvent(request: ClaimConsumerRequestV2): ClaimConsumerResultV2;
  acknowledgeConsumerEvent(request: ConsumerLeaseRequestV2): AcknowledgeConsumerResultV2;
  releaseConsumerEvent(request: ConsumerLeaseRequestV2): ConsumerCheckpointV2;
}> {
  const claimConsumerEvent = (input: ClaimConsumerRequestV2): ClaimConsumerResultV2 => {
    ensureOpen();
    const request = validateClaimConsumerRequestV2(input);
    return runWrite(() => {
      try {
        const state = validateConsumerJournalStateV2(db, undefined, hostEpoch);
        if (request.hostEpoch !== state.hostEpoch) storeErrorV2("conflict");
        const checkpoint = checkpointForWrite(db, request.consumerId, hostEpoch);
        if (!checkpoint) storeErrorV2("conflict");
        validateConsumerCheckpointBoundsV2(
          checkpoint, request.consumerId, hostEpoch, state.headSeq, state.retentionFloor,
        );
        const now = readNow(options);
        const lockedSnapshots = new Set<string>();
        let selected: NonNullable<ReturnType<typeof readConsumerTaskBySequenceV2>> | undefined;
        const ackThrough = BigInt(checkpoint.acknowledgedThrough);
        const enqueuedThrough = BigInt(checkpoint.enqueuedThrough);
        const first = validateConsumerPrefixHeadV2(db, undefined, checkpoint, hostEpoch);
        for (let sequence = ackThrough + 1n; sequence <= enqueuedThrough; sequence += 1n) {
          const row = sequence === ackThrough + 1n
            ? first
            : readConsumerTaskBySequenceV2(
              db, undefined, request.consumerId, hostEpoch, sequence.toString(),
            );
          if (!row) storeErrorV2("storage-corrupt");
          const task = row.task;
          if (task.state === "acknowledged") continue;
          const lockKey = snapshotLockKey(task);
          if (task.state === "leased" && task.leaseExpiresAtMs > now) {
            validateConsumerTaskSourceV2(
              db, undefined, task, request.consumerId, hostEpoch,
              state.headSeq, state.retentionFloor,
            );
            if (lockKey !== undefined) lockedSnapshots.add(lockKey);
            continue;
          }
          if (lockKey !== undefined && lockedSnapshots.has(lockKey)) continue;
          validateConsumerTaskSourceV2(
            db, undefined, task, request.consumerId, hostEpoch,
            state.headSeq, state.retentionFloor,
          );
          selected = row;
          break;
        }
        if (!selected) {
          return Object.freeze({ status: "idle" as const, checkpoint: cloneCheckpoint(checkpoint) });
        }

        const previous = selected.task;
        if (previous.attempts >= Number.MAX_SAFE_INTEGER) storeErrorV2("over-limit");
        const expiresAtMs = now + request.leaseMs;
        if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < 0) storeErrorV2("over-limit");
        const task: ConsumerTaskRecordV2 = {
          consumerId: request.consumerId,
          hostEpoch,
          event: previous.event,
          deliveryId: consumerDeliveryIdV2(hostEpoch, request.consumerId, previous.event.changeSeq),
          attempts: previous.attempts + 1,
          state: "leased",
          leaseToken: randomUUID(),
          leaseExpiresAtMs: expiresAtMs,
        };
        writeConsumerJsonV2(db, selected.key, task);
        injectFault(options.fault, "after-lease-write");
        return Object.freeze({
          status: "claimed" as const,
          checkpoint: cloneCheckpoint(checkpoint),
          task: consumerTaskToPublicV2(task) as Extract<ReturnType<typeof consumerTaskToPublicV2>, { state: "leased" }>,
        });
      } catch (error) {
        if (isSnapshotStoreError(error)) throw error;
        storeErrorV2("storage-failed");
      }
    });
  };

  const acknowledgeConsumerEvent = (
    input: ConsumerLeaseRequestV2,
  ): AcknowledgeConsumerResultV2 => {
    ensureOpen();
    const request = validateConsumerLeaseRequestV2(input);
    return runWrite(() => {
      try {
        const state = validateConsumerJournalStateV2(db, undefined, hostEpoch);
        if (request.hostEpoch !== state.hostEpoch) storeErrorV2("conflict");
        const checkpoint = checkpointForWrite(db, request.consumerId, hostEpoch);
        if (!checkpoint) storeErrorV2("conflict");
        validateConsumerCheckpointBoundsV2(
          checkpoint, request.consumerId, hostEpoch, state.headSeq, state.retentionFloor,
        );
        const sequence = BigInt(request.changeSeq);
        const ackThrough = BigInt(checkpoint.acknowledgedThrough);
        const enqueuedThrough = BigInt(checkpoint.enqueuedThrough);
        if (sequence <= ackThrough) {
          return Object.freeze({
            status: "acknowledged" as const,
            checkpoint: cloneCheckpoint(checkpoint),
            replayed: true,
          });
        }
        if (sequence > enqueuedThrough) storeErrorV2("conflict");
        validateConsumerPrefixHeadV2(db, undefined, checkpoint, hostEpoch);
        const selected = readConsumerTaskBySequenceV2(
          db, undefined, request.consumerId, hostEpoch, request.changeSeq,
        );
        if (!selected) storeErrorV2("storage-corrupt");
        const task = selected.task;
        validateConsumerTaskSourceV2(
          db, undefined, task, request.consumerId, hostEpoch,
          state.headSeq, state.retentionFloor,
        );
        if (task.state === "acknowledged") {
          if (task.acknowledgedToken !== request.token) storeErrorV2("conflict");
          return Object.freeze({
            status: "acknowledged" as const,
            checkpoint: cloneCheckpoint(checkpoint),
            replayed: true,
          });
        }
        if (task.state !== "leased" || task.leaseToken !== request.token) {
          storeErrorV2("conflict");
        }
        const now = readNow(options);
        if (task.leaseExpiresAtMs <= now) storeErrorV2("conflict");

        const acknowledged: ConsumerTaskRecordV2 = {
          consumerId: task.consumerId,
          hostEpoch: task.hostEpoch,
          event: task.event,
          deliveryId: task.deliveryId,
          attempts: task.attempts,
          state: "acknowledged",
          acknowledgedToken: request.token,
        };
        writeConsumerJsonV2(db, selected.key, acknowledged);
        injectFault(options.fault, "after-ack-write");

        let nextAck = ackThrough;
        while (nextAck < enqueuedThrough) {
          const nextSeq = (nextAck + 1n).toString();
          const row = nextSeq === request.changeSeq
            ? { ...selected, task: acknowledged }
            : readConsumerTaskBySequenceV2(
              db, undefined, request.consumerId, hostEpoch, nextSeq,
            );
          if (!row) storeErrorV2("storage-corrupt");
          if (row.task.state !== "acknowledged") break;
          if (nextSeq !== request.changeSeq) {
            validateConsumerTaskSourceV2(
              db, undefined, row.task, request.consumerId, hostEpoch,
              state.headSeq, state.retentionFloor,
            );
          }
          if (!db.removeSync(row.key)) storeErrorV2("storage-corrupt");
          nextAck += 1n;
        }
        let resultCheckpoint = checkpoint;
        if (nextAck !== ackThrough) {
          injectFault(options.fault, "before-ack-cursor-advance");
          resultCheckpoint = {
            ...checkpoint,
            acknowledgedThrough: nextAck.toString(),
          };
          writeConsumerJsonV2(
            db, consumerCheckpointKeyV2(request.consumerId), resultCheckpoint,
          );
        }
        return Object.freeze({
          status: "acknowledged" as const,
          checkpoint: cloneCheckpoint(resultCheckpoint),
          replayed: false,
        });
      } catch (error) {
        if (isSnapshotStoreError(error)) throw error;
        storeErrorV2("storage-failed");
      }
    });
  };

  const releaseConsumerEvent = (input: ConsumerLeaseRequestV2): ConsumerCheckpointV2 => {
    ensureOpen();
    const request = validateConsumerLeaseRequestV2(input);
    return runWrite(() => {
      try {
        const state = validateConsumerJournalStateV2(db, undefined, hostEpoch);
        if (request.hostEpoch !== state.hostEpoch) storeErrorV2("conflict");
        const checkpoint = checkpointForWrite(db, request.consumerId, hostEpoch);
        if (!checkpoint) storeErrorV2("conflict");
        validateConsumerCheckpointBoundsV2(
          checkpoint, request.consumerId, hostEpoch, state.headSeq, state.retentionFloor,
        );
        validateConsumerPrefixHeadV2(db, undefined, checkpoint, hostEpoch);
        const sequence = BigInt(request.changeSeq);
        if (sequence <= BigInt(checkpoint.acknowledgedThrough) ||
            sequence > BigInt(checkpoint.enqueuedThrough)) storeErrorV2("conflict");
        const selected = readConsumerTaskBySequenceV2(
          db, undefined, request.consumerId, hostEpoch, request.changeSeq,
        );
        if (!selected) storeErrorV2("storage-corrupt");
        const task = selected.task;
        validateConsumerTaskSourceV2(
          db, undefined, task, request.consumerId, hostEpoch,
          state.headSeq, state.retentionFloor,
        );
        if (task.state !== "leased" || task.leaseToken !== request.token) {
          storeErrorV2("conflict");
        }
        const now = readNow(options);
        if (task.leaseExpiresAtMs <= now) storeErrorV2("conflict");
        writeConsumerJsonV2(db, selected.key, {
          consumerId: task.consumerId,
          hostEpoch: task.hostEpoch,
          event: task.event,
          deliveryId: task.deliveryId,
          attempts: task.attempts,
          state: "pending",
        });
        return cloneCheckpoint(checkpoint);
      } catch (error) {
        if (isSnapshotStoreError(error)) throw error;
        storeErrorV2("storage-failed");
      }
    });
  };

  return Object.freeze({
    claimConsumerEvent,
    acknowledgeConsumerEvent,
    releaseConsumerEvent,
  });
}
