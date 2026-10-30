import * as fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from "../src/index.js";
import type { SnapshotStoreV2 } from "../src/snapshot-store.js";
import { makeManifestFromReceiptV2, makeStoreCaptureV2 } from "./store-fixtures.js";
import {
  closeConsumerJournal,
  newJournalDirectory,
  newStoreDirectory,
  openConsumerJournal,
} from "./helperconsumer-fixtures.js";
import { makeCaptureFixture } from "./journal-fixtures.js";
import type { JournalBackendV2 } from "../src/types.js";

const activeStores = new Set<SnapshotStoreV2>();
const activeJournals = new Set<JournalBackendV2>();
const directories = new Set<string>();

afterEach(async () => {
  for (const store of [...activeStores]) {
    activeStores.delete(store);
    await store.close().catch(() => undefined);
  }
  for (const journal of [...activeJournals]) await closeConsumerJournal(journal);
  for (const directory of directories) await fs.rm(directory, { recursive: true, force: true });
  directories.clear();
});

function expectCode(action: () => unknown, code: string): void {
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ code });
}

async function openStore(options: {
  directory?: string;
  deletionFault?: (point: string) => void;
} = {}): Promise<SnapshotStoreV2> {
  const directory = options.directory ?? await newStoreDirectory("delete-store-");
  directories.add(directory);
  const store = await openSnapshotStoreV2({
    directory,
    policy: new PolicyCommitAuthorityV2("policy-1"),
    scan: async (request) => request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })),
    ...(options.deletionFault ? { faults: { deletion: options.deletionFault } } : {}),
  });
  activeStores.add(store);
  return store;
}

async function closeStore(store: SnapshotStoreV2): Promise<void> {
  activeStores.delete(store);
  await store.close();
}

async function commitCapture(store: SnapshotStoreV2, options: {
  attemptId?: string;
  snapshotId?: string;
  manifestRevision?: string;
  expectedManifestRevision?: string | null;
  payload?: string;
} = {}) {
  const fixture = makeStoreCaptureV2({
    ...(options.attemptId === undefined ? {} : { attemptId: options.attemptId }),
    ...(options.snapshotId === undefined ? {} : { snapshotId: options.snapshotId }),
    ...(options.manifestRevision === undefined ? {} : { manifestRevision: options.manifestRevision }),
    receiptId: `${options.attemptId ?? "delete-capture"}-receipt`,
    contentRulesEnabled: false,
    rows: [{
      representationKey: "delete-text",
      itemIndex: 0,
      contentKind: "text",
      bytes: new TextEncoder().encode(options.payload ?? "synthetic retained bytes"),
      formatId: "public.utf8-plain-text",
      nativeName: "public.utf8-plain-text",
      mime: "text/plain;charset=utf-8",
    }],
  });
  return store.captureAndCommit({
    capture: fixture.capture,
    manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch),
    expectedManifestRevision: options.expectedManifestRevision ?? null,
  });
}

function makeTombstone(store: SnapshotStoreV2, options: {
  attemptId?: string;
  snapshotId?: string;
  tombstoneRevision?: string;
  previousManifestRevision?: string;
} = {}) {
  return {
    schemaVersion: 2 as const,
    hostEpoch: store.hostEpoch,
    snapshotId: options.snapshotId ?? "snapshot-1",
    tombstoneRevision: options.tombstoneRevision ?? "tombstone-1",
    attemptId: options.attemptId ?? "delete-attempt-1",
    previousManifestRevision: options.previousManifestRevision ?? "manifest-1",
    reasonCode: "user-deleted" as const,
  };
}

