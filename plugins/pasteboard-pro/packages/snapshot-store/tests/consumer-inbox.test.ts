import { describe, expect, it } from "vitest";

import { makeCaptureFixture } from "./journal-fixtures.js";
import {
  closeConsumerJournal,
  expectStoreCode,
  newJournalDirectory,
  openConsumerJournal,
  seedOutcomeEvents,
} from "./helperconsumer-fixtures.js";
import type { JournalBackendV2 } from "../src/types.js";

function sourceEvents(store: JournalBackendV2) {
  const page = store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 500 });
  if (page.status !== "ok") throw new Error(`unexpected source read: ${page.status}`);
  return page.events;
}

function leaseRequest(
  store: JournalBackendV2,
  consumerId: string,
  task: { event: { changeSeq: string }; lease: { token: string } },
) {
  return {
    consumerId,
    hostEpoch: store.hostEpoch,
    changeSeq: task.event.changeSeq,
    token: task.lease.token,
  };
}

function requireClaim(result: ReturnType<JournalBackendV2["claimConsumerEvent"]>) {
  if (result.status !== "claimed") throw new Error(`expected a claim, received ${result.status}`);
  return result;
}

describe("durable metadata-only consumer inbox", () => {
  it("stages only real journal events, replays stale cursors without duplication, and survives restart", async () => {
    const directory = await newJournalDirectory();
    let store = await openConsumerJournal(directory);
    const first = store.recordOutcome("metadata-outcome", "unsupported").event;
    const capture = makeCaptureFixture(store.hostEpoch, {
      attemptId: "metadata-capture",
      receiptId: "metadata-receipt",
      snapshotId: "metadata-snapshot",
      manifestRevision: "metadata-revision",
      payload: "raw capture bytes are never copied into the inbox event",
    });
    const second = store.commitCapture(capture, () => undefined).event;
    const third = store.recordOutcome("later-outcome", "timeout").event;
    const beforePage = sourceEvents(store);
    const beforeOutbox = store.readOutbox(20);
    const beforeHead = store.getHead("metadata-snapshot");

    expect(beforePage).toEqual([first, second, third]);
    const staged = store.stageConsumerPage({
      consumerId: "mirror-v1",
      hostEpoch: store.hostEpoch,
      after: "0",
      limit: 2,
    });
    expect(staged).toMatchObject({
      status: "staged",
      stagedCount: 2,
      replayed: false,
      checkpoint: { consumerId: "mirror-v1", enqueuedThrough: "2", acknowledgedThrough: "0" },
    });
    const inbox = store.readConsumerInbox({ consumerId: "mirror-v1", limit: 10 })!;
    expect(inbox.tasks.map((task) => task.event)).toEqual(beforePage.slice(0, 2));
    expect(inbox.tasks.map((task) => task.event.eventType)).toEqual(["outcome", "upsert"]);
    for (const task of inbox.tasks) {
      expect(task).not.toHaveProperty("bytes");
      expect(task).not.toHaveProperty("preview");
      expect(task.event).not.toHaveProperty("content");
      expect(task.event).not.toHaveProperty("receipt");
      expect(task.event).not.toHaveProperty("manifest");
    }

    const replay = store.stageConsumerPage({
      consumerId: "mirror-v1", hostEpoch: store.hostEpoch, after: "0", limit: 500,
    });
    expect(replay).toMatchObject({ status: "staged", replayed: true, stagedCount: 0,
      checkpoint: { enqueuedThrough: "2", acknowledgedThrough: "0" } });
    expect(store.readConsumerInbox({ consumerId: "mirror-v1", limit: 10 })!.tasks).toHaveLength(2);

    const next = store.stageConsumerPage({
      consumerId: "mirror-v1", hostEpoch: store.hostEpoch, after: "2", limit: 10,
    });
    expect(next).toMatchObject({ status: "staged", stagedCount: 1,
      checkpoint: { enqueuedThrough: "3", acknowledgedThrough: "0" } });
    expect(store.readConsumerInbox({ consumerId: "mirror-v1", limit: 10 })!.tasks.map((task) => task.event))
      .toEqual(beforePage);
    expect(sourceEvents(store)).toEqual(beforePage);
    expect(store.readOutbox(20)).toEqual(beforeOutbox);
    expect(store.getHead("metadata-snapshot")).toEqual(beforeHead);

    const epoch = store.hostEpoch;
    await closeConsumerJournal(store);
    store = await openConsumerJournal(directory);
    expect(store.hostEpoch).toBe(epoch);
    expect(store.getConsumerCheckpoint("mirror-v1")).toMatchObject({
      enqueuedThrough: "3", acknowledgedThrough: "0",
    });
    expect(store.readConsumerInbox({ consumerId: "mirror-v1", limit: 10 })!.tasks.map((task) => task.event))
      .toEqual(beforePage);
  });

  it("gates source pruning at every consumer cursor and expires only a new reader behind retention", async () => {
    const directory = await newJournalDirectory();
    const store = await openConsumerJournal(directory);
    await seedOutcomeEvents(store, 3, "cursor-source");
    const wrongEpoch = "00000000-0000-4000-8000-000000000001";

    expect(store.stageConsumerPage({
      consumerId: "new-reset", hostEpoch: wrongEpoch, after: "0", limit: 2,
    })).toMatchObject({ status: "host-reset" });
    expect(store.getConsumerCheckpoint("new-reset")).toBeUndefined();

    const first = store.stageConsumerPage({
      consumerId: "gap-consumer", hostEpoch: store.hostEpoch, after: "0", limit: 1,
    });
    expect(first).toMatchObject({ status: "staged", stagedCount: 1,
      checkpoint: { enqueuedThrough: "1", acknowledgedThrough: "0" } });
    expect(store.stageConsumerPage({
      consumerId: "gap-consumer", hostEpoch: wrongEpoch, after: "1", limit: 1,
    })).toMatchObject({ status: "host-reset" });
    expect(store.getConsumerCheckpoint("gap-consumer")).toMatchObject({
      enqueuedThrough: "1", acknowledgedThrough: "0",
    });
    const outboxBefore = store.readOutbox(10);
    expectStoreCode(() => store.pruneThrough("2"), "conflict");
    expect(sourceEvents(store)).toHaveLength(3);
    expect(store.readOutbox(10)).toEqual(outboxBefore);
    expect(store.getConsumerCheckpoint("gap-consumer")).toMatchObject({
      enqueuedThrough: "1", acknowledgedThrough: "0",
    });
    // Pruning through the durable consumer cursor is safe even though the
    // consumer has not acknowledged its inbox task; delivery survives source pruning.
    store.pruneThrough("1");
    expect(store.readOutbox(10)).toEqual(outboxBefore);
    const lease = requireClaim(store.claimConsumerEvent({
      consumerId: "gap-consumer", hostEpoch: store.hostEpoch, leaseMs: 10_000,
    }));
    expect(lease.task.event.changeSeq).toBe("1");
    expect(store.acknowledgeConsumerEvent(leaseRequest(store, "gap-consumer", lease.task)))
      .toMatchObject({ checkpoint: { acknowledgedThrough: "1" } });
    const nextPage = store.stageConsumerPage({
      consumerId: "gap-consumer", hostEpoch: store.hostEpoch, after: "1", limit: 1,
    });
    expect(nextPage).toMatchObject({ status: "staged", stagedCount: 1,
      checkpoint: { enqueuedThrough: "2", acknowledgedThrough: "1" } });

    const newGap = store.stageConsumerPage({
      consumerId: "new-gap", hostEpoch: store.hostEpoch, after: "0", limit: 1,
    });
    expect(newGap).toMatchObject({ status: "cursor-expired" });
    expect(store.getConsumerCheckpoint("new-gap")).toBeUndefined();
    expectStoreCode(() => store.stageConsumerPage({
      consumerId: "gap-consumer", hostEpoch: store.hostEpoch, after: "3", limit: 1,
    }), "conflict");
  });

  it("serializes revisions of one snapshot while allowing unrelated snapshots to progress", async () => {
    const directory = await newJournalDirectory();
    const store = await openConsumerJournal(directory);
    const first = makeCaptureFixture(store.hostEpoch, {
      attemptId: "same-a1", receiptId: "same-r1", snapshotId: "snapshot-a",
      manifestRevision: "revision-a1", payload: "revision one",
    });
    store.commitCapture(first, () => undefined);
    const second = makeCaptureFixture(store.hostEpoch, {
      attemptId: "same-a2", receiptId: "same-r2", snapshotId: "snapshot-a",
      manifestRevision: "revision-a2", expectedManifestRevision: "revision-a1", payload: "revision two",
    });
    store.commitCapture(second, () => undefined);
    const unrelated = makeCaptureFixture(store.hostEpoch, {
      attemptId: "other-a1", receiptId: "other-r1", snapshotId: "snapshot-b",
      manifestRevision: "revision-b1", payload: "unrelated snapshot",
    });
    store.commitCapture(unrelated, () => undefined);
    store.stageConsumerPage({ consumerId: "ordered-worker", hostEpoch: store.hostEpoch, after: "0", limit: 10 });

    const firstLease = requireClaim(store.claimConsumerEvent({
      consumerId: "ordered-worker", hostEpoch: store.hostEpoch, leaseMs: 10_000,
    }));
    expect(firstLease.task.event).toMatchObject({ changeSeq: "1", snapshotId: "snapshot-a" });
    const secondClaim = requireClaim(store.claimConsumerEvent({
      consumerId: "ordered-worker", hostEpoch: store.hostEpoch, leaseMs: 10_000,
    }));
    expect(secondClaim.task.event).toMatchObject({ changeSeq: "3", snapshotId: "snapshot-b" });
    const firstSummary = store.readConsumerInbox({ consumerId: "ordered-worker", limit: 10 })!
      .tasks.find((task) => task.event.changeSeq === "1");
    expect(firstSummary?.state).toBe("leased");
    if (firstSummary?.state !== "leased") throw new Error("expected a leased read summary");
    expect(firstSummary.lease).toEqual({ expiresAtMs: firstLease.task.lease.expiresAtMs });
    expect(firstSummary.lease).not.toHaveProperty("token");
    expect(firstLease.task.lease.token).toMatch(/^[0-9a-f-]{36}$/);

    const secondAck = store.acknowledgeConsumerEvent(leaseRequest(store, "ordered-worker", secondClaim.task));
    expect(secondAck.checkpoint.acknowledgedThrough).toBe("0");
    expect(store.readConsumerInbox({ consumerId: "ordered-worker", limit: 10 })!.tasks)
      .toHaveLength(3);
    const firstRequest = leaseRequest(store, "ordered-worker", firstLease.task);
    expect(store.acknowledgeConsumerEvent(firstRequest)).toMatchObject({
      status: "acknowledged", checkpoint: { acknowledgedThrough: "1" }, replayed: false,
    });
    expect(store.acknowledgeConsumerEvent(firstRequest)).toMatchObject({
      status: "acknowledged", checkpoint: { acknowledgedThrough: "1" }, replayed: true,
    });

    const middle = requireClaim(store.claimConsumerEvent({
      consumerId: "ordered-worker", hostEpoch: store.hostEpoch, leaseMs: 10_000,
    }));
    expect(middle.task.event).toMatchObject({ changeSeq: "2", snapshotId: "snapshot-a" });
    const finalAck = store.acknowledgeConsumerEvent(leaseRequest(store, "ordered-worker", middle.task));
    expect(finalAck.checkpoint.acknowledgedThrough).toBe("3");
    expect(store.readConsumerInbox({ consumerId: "ordered-worker", limit: 10 })!.tasks).toEqual([]);
  });

  it("rotates lease tokens, retries the same delivery, and rejects stale or expired receipts", async () => {
    const directory = await newJournalDirectory();
    let now = 1_000;
    const store = await openConsumerJournal(directory, { consumer: { now: () => now } });
    await seedOutcomeEvents(store, 1, "lease-source");
    store.stageConsumerPage({ consumerId: "lease-worker", hostEpoch: store.hostEpoch, after: "0", limit: 1 });

    for (const leaseMs of [999, 300_001]) {
      expectStoreCode(() => store.claimConsumerEvent({
        consumerId: "lease-worker", hostEpoch: store.hostEpoch, leaseMs,
      }), "invalid-input");
    }
    now = Number.NaN;
    expectStoreCode(() => store.claimConsumerEvent({
      consumerId: "lease-worker", hostEpoch: store.hostEpoch, leaseMs: 1_000,
    }), "storage-failed");
    now = Number.MAX_SAFE_INTEGER - 500;
    expectStoreCode(() => store.claimConsumerEvent({
      consumerId: "lease-worker", hostEpoch: store.hostEpoch, leaseMs: 1_000,
    }), "over-limit");
    expect(store.readConsumerInbox({ consumerId: "lease-worker", limit: 10 })!.tasks)
      .toMatchObject([{ state: "pending", attempts: 0 }]);
    now = 1_000;

    const first = requireClaim(store.claimConsumerEvent({
      consumerId: "lease-worker", hostEpoch: store.hostEpoch, leaseMs: 1_000,
    }));
    const firstRequest = leaseRequest(store, "lease-worker", first.task);
    expect(store.releaseConsumerEvent(firstRequest)).toMatchObject({ enqueuedThrough: "1" });
    const second = requireClaim(store.claimConsumerEvent({
      consumerId: "lease-worker", hostEpoch: store.hostEpoch, leaseMs: 1_000,
    }));
    expect(second.task.deliveryId).toBe(first.task.deliveryId);
    expect(second.task.attempts).toBeGreaterThan(first.task.attempts);
    expect(second.task.lease.token).not.toBe(first.task.lease.token);
    expectStoreCode(() => store.acknowledgeConsumerEvent(firstRequest), "conflict");
    expectStoreCode(() => store.releaseConsumerEvent(firstRequest), "conflict");

    now = second.task.lease.expiresAtMs;
    const expiredRequest = leaseRequest(store, "lease-worker", second.task);
    expectStoreCode(() => store.acknowledgeConsumerEvent(expiredRequest), "conflict");
    expectStoreCode(() => store.releaseConsumerEvent(expiredRequest), "conflict");
    const third = requireClaim(store.claimConsumerEvent({
      consumerId: "lease-worker", hostEpoch: store.hostEpoch, leaseMs: 1_000,
    }));
    expect(third.task.deliveryId).toBe(first.task.deliveryId);
    expect(third.task.attempts).toBeGreaterThan(second.task.attempts);
    expect(third.task.lease.token).not.toBe(second.task.lease.token);
    const acknowledged = store.acknowledgeConsumerEvent(leaseRequest(store, "lease-worker", third.task));
    expect(acknowledged).toMatchObject({ status: "acknowledged", replayed: false });
    expect(store.acknowledgeConsumerEvent(leaseRequest(store, "lease-worker", third.task)))
      .toMatchObject({ status: "acknowledged", replayed: true });
  });

  it("counts empty-feed registrations toward the fixed 32-consumer limit", async () => {
    const directory = await newJournalDirectory();
    const store = await openConsumerJournal(directory);
    for (let index = 0; index < 32; index += 1) {
      expect(store.stageConsumerPage({
        consumerId: `empty-worker-${index}`,
        hostEpoch: store.hostEpoch,
        after: "0",
        limit: 1,
      })).toMatchObject({
        status: "staged", stagedCount: 0, replayed: false,
        checkpoint: { enqueuedThrough: "0", acknowledgedThrough: "0" },
      });
    }
    const emptyCheckpoint = store.getConsumerCheckpoint("empty-worker-0");
    const sequenceZero = {
      consumerId: "empty-worker-0",
      hostEpoch: store.hostEpoch,
      changeSeq: "0",
      token: "00000000-0000-4000-8000-000000000007",
    };
    expectStoreCode(() => store.acknowledgeConsumerEvent(sequenceZero), "invalid-input");
    expectStoreCode(() => store.releaseConsumerEvent(sequenceZero), "invalid-input");
    expect(store.getConsumerCheckpoint("empty-worker-0")).toEqual(emptyCheckpoint);
    expect(store.readConsumerInbox({ consumerId: "empty-worker-0", limit: 1 })!.tasks).toEqual([]);
    expectStoreCode(() => store.stageConsumerPage({
      consumerId: "empty-worker-32", hostEpoch: store.hostEpoch, after: "0", limit: 1,
    }), "over-limit");
    expect(store.getConsumerCheckpoint("empty-worker-32")).toBeUndefined();
  });

  it("does not partially stage a page when the 10,000-row durable queue is full", async () => {
    const directory = await newJournalDirectory("consumer-capacity-");
    const store = await openConsumerJournal(directory);
    await seedOutcomeEvents(store, 10_001, "capacity-source");
    let after = "0";
    for (let page = 0; page < 20; page += 1) {
      const staged = store.stageConsumerPage({
        consumerId: "bounded-worker", hostEpoch: store.hostEpoch, after, limit: 500,
      });
      if (staged.status !== "staged") throw new Error(`unexpected full queue at ${after}`);
      expect(staged.stagedCount).toBe(500);
      after = staged.checkpoint.enqueuedThrough;
    }
    expect(after).toBe("10000");
    const full = store.stageConsumerPage({
      consumerId: "bounded-worker", hostEpoch: store.hostEpoch, after, limit: 500,
    });
    expect(full).toMatchObject({ status: "queue-full", capacity: 10_000,
      checkpoint: { enqueuedThrough: "10000", acknowledgedThrough: "0" } });
    expect(store.readConsumerInbox({ consumerId: "bounded-worker", limit: 500 })!.tasks)
      .toHaveLength(500);
    expect(store.getConsumerCheckpoint("bounded-worker")!.enqueuedThrough).toBe("10000");
  });
});
