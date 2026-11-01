import { open as openLmdb, TransactionFlags } from "lmdb";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";

import { canonicalJsonV2 } from "../src/journal-validation.js";
import { consumerCheckpointKeyV2, consumerInboxKeyV2 } from "../src/consumer-records.js";
import type { LeasedConsumerTaskV2 } from "../src/consumer-types.js";
import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from "../src/index.js";
import type { JournalBackendV2 } from "../src/types.js";
import {
  closeConsumerJournal,
  expectStoreCode,
  newJournalDirectory,
  openConsumerJournal,
  seedOutcomeEvents,
} from "./helperconsumer-fixtures.js";

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
  consumerId: string,
  task: LeasedConsumerTaskV2,
) {
  return {
    consumerId,
    hostEpoch: store.hostEpoch,
    changeSeq: task.event.changeSeq,
    token: task.lease.token,
  };
}

describe("consumer acknowledgement-prefix integrity", () => {
  it("rejects an acknowledged first row when the checkpoint still has an unacked span", async () => {
    const journalDirectory = await newJournalDirectory("consumer-prefix-state-");
    let store = await openConsumerJournal(journalDirectory, { consumer: { now: () => 1_000 } });
    await seedOutcomeEvents(store, 1, "prefix-state-source");
    store.stageConsumerPage({
      consumerId: "prefix-state-worker", hostEpoch: store.hostEpoch, after: "0", limit: 1,
    });
    const claimed = store.claimConsumerEvent({
      consumerId: "prefix-state-worker", hostEpoch: store.hostEpoch, leaseMs: 10_000,
    });
    if (claimed.status !== "claimed") throw new Error("expected the first task to be leased");
    expect(claimed.task.attempts).toBe(1);
    const receipt = leaseRequest(store, "prefix-state-worker", claimed.task);
    await closeConsumerJournal(store);

    const database = await openRawDatabase(journalDirectory);
    try {
      database.transactionSync(() => {
        const key = consumerInboxKeyV2("prefix-state-worker", "1");
        const json = database.get(key);
        if (typeof json !== "string") throw new Error("missing first consumer task");
        const row = JSON.parse(json) as Record<string, unknown>;
        expect(row.state).toBe("leased");
        const leaseToken = row.leaseToken;
        if (typeof leaseToken !== "string") throw new Error("missing original claim token");
        row.state = "acknowledged";
        row.acknowledgedToken = leaseToken;
        delete row.leaseToken;
        delete row.leaseExpiresAtMs;
        database.putSync(key, canonicalJsonV2(row));
      }, TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
      const checkpoint = database.get(consumerCheckpointKeyV2("prefix-state-worker"));
      expect(typeof checkpoint).toBe("string");
      expect(JSON.parse(checkpoint as string)).toMatchObject({
        enqueuedThrough: "1", acknowledgedThrough: "0",
      });
    } finally {
      await database.close();
    }

    store = await openConsumerJournal(journalDirectory, { consumer: { now: () => 1_000 } });
    expectStoreCode(() => store.listReferencedObjects(), "storage-corrupt");
    expectStoreCode(() => store.readConsumerInbox({ consumerId: "prefix-state-worker", limit: 10 }),
      "storage-corrupt");
    expectStoreCode(() => store.claimConsumerEvent({
      consumerId: "prefix-state-worker", hostEpoch: store.hostEpoch, leaseMs: 10_000,
    }), "storage-corrupt");
    // The original token is deliberately valid for this now-acknowledged task;
    // an ACK retry must not bless the invalid prefix and advance the cursor.
    expectStoreCode(() => store.acknowledgeConsumerEvent(receipt), "storage-corrupt");
    expectStoreCode(() => store.pruneThrough("1"), "storage-corrupt");
    await closeConsumerJournal(store);

    const verify = await openRawDatabase(journalDirectory);
    try {
      const checkpoint = verify.get(consumerCheckpointKeyV2("prefix-state-worker"));
      const task = verify.get(consumerInboxKeyV2("prefix-state-worker", "1"));
      if (typeof checkpoint !== "string" || typeof task !== "string") {
        throw new Error("rejecting the corrupt prefix must preserve both records");
      }
      expect(JSON.parse(checkpoint)).toMatchObject({
        enqueuedThrough: "1", acknowledgedThrough: "0",
      });
      expect(JSON.parse(task)).toMatchObject({
        state: "acknowledged", event: { changeSeq: "1" },
      });
    } finally {
      await verify.close();
    }
  });

  it("does not compact an acknowledged hole whose immutable source binding is corrupt", async () => {
    const journalDirectory = await newJournalDirectory("consumer-prefix-corrupt-");
    let store = await openConsumerJournal(journalDirectory);
    await seedOutcomeEvents(store, 2, "prefix-integrity-source");
    store.stageConsumerPage({
      consumerId: "prefix-integrity-worker",
      hostEpoch: store.hostEpoch,
      after: "0",
      limit: 2,
    });

    const first = store.claimConsumerEvent({
      consumerId: "prefix-integrity-worker", hostEpoch: store.hostEpoch, leaseMs: 10_000,
    });
    const second = store.claimConsumerEvent({
      consumerId: "prefix-integrity-worker", hostEpoch: store.hostEpoch, leaseMs: 10_000,
    });
    if (first.status !== "claimed" || second.status !== "claimed") {
      throw new Error("expected both unrelated outcome events to be leased");
    }
    expect(first.task.event.changeSeq).toBe("1");
    expect(second.task.event.changeSeq).toBe("2");
    expect(store.acknowledgeConsumerEvent(leaseRequest(store, "prefix-integrity-worker", second.task)))
      .toMatchObject({ replayed: false, checkpoint: { acknowledgedThrough: "0" } });
    const firstAck = leaseRequest(store, "prefix-integrity-worker", first.task);
    await closeConsumerJournal(store);

    const database = await openRawDatabase(journalDirectory);
    try {
      database.transactionSync(() => {
        const key = consumerInboxKeyV2("prefix-integrity-worker", "2");
        const json = database.get(key);
        if (typeof json !== "string") throw new Error("missing acknowledged hole row");
        const row = JSON.parse(json) as { event: Record<string, unknown>; [key: string]: unknown };
        expect(row.state).toBe("acknowledged");
        // Keep the row canonical and sequence/epoch/delivery identity valid while
        // breaking its relationship to the immutable journal attempt.
        row.event = { ...row.event, outcomeCode: "timeout" };
        database.putSync(key, canonicalJsonV2(row));
      }, TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
    } finally {
      await database.close();
    }

    store = await openConsumerJournal(journalDirectory);
    expectStoreCode(() => store.acknowledgeConsumerEvent(firstAck), "storage-corrupt");
    expect(store.getConsumerCheckpoint("prefix-integrity-worker")).toMatchObject({
      enqueuedThrough: "2", acknowledgedThrough: "0",
    });
    await closeConsumerJournal(store);

    const verify = await openRawDatabase(journalDirectory);
    try {
      const firstJson = verify.get(consumerInboxKeyV2("prefix-integrity-worker", "1"));
      const secondJson = verify.get(consumerInboxKeyV2("prefix-integrity-worker", "2"));
      if (typeof firstJson !== "string" || typeof secondJson !== "string") {
        throw new Error("failed ACK must preserve both rows");
      }
      expect(JSON.parse(firstJson)).toMatchObject({ state: "leased", event: { changeSeq: "1" } });
      expect(JSON.parse(secondJson)).toMatchObject({ state: "acknowledged", event: { changeSeq: "2" } });
    } finally {
      await verify.close();
    }

    await expect(openSnapshotStoreV2({
      directory: dirname(journalDirectory),
      policy: new PolicyCommitAuthorityV2("policy-1"),
      scan: async () => [],
    })).rejects.toMatchObject({ code: "storage-corrupt" });
  });
});