describe("logical snapshot deletion in real LMDB", () => {
  it("atomically publishes an immutable tombstone event and retains exact old bytes across reopen", async () => {
    const directory = await newStoreDirectory("delete-store-");
    directories.add(directory);
    const store = await openStore({ directory });
    const capture = await commitCapture(store);
    expect(capture).toMatchObject({ status: "committed", event: { eventType: "upsert", changeSeq: "1" } });
    const original = await store.readSnapshot("snapshot-1", "manifest-1");
    if (!original) throw new Error("expected committed snapshot bytes");

    const tombstone = makeTombstone(store);
    const deleted = await store.deleteSnapshot(tombstone);
    expect(deleted).toMatchObject({
      replayed: false,
      event: {
        eventType: "delete", hostEpoch: store.hostEpoch, changeSeq: "2",
        snapshotId: "snapshot-1", tombstoneRevision: "tombstone-1",
      },
    });
    expect(await store.getHead("snapshot-1")).toBeUndefined();
    await expect(store.getDeletedHead("snapshot-1")).resolves.toEqual(tombstone);
    await expect(store.getTombstone("snapshot-1", "tombstone-1")).resolves.toEqual(tombstone);
    expect((await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 })))
      .toMatchObject({ status: "ok", latestChangeSeq: "2", events: [
        { eventType: "upsert", changeSeq: "1" },
        { eventType: "delete", changeSeq: "2", tombstoneRevision: "tombstone-1" },
      ] });
    expect(await store.readOutbox(10)).toMatchObject([
      { eventType: "upsert", changeSeq: "1" },
      { eventType: "delete", changeSeq: "2", tombstoneRevision: "tombstone-1" },
    ]);
    expect(await store.readSnapshot("snapshot-1", "manifest-1")).toEqual(original);
    const epoch = store.hostEpoch;
    await closeStore(store);
    const reopened = await openStore({ directory });
    expect(reopened.hostEpoch).toBe(epoch);
    await expect(reopened.getDeletedHead("snapshot-1")).resolves.toEqual(tombstone);
    expect(await reopened.getTombstone("snapshot-1", "tombstone-1")).toEqual(tombstone);
    expect(await reopened.readChanges({ hostEpoch: epoch, after: "1", limit: 1 }))
      .toMatchObject({ status: "ok", nextCursor: "2", events: [{ eventType: "delete" }] });
  });

  it("rejects missing, stale, wrong-epoch, unknown, and extra-field tombstones without sequence gaps", async () => {
    const store = await openStore();
    await commitCapture(store);
    const valid = makeTombstone(store);
    const wrongEpoch = { ...valid, hostEpoch: "00000000-0000-4000-8000-000000000001" };
    const unknownReason = { ...valid, reasonCode: "arbitrary-text" } as unknown as typeof valid;
    const extraField = { ...valid, sourceApplication: "must-not-persist" } as typeof valid;
    await expect(store.deleteSnapshot({ ...valid, snapshotId: "missing-snapshot" }))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(store.deleteSnapshot({ ...valid, previousManifestRevision: "stale-revision", attemptId: "stale-delete" }))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(store.deleteSnapshot(wrongEpoch)).rejects.toMatchObject({ code: "invalid-input" });
    await expect(store.deleteSnapshot(unknownReason)).rejects.toMatchObject({ code: "invalid-input" });
    await expect(store.deleteSnapshot(extraField)).rejects.toMatchObject({ code: "invalid-input" });
    expect(await store.deleteSnapshot(valid)).toMatchObject({ replayed: false, event: { changeSeq: "2" } });
    expect(await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "ok", latestChangeSeq: "2", events: [
        { eventType: "upsert", changeSeq: "1" }, { eventType: "delete", changeSeq: "2" },
      ] });
  });

  it.each([
    "after-tombstone",
    "after-delete-event",
    "before-delete-head",
    "after-delete-head",
  ])("rolls back every deletion write at %s", async (point) => {
    const directory = await newStoreDirectory("delete-fault-");
    directories.add(directory);
    let fire = true;
    const store = await openStore({ directory, deletionFault: (actual) => {
      if (actual === point && fire) { fire = false; throw new Error(`fault ${point}`); }
    } });
    await commitCapture(store);
    const tombstone = makeTombstone(store);
    await expect(store.deleteSnapshot(tombstone)).rejects.toMatchObject({ code: "storage-failed" });
    expect(await store.getHead("snapshot-1")).toEqual({ snapshotId: "snapshot-1", manifestRevision: "manifest-1" });
    expect(await store.getDeletedHead("snapshot-1")).toBeUndefined();
    expect(await store.getTombstone("snapshot-1", "tombstone-1")).toBeUndefined();
    expect(await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "ok", latestChangeSeq: "1", events: [{ eventType: "upsert", changeSeq: "1" }] });
    expect(await store.deleteSnapshot(tombstone)).toMatchObject({ replayed: false, event: { changeSeq: "2" } });
  });

  it("replays a committed delete after source pruning without reviving the head", async () => {
    const store = await openStore();
    await commitCapture(store);
    const tombstone = makeTombstone(store);
    const first = await store.deleteSnapshot(tombstone);
    expect(first.event.changeSeq).toBe("2");
    store.acknowledgeOutbox("1");
    store.acknowledgeOutbox("2");
    store.pruneThrough("2");

    expect(await store.deleteSnapshot(tombstone)).toEqual({ event: first.event, replayed: true });
    await expect(store.getDeletedHead("snapshot-1")).resolves.toEqual(tombstone);
    expect(await store.getHead("snapshot-1")).toBeUndefined();
    expect(await store.readOutbox(10)).toEqual([]);
    expect(await store.getConsumerCheckpoint("delete-replay-worker")).toBeUndefined();
  });

  it("does not resurrect a deleted id on new capture, but allows a read-only prior-attempt replay", async () => {
    const store = await openStore();
    const initial = await commitCapture(store, { attemptId: "original-attempt" });
    expect(initial.status).toBe("committed");
    const tombstone = makeTombstone(store, { attemptId: "delete-after-capture" });
    await store.deleteSnapshot(tombstone);
    const historical = await commitCapture(store, { attemptId: "original-attempt" });
    expect(historical).toMatchObject({ status: "committed", replayed: true });
    expect(await store.getHead("snapshot-1")).toBeUndefined();
    await expect(store.getDeletedHead("snapshot-1")).resolves.toEqual(tombstone);

    await expect(commitCapture(store, {
      attemptId: "fresh-after-delete", snapshotId: "snapshot-1", manifestRevision: "manifest-2",
    })).rejects.toMatchObject({ code: "conflict" });
    expect(await store.getHead("snapshot-1")).toBeUndefined();
    await expect(store.getDeletedHead("snapshot-1")).resolves.toEqual(tombstone);
  });

  it("stages ordered upsert/delete events and acks them after source pruning and restart", async () => {
    const directory = await newStoreDirectory("delete-inbox-");
    directories.add(directory);
    const store = await openStore({ directory });
    await commitCapture(store);
    const tombstone = makeTombstone(store);
    await store.deleteSnapshot(tombstone);
    expect(await store.stageConsumerPage({ consumerId: "delete-worker", hostEpoch: store.hostEpoch,
      after: "0", limit: 10 })).toMatchObject({ status: "staged", stagedCount: 2 });
    await store.pruneThrough("2");
    expect(await store.readConsumerInbox({ consumerId: "delete-worker", limit: 10 }))
      .toMatchObject({ tasks: [
        { event: { eventType: "upsert", changeSeq: "1" } },
        { event: { eventType: "delete", changeSeq: "2", tombstoneRevision: "tombstone-1" } },
      ] });
    const epoch = store.hostEpoch;
    await closeStore(store);
    const reopened = await openStore({ directory });
    expect(await reopened.readChanges({ hostEpoch: epoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "cursor-expired", retentionFloor: "3" });
    const acked = [];
    for (const changeSeq of ["1", "2"]) {
      const claimed = await reopened.claimConsumerEvent({ consumerId: "delete-worker", hostEpoch: epoch, leaseMs: 10_000 });
      if (claimed.status !== "claimed") throw new Error("expected queued upsert/delete event");
      expect(claimed.task.event.changeSeq).toBe(changeSeq);
      acked.push(await reopened.acknowledgeConsumerEvent({ consumerId: "delete-worker", hostEpoch: epoch,
        changeSeq, token: claimed.task.lease.token }));
    }
    expect(acked.map((item) => item.checkpoint.acknowledgedThrough)).toEqual(["1", "2"]);
    await expect(reopened.getDeletedHead("snapshot-1")).resolves.toEqual(tombstone);
    const rawSnapshot = await reopened.readSnapshot("snapshot-1", "manifest-1");
    expect(Array.from(rawSnapshot?.representations[0]?.bytes ?? []))
      .toEqual(Array.from(new TextEncoder().encode("synthetic retained bytes")));
  });

  it("keeps per-snapshot manifest revision CAS and global attempt identity strict", async () => {
    const store = await openStore();
    await commitCapture(store);
    await expect(store.deleteSnapshot(makeTombstone(store, { attemptId: "attempt-1" })))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(store.deleteSnapshot(makeTombstone(store, { previousManifestRevision: "stale-revision" })))
      .rejects.toMatchObject({ code: "conflict" });
    expect(await store.getHead("snapshot-1")).toEqual({ snapshotId: "snapshot-1", manifestRevision: "manifest-1" });
    const mismatched = makeTombstone(store, { attemptId: "delete-attempt-1", tombstoneRevision: "other-tombstone" });
    await store.deleteSnapshot(makeTombstone(store));
    await expect(store.deleteSnapshot(mismatched)).rejects.toMatchObject({ code: "conflict" });
    await expect(store.deleteSnapshot(makeTombstone(store, {
      attemptId: "new-delete-attempt", tombstoneRevision: "new-tombstone",
    }))).rejects.toMatchObject({ code: "conflict" });
    expect(await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ latestChangeSeq: "2" });
  });

  it("maps tombstone getter exceptions to fixed invalid input without leaking messages or writing", async () => {
    const marker = "synthetic-tombstone-getter-marker";
    const store = await openStore();
    await commitCapture(store);
    const hostileInput = Object.defineProperty({
      ...makeTombstone(store, { tombstoneRevision: "getter-tombstone" }),
    }, "hostEpoch", {
      configurable: true,
      enumerable: true,
      get() { throw Object.assign(new Error(marker), { code: "conflict" }); },
    });

    const storeFailure = await store.deleteSnapshot(
      hostileInput as unknown as Parameters<typeof store.deleteSnapshot>[0],
    ).then(() => undefined, (error: unknown) => error);
    expect(storeFailure).toMatchObject({ code: "invalid-input" });
    expect((storeFailure as Error).message).not.toContain(marker);
    expect(await store.getHead("snapshot-1"))
      .toEqual({ snapshotId: "snapshot-1", manifestRevision: "manifest-1" });
    expect(await store.getDeletedHead("snapshot-1")).toBeUndefined();
    expect(await store.getTombstone("snapshot-1", "getter-tombstone")).toBeUndefined();
    expect(await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "ok", latestChangeSeq: "1", events: [{ eventType: "upsert", changeSeq: "1" }] });

    const directory = await newJournalDirectory("delete-getter-input-");
    const journal = await openConsumerJournal(directory);
    activeJournals.add(journal);
    let journalFailure: unknown;
    try {
      journal.commitDeletion(
        hostileInput as unknown as Parameters<JournalBackendV2["commitDeletion"]>[0],
        () => undefined,
      );
    } catch (error) {
      journalFailure = error;
    }
    expect(journalFailure).toMatchObject({ code: "invalid-input" });
    expect((journalFailure as Error).message).not.toContain(marker);
    expect(journal.readChanges({ hostEpoch: journal.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "ok", latestChangeSeq: "0", events: [] });
  });

  it("runs the trusted commit guard before the atomic delete and rolls back guard failure", async () => {
    const directory = await newJournalDirectory("delete-guard-");
    const journal = await openConsumerJournal(directory);
    activeJournals.add(journal);
    const capture = makeCaptureFixture(journal.hostEpoch);
    journal.commitCapture(capture, () => undefined);
    const tombstone = {
      schemaVersion: 2 as const,
      hostEpoch: journal.hostEpoch,
      snapshotId: capture.manifest.snapshotId,
      tombstoneRevision: "guard-tombstone",
      attemptId: "guard-delete-attempt",
      previousManifestRevision: capture.manifest.manifestRevision,
      reasonCode: "user-deleted" as const,
    };
    expectCode(() => journal.commitDeletion(tombstone, () => {
      throw new Error("trusted delete authority was revoked");
    }), "storage-failed");
    expect(journal.getHead(tombstone.snapshotId)?.manifestRevision).toBe("revision-1");
    expect(journal.getDeletedHead(tombstone.snapshotId)).toBeUndefined();
    expect(journal.readChanges({ hostEpoch: journal.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "ok", latestChangeSeq: "1", events: [{ eventType: "upsert" }] });

    await closeConsumerJournal(journal);
    activeJournals.delete(journal);
    const reopened = await openConsumerJournal(directory);
    activeJournals.add(reopened);
    expect(reopened.commitDeletion(tombstone, () => undefined).event.changeSeq).toBe("2");
  });
});
