import { open as openLmdb, TransactionFlags } from "lmdb";
import { describe, expect, it } from "vitest";

import { consumerCheckpointKeyV2 } from "../src/consumer-records.js";
import { JOURNAL_META_V2 } from "../src/journal-records.js";
import { canonicalJsonV2 } from "../src/journal-validation.js";
import type { JournalBackendV2 } from "../src/types.js";
import {
  closeConsumerJournal,
  expectStoreCode,
  newJournalDirectory,
  openConsumerJournal,
} from "./helperconsumer-fixtures.js";

const MAX_CHANGE_SEQUENCE = "18446744073709551615";
const BEFORE_MAX_CHANGE_SEQUENCE = "18446744073709551614";
const CONSUMER_ID = "boundary-sequence-worker";

async function openRawDatabase(directory: string) {
  return openLmdb<string, string>(directory, {
    encoding: "string",
    keyEncoding: "ordered-binary",
    cache: false,
    compression: false,
    useWritemap: false,
    overlappingSync: false,
    noSync: false,
    noMetaSync: false,
    noMemInit: false,
  });
}

function leaseRequest(
  store: JournalBackendV2,
  task: Extract<ReturnType<JournalBackendV2["claimConsumerEvent"]>, { status: "claimed" }> ["task"],
) {
  return {
    consumerId: CONSUMER_ID,
    hostEpoch: store.hostEpoch,
    changeSeq: task.event.changeSeq,
    token: task.lease.token,
  };
}

describe("consumer uint64 sequence boundaries", () => {
  it("stages, claims, ACKs, and rejects append overflow at uint64 max without rounding", async () => {
    const directory = await newJournalDirectory("consumer-sequence-max-");
    let store = await openConsumerJournal(directory);
    const hostEpoch = store.hostEpoch;
    await closeConsumerJournal(store);

    const raw = await openRawDatabase(directory);
    try {
      raw.transactionSync(() => {
        raw.putSync(JOURNAL_META_V2.headSeq, BEFORE_MAX_CHANGE_SEQUENCE);
        raw.putSync(JOURNAL_META_V2.retentionFloor, MAX_CHANGE_SEQUENCE);
        raw.putSync(consumerCheckpointKeyV2(CONSUMER_ID), canonicalJsonV2({
          consumerId: CONSUMER_ID,
          hostEpoch,
          enqueuedThrough: BEFORE_MAX_CHANGE_SEQUENCE,
          acknowledgedThrough: BEFORE_MAX_CHANGE_SEQUENCE,
        }));
      }, TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
    } finally {
      await raw.close();
    }

    store = await openConsumerJournal(directory, { consumer: { now: () => 1_000 } });
    expect(store.getConsumerCheckpoint(CONSUMER_ID)).toMatchObject({
      enqueuedThrough: BEFORE_MAX_CHANGE_SEQUENCE,
      acknowledgedThrough: BEFORE_MAX_CHANGE_SEQUENCE,
    });

    const source = store.recordOutcome("sequence-boundary-source", "unsupported").event;
    expect(source.changeSeq).toBe(MAX_CHANGE_SEQUENCE);
    expect(store.readChanges({
      hostEpoch,
      after: BEFORE_MAX_CHANGE_SEQUENCE,
      limit: 1,
    })).toMatchObject({ status: "ok", nextCursor: MAX_CHANGE_SEQUENCE, events: [source] });
    const outboxBeforeConsumerOps = store.readOutbox(10);
    expect(outboxBeforeConsumerOps.map((event) => event.changeSeq)).toEqual([MAX_CHANGE_SEQUENCE]);

    const staged = store.stageConsumerPage({
      consumerId: CONSUMER_ID,
      hostEpoch,
      after: BEFORE_MAX_CHANGE_SEQUENCE,
      limit: 1,
    });
    expect(staged).toMatchObject({
      status: "staged",
      stagedCount: 1,
      checkpoint: {
        enqueuedThrough: MAX_CHANGE_SEQUENCE,
        acknowledgedThrough: BEFORE_MAX_CHANGE_SEQUENCE,
      },
    });
    expect(store.readConsumerInbox({ consumerId: CONSUMER_ID, limit: 1 })!.tasks[0]!.event.changeSeq)
      .toBe(MAX_CHANGE_SEQUENCE);

    const claim = store.claimConsumerEvent({
      consumerId: CONSUMER_ID,
      hostEpoch,
      leaseMs: 10_000,
    });
    if (claim.status !== "claimed") throw new Error(`expected uint64-max claim, received ${claim.status}`);
    expect(claim.task.event.changeSeq).toBe(MAX_CHANGE_SEQUENCE);
    const acknowledged = store.acknowledgeConsumerEvent(leaseRequest(store, claim.task));
    expect(acknowledged).toMatchObject({
      status: "acknowledged",
      replayed: false,
      checkpoint: {
        enqueuedThrough: MAX_CHANGE_SEQUENCE,
        acknowledgedThrough: MAX_CHANGE_SEQUENCE,
      },
    });
    expect(store.readConsumerInbox({ consumerId: CONSUMER_ID, limit: 1 })!.tasks).toEqual([]);
    expect(store.readOutbox(10)).toEqual(outboxBeforeConsumerOps);

    expectStoreCode(() => store.recordOutcome("sequence-overflow-after-max", "unsupported"), "over-limit");
    expect(store.readChanges({ hostEpoch, after: MAX_CHANGE_SEQUENCE, limit: 1 }))
      .toMatchObject({ status: "ok", latestChangeSeq: MAX_CHANGE_SEQUENCE, nextCursor: MAX_CHANGE_SEQUENCE, events: [] });
    expect(store.getConsumerCheckpoint(CONSUMER_ID)).toMatchObject({
      enqueuedThrough: MAX_CHANGE_SEQUENCE,
      acknowledgedThrough: MAX_CHANGE_SEQUENCE,
    });
    expect(store.readOutbox(10)).toEqual(outboxBeforeConsumerOps);
  });
});
