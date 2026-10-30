import type { Transaction } from "lmdb";

import { storeErrorV2 } from "./errors.js";
import {
  consumerCheckpointKeyV2,
  consumerInboxKeyV2,
  consumerPartitionV2,
  consumerPrefixEndV2,
  MAX_CONSUMERS_V2,
  MAX_CONSUMER_OUTSTANDING_V2,
  parseConsumerCheckpointV2,
  parseConsumerTaskAtKeyV2,
  readConsumerValueV2,
  type ConsumerCheckpointRecordV2,
  type ConsumerDatabaseV2,
} from "./consumer-records.js";
import {
  isSnapshotStoreError,
} from "./journal-validation.js";
import { readJournalStateV2 } from "./journal-records.js";
import { validateConsumerTaskSourceV2 } from "./consumer-validation.js";

type InboxRootTaskV2 = ReturnType<typeof parseConsumerTaskAtKeyV2>;

function requireStringEntry(entry: { key: unknown; value: unknown }): { key: string; value: string } {
  if (typeof entry.key !== "string" || typeof entry.value !== "string") {
    storeErrorV2("storage-corrupt");
  }
  return { key: entry.key, value: entry.value };
}

function entriesWithPrefix(
  db: ConsumerDatabaseV2,
  transaction: Transaction | undefined,
  prefix: string,
) {
  const end = consumerPrefixEndV2(prefix);
  return transaction === undefined
    ? db.getRange({ start: prefix, end })
    : db.getRange({ start: prefix, end, transaction });
}

function validateConsumerInboxRoots(
  db: ConsumerDatabaseV2,
  transaction: Transaction | undefined,
  hostEpoch: string,
): Map<string, ConsumerCheckpointRecordV2> {
  const state = readJournalStateV2((key) => readConsumerValueV2(db, transaction, key));
  if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");

  const checkpoints = new Map<string, ConsumerCheckpointRecordV2>();
  const consumerByPartition = new Map<string, string>();
  for (const rawEntry of entriesWithPrefix(db, transaction, "consumer:")) {
    const { key, value } = requireStringEntry(rawEntry);
    const checkpoint = parseConsumerCheckpointV2(value, undefined, hostEpoch);
    if (key !== consumerCheckpointKeyV2(checkpoint.consumerId) ||
        checkpoints.has(checkpoint.consumerId)) storeErrorV2("storage-corrupt");
    const outstanding = BigInt(checkpoint.enqueuedThrough) - BigInt(checkpoint.acknowledgedThrough);
    if (BigInt(checkpoint.enqueuedThrough) > BigInt(state.headSeq) ||
        BigInt(checkpoint.enqueuedThrough) + 1n < BigInt(state.retentionFloor) ||
        outstanding < 0n || outstanding > BigInt(MAX_CONSUMER_OUTSTANDING_V2)) {
      storeErrorV2("storage-corrupt");
    }
    const partition = consumerPartitionV2(checkpoint.consumerId);
    if (consumerByPartition.has(partition)) storeErrorV2("storage-corrupt");
    checkpoints.set(checkpoint.consumerId, checkpoint);
    consumerByPartition.set(partition, checkpoint.consumerId);
  }
  if (checkpoints.size > MAX_CONSUMERS_V2) storeErrorV2("storage-corrupt");

  const tasksByConsumer = new Map<string, Map<string, InboxRootTaskV2>>();
  for (const rawEntry of entriesWithPrefix(db, transaction, "inbox:")) {
    const { key, value } = requireStringEntry(rawEntry);
    const match = /^inbox:([a-f0-9]{64}):([0-9]{20})$/.exec(key);
    if (!match) storeErrorV2("storage-corrupt");
    const consumerId = consumerByPartition.get(match[1]!);
    if (!consumerId) storeErrorV2("storage-corrupt");
    const parsed = parseConsumerTaskAtKeyV2(key, value, consumerId);
    const checkpoint = checkpoints.get(consumerId);
    if (!checkpoint) storeErrorV2("storage-corrupt");
    const seq = BigInt(parsed.changeSeq);
    if (seq <= BigInt(checkpoint.acknowledgedThrough) ||
        seq > BigInt(checkpoint.enqueuedThrough)) storeErrorV2("storage-corrupt");
    const rows = tasksByConsumer.get(consumerId) ?? new Map<string, InboxRootTaskV2>();
    if (rows.has(parsed.changeSeq)) storeErrorV2("storage-corrupt");
    validateConsumerTaskSourceV2(
      db,
      transaction,
      parsed.task,
      consumerId,
      hostEpoch,
      state.headSeq,
      state.retentionFloor,
    );
    rows.set(parsed.changeSeq, parsed);
    if (rows.size > MAX_CONSUMER_OUTSTANDING_V2) storeErrorV2("storage-corrupt");
    tasksByConsumer.set(consumerId, rows);
  }

  for (const [consumerId, checkpoint] of checkpoints) {
    const rows = tasksByConsumer.get(consumerId) ?? new Map<string, InboxRootTaskV2>();
    const expectedCount = BigInt(checkpoint.enqueuedThrough) -
      BigInt(checkpoint.acknowledgedThrough);
    if (expectedCount !== BigInt(rows.size) || rows.size > MAX_CONSUMER_OUTSTANDING_V2) {
      storeErrorV2("storage-corrupt");
    }
    if (expectedCount > 0n &&
        rows.get((BigInt(checkpoint.acknowledgedThrough) + 1n).toString())?.task.state === "acknowledged") {
      storeErrorV2("storage-corrupt");
    }
    let expected = BigInt(checkpoint.acknowledgedThrough) + 1n;
    const end = BigInt(checkpoint.enqueuedThrough);
    while (expected <= end) {
      const changeSeq = expected.toString();
      const row = rows.get(changeSeq);
      if (!row || row.key !== consumerInboxKeyV2(consumerId, changeSeq) ||
          row.task.event.changeSeq !== changeSeq) storeErrorV2("storage-corrupt");
      expected += 1n;
    }
  }
  return checkpoints;
}

export function validateConsumerInboxRootsV2(
  db: ConsumerDatabaseV2,
  transaction: Transaction | undefined,
  hostEpoch: string,
): void {
  try {
    validateConsumerInboxRoots(db, transaction, hostEpoch);
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}

/** Prevent source-event pruning from passing any registered consumer cursor. */
export function assertConsumerPruneAllowedV2(
  db: ConsumerDatabaseV2,
  hostEpoch: string,
  through: string,
): void {
  try {
    const checkpoints = validateConsumerInboxRoots(db, undefined, hostEpoch);
    const pruneThrough = BigInt(through);
    for (const checkpoint of checkpoints.values()) {
      if (pruneThrough > BigInt(checkpoint.enqueuedThrough)) storeErrorV2("conflict");
    }
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}
