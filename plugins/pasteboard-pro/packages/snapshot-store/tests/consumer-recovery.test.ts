import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { open as openLmdb, TransactionFlags } from "lmdb";

import { makeManifestFromReceiptV2, makeStoreCaptureV2 } from "./store-fixtures.js";
import {
  closeConsumerJournal,
  expectStoreCode,
  newJournalDirectory,
  newStoreDirectory,
  openConsumerJournal,
  seedOutcomeEvents,
} from "./helperconsumer-fixtures.js";
import { openBlobStoreV2 } from "../src/blob-store.js";
import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from "../src/index.js";
import { eventKeyV2 } from "../src/journal-records.js";
import type { ConsumerLeaseRequestV2 } from "../src/consumer-types.js";
import type { JournalBackendV2 } from "../src/types.js";

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

async function mutateDatabase(
  directory: string,
  mutation: (database: Awaited<ReturnType<typeof openRawDatabase>>) => void,
): Promise<void> {
  const database = await openRawDatabase(directory);
  try {
    database.transactionSync(() => mutation(database),
      TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
  } finally {
    await database.close();
  }
}

function inboxRows(store: JournalBackendV2, consumerId: string) {
  return store.readConsumerInbox({ consumerId, limit: 20 })!.tasks;
}

function requestFor(
  store: JournalBackendV2,
  consumerId: string,
  task: { event: { changeSeq: string }; lease: { token: string } },
) {
  return { consumerId, hostEpoch: store.hostEpoch, changeSeq: task.event.changeSeq, token: task.lease.token };
}

function requireClaim(result: ReturnType<JournalBackendV2["claimConsumerEvent"]>) {
  if (result.status !== "claimed") throw new Error(`expected a claim, received ${result.status}`);
  return result;
}

describe("consumer inbox atomic recovery", () => {
  it("owns queued service request values before callers can mutate them", async () => {
    const directory = await newStoreDirectory("consumer-owned-request-");
    type Gate = Readonly<{
      entered: Promise<void>;
      wait: Promise<void>;
      announce: () => void;
      release: () => void;
    }>;
    function createGate(): Gate {
      let announce!: () => void;
      let release!: () => void;
      return {
        entered: new Promise<void>((resolve) => { announce = resolve; }),
        wait: new Promise<void>((resolve) => { release = resolve; }),
        announce: () => announce(),
        release: () => release(),
      };
    }
    const gates: Gate[] = [];
    const store = await openSnapshotStoreV2({
      directory,
      policy: new PolicyCommitAuthorityV2("policy-1"),
      scan: async (request) => {
        const gate = gates.shift();
        if (!gate) throw new Error("missing test scan barrier");
        gate.announce();
        await gate.wait;
        return request.requiredScopes.map((scope) => ({ scope, status: "not-scanned" as const }));
      },
      consumer: { now: () => 20_000 },
    });
    const captureFixture = (attemptId: string, snapshotId: string) => makeStoreCaptureV2({
      attemptId,
      snapshotId,
      manifestRevision: `${snapshotId}-revision`,
      receiptId: `${attemptId}-receipt`,
      policyRevision: "policy-1",
      contentRulesEnabled: true,
      rows: [{
        representationKey: `${attemptId}-text`,
        itemIndex: 0,
        contentKind: "text",
        bytes: new TextEncoder().encode("private synthetic test content"),
        formatId: "public.utf8-plain-text",
        nativeName: "public.utf8-plain-text",
      }],
    });
    const commit = (attemptId: string, snapshotId: string) => {
      const fixture = captureFixture(attemptId, snapshotId);
      return store.captureAndCommit({
        capture: fixture.capture,
        manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch),
        expectedManifestRevision: null,
      });
    };

    try {
      const firstGate = createGate();
      gates.push(firstGate);
      const firstCapture = commit("queued-attempt-1", "queued-snapshot-1");
      await firstGate.entered;
      const stageInput = {
        consumerId: "owned-worker",
        hostEpoch: store.hostEpoch,
        after: "0",
        limit: 1,
      };
      const stagePending = store.stageConsumerPage(stageInput);
      stageInput.consumerId = "mutated-worker";
      stageInput.after = "1";
      stageInput.limit = 500;
      firstGate.release();

      expect(await firstCapture).toMatchObject({ status: "rejected", outcome: { eventType: "outcome" } });
      expect(await stagePending).toMatchObject({ status: "staged", stagedCount: 1,
        checkpoint: { consumerId: "owned-worker", enqueuedThrough: "1" } });
      expect(await store.getConsumerCheckpoint("mutated-worker")).toBeUndefined();

      const secondGate = createGate();
      gates.push(secondGate);
      const secondCapture = commit("queued-attempt-2", "queued-snapshot-2");
      await secondGate.entered;
      const claimInput = { consumerId: "owned-worker", hostEpoch: store.hostEpoch, leaseMs: 10_000 };
      const claimPending = store.claimConsumerEvent(claimInput);
      claimInput.consumerId = "mutated-worker";
      claimInput.hostEpoch = "00000000-0000-4000-8000-000000000002";
      claimInput.leaseMs = 1_000;
      secondGate.release();

      expect(await secondCapture).toMatchObject({ status: "rejected", outcome: { eventType: "outcome" } });
      const claim = await claimPending;
      expect(claim).toMatchObject({ status: "claimed", task: {
        consumerId: "owned-worker", event: { changeSeq: "1", eventType: "outcome" },
      } });
      if (claim.status !== "claimed") throw new Error("expected a claim after the scan barrier");

      const thirdGate = createGate();
      gates.push(thirdGate);
      const thirdCapture = commit("queued-attempt-3", "queued-snapshot-3");
      await thirdGate.entered;
      const readInput = { consumerId: "owned-worker", limit: 10 };
      const readPending = store.readConsumerInbox(readInput);
      readInput.consumerId = "mutated-worker";
      readInput.limit = 1;
      thirdGate.release();
      expect(await thirdCapture).toMatchObject({ status: "rejected" });
      expect(await readPending).toMatchObject({ checkpoint: { consumerId: "owned-worker" }, tasks: [
        { state: "leased", event: { changeSeq: "1" } },
      ] });

      const fourthGate = createGate();
      gates.push(fourthGate);
      const fourthCapture = commit("queued-attempt-4", "queued-snapshot-4");
      await fourthGate.entered;
      const ackInput = {
        consumerId: "owned-worker",
        hostEpoch: store.hostEpoch,
        changeSeq: claim.task.event.changeSeq,
        token: claim.task.lease.token,
      };
      const ackPending = store.acknowledgeConsumerEvent(ackInput);
      ackInput.consumerId = "mutated-worker";
      ackInput.hostEpoch = "00000000-0000-4000-8000-000000000003";
      ackInput.changeSeq = "4";
      ackInput.token = "00000000-0000-4000-8000-000000000004";
      fourthGate.release();
      expect(await fourthCapture).toMatchObject({ status: "rejected" });
      expect(await ackPending).toMatchObject({ status: "acknowledged", replayed: false,
        checkpoint: { consumerId: "owned-worker", acknowledgedThrough: "1" } });

      expect(await store.stageConsumerPage({
        consumerId: "owned-worker", hostEpoch: store.hostEpoch, after: "1", limit: 1,
      })).toMatchObject({ status: "staged", stagedCount: 1,
        checkpoint: { enqueuedThrough: "2", acknowledgedThrough: "1" } });
      const secondClaim = await store.claimConsumerEvent({
        consumerId: "owned-worker", hostEpoch: store.hostEpoch, leaseMs: 10_000,
      });
      if (secondClaim.status !== "claimed") throw new Error("expected the next event lease");

      const fifthGate = createGate();
      gates.push(fifthGate);
      const fifthCapture = commit("queued-attempt-5", "queued-snapshot-5");
      await fifthGate.entered;
      const releaseInput = {
        consumerId: "owned-worker",
        hostEpoch: store.hostEpoch,
        changeSeq: secondClaim.task.event.changeSeq,
        token: secondClaim.task.lease.token,
      };
      const releasePending = store.releaseConsumerEvent(releaseInput);
      releaseInput.consumerId = "mutated-worker";
      releaseInput.hostEpoch = "00000000-0000-4000-8000-000000000005";
      releaseInput.token = "00000000-0000-4000-8000-000000000006";
      fifthGate.release();
      expect(await fifthCapture).toMatchObject({ status: "rejected" });
      await expect(releasePending).resolves.toMatchObject({ enqueuedThrough: "2", acknowledgedThrough: "1" });
      expect(await store.readConsumerInbox({ consumerId: "owned-worker", limit: 10 })).toMatchObject({
        tasks: [{ state: "pending", event: { changeSeq: "2" } }],
      });
    } finally {
      await store.close();
    }
  });

  it.each([
    "after-inbox-write",
    "before-cursor-advance",
    "after-lease-write",
    "after-ack-write",
    "before-ack-cursor-advance",
  ] as const)("rolls back all consumer metadata at fault point %s", async (point) => {
    const directory = await newJournalDirectory("consumer-fault-");
    let now = 10_000;
    let faultFired = false;
    let store = await openConsumerJournal(directory, {
      consumer: {
        now: () => now,
        fault: (actual) => {
          if (actual === point && !faultFired) {
            faultFired = true;
            throw new Error(`crash at ${point}`);
          }
        },
      },
    });
    let retryAck: ConsumerLeaseRequestV2 | undefined;
    await seedOutcomeEvents(store, 1, `fault-${point}`);
    if (point === "after-inbox-write" || point === "before-cursor-advance") {
      expectStoreCode(() => store.stageConsumerPage({
        consumerId: "fault-worker", hostEpoch: store.hostEpoch, after: "0", limit: 1,
      }), "storage-failed");
      expect(store.getConsumerCheckpoint("fault-worker")).toBeUndefined();
      expect(store.readConsumerInbox({ consumerId: "fault-worker", limit: 10 })).toBeUndefined();
    } else {
      store.stageConsumerPage({ consumerId: "fault-worker", hostEpoch: store.hostEpoch, after: "0", limit: 1 });
      if (point === "after-lease-write") {
        expectStoreCode(() => store.claimConsumerEvent({
          consumerId: "fault-worker", hostEpoch: store.hostEpoch, leaseMs: 10_000,
        }), "storage-failed");
      } else {
        const claim = requireClaim(store.claimConsumerEvent({
          consumerId: "fault-worker", hostEpoch: store.hostEpoch, leaseMs: 10_000,
        }));
        retryAck = requestFor(store, "fault-worker", claim.task);
        expectStoreCode(() => store.acknowledgeConsumerEvent(requestFor(store, "fault-worker", claim.task)),
          "storage-failed");
      }
    }
    expect(faultFired).toBe(true);
    const epoch = store.hostEpoch;
    await closeConsumerJournal(store);
    store = await openConsumerJournal(directory, { consumer: { now: () => now } });
    expect(store.hostEpoch).toBe(epoch);

    if (point === "after-inbox-write" || point === "before-cursor-advance") {
      expect(store.stageConsumerPage({
        consumerId: "fault-worker", hostEpoch: store.hostEpoch, after: "0", limit: 1,
      })).toMatchObject({ status: "staged", stagedCount: 1,
        checkpoint: { enqueuedThrough: "1", acknowledgedThrough: "0" } });
    } else if (point === "after-lease-write") {
      expect(inboxRows(store, "fault-worker")).toMatchObject([{ state: "pending", attempts: 0 }]);
      const claim = requireClaim(store.claimConsumerEvent({
        consumerId: "fault-worker", hostEpoch: store.hostEpoch, leaseMs: 10_000,
      }));
      expect(claim.task.attempts).toBe(1);
    } else {
      expect(inboxRows(store, "fault-worker")).toMatchObject([{ state: "leased", attempts: 1 }]);
      const task = inboxRows(store, "fault-worker")[0]!;
      if (task.state !== "leased") throw new Error("expected the original lease after rollback");
      expect(task.lease).not.toHaveProperty("token");
      expect(store.getConsumerCheckpoint("fault-worker")!.acknowledgedThrough).toBe("0");
      if (!retryAck) throw new Error("expected the original claim receipt");
      expect(store.acknowledgeConsumerEvent(retryAck))
        .toMatchObject({ status: "acknowledged", replayed: false,
          checkpoint: { acknowledgedThrough: "1" } });
    }
  });

  it.each(["missing-checkpoint", "missing-task", "swapped-source-event", "canonical-extra", "unicode-key", "retention-gap"] as const)(
    "rejects %s inbox metadata during root validation", async (damage) => {
      const directory = await newJournalDirectory("consumer-corrupt-");
      const store = await openConsumerJournal(directory);
      await seedOutcomeEvents(store, 2, `corruption-${damage}`);
      store.stageConsumerPage({
        consumerId: "integrity-worker", hostEpoch: store.hostEpoch, after: "0",
        limit: damage === "retention-gap" ? 1 : 2,
      });
      await closeConsumerJournal(store);

      let checkpointKey = "";
      let inboxKeys: string[] = [];
      const raw = await openRawDatabase(directory);
      try {
        checkpointKey = [...raw.getRange({ start: "consumer:", end: "consumer;" })]
          .map((entry) => entry.key as string)[0]!;
        inboxKeys = [...raw.getRange({ start: "inbox:", end: "inbox;" })]
          .map((entry) => entry.key as string);
      } finally {
        await raw.close();
      }
      expect(checkpointKey).toBeTruthy();
      expect(inboxKeys).toHaveLength(damage === "retention-gap" ? 1 : 2);

      await mutateDatabase(directory, (database) => {
        if (damage === "retention-gap") {
          database.removeSync(eventKeyV2("1"));
          database.removeSync(eventKeyV2("2"));
          database.putSync("meta:retentionFloor", "3");
          return;
        }
        if (damage === "missing-checkpoint") {
          database.removeSync(checkpointKey);
          return;
        }
        if (damage === "missing-task") {
          database.removeSync(inboxKeys[0]!);
          return;
        }
        const firstJson = database.get(inboxKeys[0]!);
        const secondJson = database.get(inboxKeys[1]!);
        if (typeof firstJson !== "string" || typeof secondJson !== "string") {
          throw new Error("expected two persisted tasks");
        }
        if (damage === "swapped-source-event") {
          const first = JSON.parse(firstJson) as Record<string, unknown>;
          const second = JSON.parse(secondJson) as Record<string, unknown>;
          first.event = second.event;
          database.putSync(inboxKeys[0]!, JSON.stringify(first));
        } else if (damage === "canonical-extra") {
          const first = JSON.parse(firstJson) as Record<string, unknown>;
          first.unrecognizedField = "must fail strict canonical validation";
          database.putSync(inboxKeys[0]!, JSON.stringify(first));
        } else {
          database.putSync(`${inboxKeys[0]!}\u2028`, firstJson);
        }
      });
      await expect(openSnapshotStoreV2({
        directory: dirname(directory),
        policy: new PolicyCommitAuthorityV2("policy-1"),
        scan: async () => [],
      })).rejects.toMatchObject({ code: "storage-corrupt" });
    },
  );

  it("does not collect blobs after corrupt consumer roots block snapshot-store recovery", async () => {
    const directory = await newStoreDirectory("consumer-gc-guard-");
    const authority = new PolicyCommitAuthorityV2("policy-1");
    const store = await openSnapshotStoreV2({
      directory,
      policy: authority,
      scan: async () => [],
    });
    const fixture = makeStoreCaptureV2({
      contentRulesEnabled: false,
      rows: [{
        representationKey: "guard-text",
        itemIndex: 0,
        contentKind: "text",
        bytes: new TextEncoder().encode("synthetic recovery guard fixture"),
        formatId: "public.utf8-plain-text",
        nativeName: "public.utf8-plain-text",
      }],
    });
    try {
      const capture = await store.captureAndCommit({
        capture: fixture.capture,
        manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch),
        expectedManifestRevision: null,
      });
      expect(capture).toMatchObject({ status: "committed", event: { changeSeq: "1" } });
      expect(await store.stageConsumerPage({
        consumerId: "gc-guard-worker", hostEpoch: store.hostEpoch, after: "0", limit: 1,
      })).toMatchObject({ status: "staged", stagedCount: 1 });
    } finally {
      await store.close();
    }

    const blobBytes = Buffer.from("separate synthetic orphan blob");
    const sha256 = createHash("sha256").update(blobBytes).digest("hex");
    const blobStore = await openBlobStoreV2(join(directory, "objects"));
    await blobStore.stage(blobBytes, sha256);
    const orphanPath = join(directory, "objects", "sha256", sha256.slice(0, 2), sha256);
    expect(await fs.access(orphanPath).then(() => true, () => false)).toBe(true);

    await mutateDatabase(join(directory, "journal"), (database) => {
      const key = [...database.getRange({ start: "inbox:", end: "inbox;" })]
        .map((entry) => entry.key as string)[0];
      if (!key) throw new Error("expected staged consumer task");
      database.removeSync(key);
    });
    await expect(openSnapshotStoreV2({
      directory,
      policy: authority,
      scan: async () => [],
    })).rejects.toMatchObject({ code: "storage-corrupt" });
    expect(await fs.access(orphanPath).then(() => true, () => false)).toBe(true);
  });
});
