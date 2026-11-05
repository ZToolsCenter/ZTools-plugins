import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { open as openLmdb, TransactionFlags } from "lmdb";
import { afterEach, describe, expect, it } from "vitest";

import {
  openSnapshotStoreV2,
  PolicyCommitAuthorityV2,
  type ExpireDeletedPayloadRequestV2,
  type SnapshotStoreOptionsV2,
  type SnapshotStoreV2,
} from "../src/index.js";
import { openBlobStoreV2 } from "../src/blob-store.js";
import { openJournalBackendV2 } from "../src/journal.js";
import { canonicalJsonV2, tupleKeyV2 } from "../src/journal-validation.js";
import { digestV2, makeManifestFromReceiptV2, makeStoreCaptureV2 } from "./store-fixtures.js";

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../artifacts/pasteboardpro/clipboard-format-g0/");
const activeStores = new Set<SnapshotStoreV2>();
const directories = new Set<string>();

type CommittedResult = Extract<Awaited<ReturnType<SnapshotStoreV2["captureAndCommit"]>>, { status: "committed" }>;
type CommittedCapture = Readonly<{
  fixture: ReturnType<typeof makeStoreCaptureV2>;
  event: CommittedResult["event"];
  receipt: CommittedResult["receipt"];
}>;

afterEach(async () => {
  for (const store of [...activeStores]) {
    activeStores.delete(store);
    await store.close().catch(() => undefined);
  }
  for (const directory of [...directories]) {
    directories.delete(directory);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function newDirectory(): Promise<string> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(join(artifactRoot, "payload-reclamation-"));
  directories.add(directory);
  return directory;
}

async function openStore(options: {
  directory?: string;
  faults?: SnapshotStoreOptionsV2["faults"];
} = {}): Promise<SnapshotStoreV2> {
  const directory = options.directory ?? await newDirectory();
  const store = await openSnapshotStoreV2({
    directory,
    policy: new PolicyCommitAuthorityV2("policy-1"),
    scan: async (request) => request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })),
    ...(options.faults === undefined ? {} : { faults: options.faults }),
  });
  activeStores.add(store);
  return store;
}

async function closeStore(store: SnapshotStoreV2): Promise<void> {
  activeStores.delete(store);
  await store.close();
}

async function captureRevision(store: SnapshotStoreV2, options: {
  snapshotId: string;
  manifestRevision: string;
  attemptId: string;
  payload: string;
  expectedManifestRevision?: string | null;
}): Promise<CommittedCapture> {
  const fixture = makeStoreCaptureV2({
    attemptId: options.attemptId,
    receiptId: options.attemptId + "-receipt",
    snapshotId: options.snapshotId,
    manifestRevision: options.manifestRevision,
    contentRulesEnabled: false,
    rows: [{
      representationKey: "reclamation-text",
      itemIndex: 0,
      contentKind: "text",
      bytes: new TextEncoder().encode(options.payload),
      formatId: "public.utf8-plain-text",
      nativeName: "public.utf8-plain-text",
      mime: "text/plain;charset=utf-8",
    }],
  });
  const result = await store.captureAndCommit({
    capture: fixture.capture,
    manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch),
    expectedManifestRevision: options.expectedManifestRevision ?? null,
  });
  if (result.status !== "committed") throw new Error("capture was rejected: " + result.status);
  return { fixture, event: result.event, receipt: result.receipt };
}

async function deleteSnapshot(store: SnapshotStoreV2, snapshotId: string, manifestRevision: string, tombstoneRevision: string) {
  const result = await store.deleteSnapshot({
    schemaVersion: 2,
    hostEpoch: store.hostEpoch,
    snapshotId,
    tombstoneRevision,
    attemptId: "delete-" + tombstoneRevision,
    previousManifestRevision: manifestRevision,
    reasonCode: "user-deleted",
  });
  expect(result).toMatchObject({ replayed: false, event: { eventType: "delete" } });
  return result;
}

function expiryRequest(store: SnapshotStoreV2, snapshotId: string, manifestRevision: string, tombstoneRevision: string): ExpireDeletedPayloadRequestV2 {
  return { hostEpoch: store.hostEpoch, snapshotId, manifestRevision, tombstoneRevision };
}

function objectPath(directory: string, capture: CommittedCapture): string {
  const sha256 = digestV2(capture.fixture.rows[0]!.bytes);
  return join(directory, "objects", "sha256", sha256.slice(0, 2), sha256);
}

async function pathExists(path: string): Promise<boolean> {
  try { await fs.access(path); return true; }
  catch { return false; }
}

async function readSourceEvents(store: SnapshotStoreV2) {
  const page = await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 500 });
  if (page.status !== "ok") throw new Error("source events unavailable: " + page.status);
  return page.events;
}

async function acknowledgeAndPrune(store: SnapshotStoreV2, through: string, consumerId?: string): Promise<void> {
  const events = await readSourceEvents(store);
  for (const event of await store.readOutbox(500)) await store.acknowledgeOutbox(event.changeSeq);
  if (consumerId) {
    expect(await store.stageConsumerPage({ consumerId, hostEpoch: store.hostEpoch, after: "0", limit: 500 }))
      .toMatchObject({ status: "staged" });
    const acknowledged: string[] = [];
    for (;;) {
      const claim = await store.claimConsumerEvent({ consumerId, hostEpoch: store.hostEpoch, leaseMs: 10_000 });
      if (claim.status === "idle") break;
      acknowledged.push(claim.task.event.changeSeq);
      await store.acknowledgeConsumerEvent({
        consumerId,
        hostEpoch: store.hostEpoch,
        changeSeq: claim.task.event.changeSeq,
        token: claim.task.lease.token,
      });
    }
    expect(acknowledged).toEqual(events.map((event) => event.changeSeq));
    expect(await store.getConsumerCheckpoint(consumerId)).toMatchObject({ acknowledgedThrough: through });
  }
  await store.pruneThrough(through);
}

function expectStorageCode(action: Promise<unknown>, code: string): Promise<void> {
  return expect(action).rejects.toMatchObject({ code });
}

async function openRawDatabase(directory: string) {
  return openLmdb<string, string>(directory, {
    encoding: "string", keyEncoding: "ordered-binary", cache: false,
    compression: false, useWritemap: false, overlappingSync: false,
    noSync: false, noMetaSync: false, noMemInit: false,
  });
}

async function mutateJournal(directory: string, mutate: (db: Awaited<ReturnType<typeof openRawDatabase>>) => void): Promise<void> {
  const db = await openRawDatabase(join(directory, "journal"));
  try { db.transactionSync(() => mutate(db), TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT); }
  finally { await db.close(); }
}

describe("per-revision payload reclamation in real LMDB", () => {
  it("blocks reclamation for a live snapshot, then until source pruning", async () => {
    const directory = await newDirectory();
    const store = await openStore({ directory });
    const capture = await captureRevision(store, {
      snapshotId: "blocked-gc-snapshot", manifestRevision: "blocked-gc-manifest",
      attemptId: "blocked-gc-capture", payload: "blocked candidate bytes",
    });
    const request = expiryRequest(store, "blocked-gc-snapshot", "blocked-gc-manifest", "blocked-gc-tombstone");
    const blob = objectPath(directory, capture);
    expect(await store.expireDeletedPayload(request)).toEqual({ status: "blocked", reason: "snapshot-live" });
    expect(await pathExists(blob)).toBe(true);

    const deletion = await deleteSnapshot(store, "blocked-gc-snapshot", "blocked-gc-manifest", "blocked-gc-tombstone");
    for (const event of await store.readOutbox(10)) await store.acknowledgeOutbox(event.changeSeq);
    expect(await store.expireDeletedPayload(request)).toEqual({ status: "blocked", reason: "source-not-pruned" });
    await store.pruneThrough(deletion.event.changeSeq);
    expect(await store.expireDeletedPayload(request)).toMatchObject({ status: "expired", replayed: false });
    expect(await pathExists(blob)).toBe(false);
  });

  it("does not treat enqueued consumer events as ACKs", async () => {
    const directory = await newDirectory();
    const store = await openStore({ directory });
    const capture = await captureRevision(store, {
      snapshotId: "consumer-gc-snapshot", manifestRevision: "consumer-gc-manifest",
      attemptId: "consumer-gc-capture", payload: "consumer blocked bytes",
    });
    const deletion = await deleteSnapshot(store, "consumer-gc-snapshot", "consumer-gc-manifest", "consumer-gc-tombstone");
    const request = expiryRequest(store, "consumer-gc-snapshot", "consumer-gc-manifest", "consumer-gc-tombstone");
    for (const event of await store.readOutbox(10)) await store.acknowledgeOutbox(event.changeSeq);
    expect(await store.stageConsumerPage({
      consumerId: "payload-gc-pending-worker", hostEpoch: store.hostEpoch, after: "0", limit: 10,
    })).toMatchObject({ status: "staged", checkpoint: { acknowledgedThrough: "0", enqueuedThrough: deletion.event.changeSeq } });
    await store.pruneThrough(deletion.event.changeSeq);

    expect(await store.getConsumerCheckpoint("payload-gc-pending-worker")).toMatchObject({ acknowledgedThrough: "0" });
    expect(await store.expireDeletedPayload(request)).toEqual({ status: "blocked", reason: "consumer-not-acknowledged" });
    expect(await store.getPayloadExpiry("consumer-gc-snapshot", "consumer-gc-manifest")).toBeUndefined();
    expect(await pathExists(objectPath(directory, capture))).toBe(true);
  });

  it("blocks reclamation while an outbox row remains pending after source pruning", async () => {
    const directory = await newDirectory();
    const store = await openStore({ directory });
    const capture = await captureRevision(store, {
      snapshotId: "pending-outbox-snapshot", manifestRevision: "pending-outbox-manifest",
      attemptId: "pending-outbox-capture", payload: "outbox must be acknowledged bytes",
    });
    const deletion = await deleteSnapshot(store, "pending-outbox-snapshot", "pending-outbox-manifest", "pending-outbox-tombstone");
    await store.pruneThrough(deletion.event.changeSeq);
    expect(await store.expireDeletedPayload(expiryRequest(
      store, "pending-outbox-snapshot", "pending-outbox-manifest", "pending-outbox-tombstone",
    ))).toEqual({ status: "blocked", reason: "outbox-not-acknowledged" });
    expect(await pathExists(objectPath(directory, capture))).toBe(true);
  });

  it("blocks reclamation while an active lease survives store restart without a TTL", async () => {
    const directory = await newDirectory();
    let store = await openStore({ directory });
    const capture = await captureRevision(store, {
      snapshotId: "pinned-gc-snapshot", manifestRevision: "pinned-gc-manifest",
      attemptId: "pinned-gc-capture", payload: "active pin keeps this bytes".repeat(64),
    });
    const deletion = await deleteSnapshot(store, "pinned-gc-snapshot", "pinned-gc-manifest", "pinned-gc-tombstone");
    await acknowledgeAndPrune(store, deletion.event.changeSeq);
    const lease = {
      hostEpoch: store.hostEpoch, leaseId: "c1ae3928-8fce-4b53-9a14-8198b4e98a01",
      token: "471fce98-f820-4a23-84f0-f30ec4e485ee", snapshotId: "pinned-gc-snapshot",
      manifestRevision: "pinned-gc-manifest", purpose: "paste" as const,
    };
    await store.acquirePayloadLease(lease);
    const epoch = store.hostEpoch;
    await closeStore(store);
    store = await openStore({ directory });
    expect(store.hostEpoch).toBe(epoch);
    expect(await store.getPayloadLease(lease.leaseId)).not.toHaveProperty("token");
    expect(await store.expireDeletedPayload(expiryRequest(
      store, "pinned-gc-snapshot", "pinned-gc-manifest", "pinned-gc-tombstone",
    ))).toEqual({ status: "blocked", reason: "active-payload-lease" });
    expect(await pathExists(objectPath(directory, capture))).toBe(true);
  });

  it("marks an eligible revision, unlinks its blob, preserves audit metadata, and terminally replays its capture", async () => {
    const directory = await newDirectory();
    let store = await openStore({ directory });
    const capture = await captureRevision(store, {
      snapshotId: "expired-snapshot", manifestRevision: "expired-manifest",
      attemptId: "expired-capture-attempt", payload: "eligible bytes expire once",
    });
    const deletion = await deleteSnapshot(store, "expired-snapshot", "expired-manifest", "expired-tombstone");
    await acknowledgeAndPrune(store, deletion.event.changeSeq, "payload-gc-acked-worker");
    const blob = objectPath(directory, capture);
    const request = expiryRequest(store, "expired-snapshot", "expired-manifest", "expired-tombstone");

    const firstExpiry = await store.expireDeletedPayload(request);
    expect(firstExpiry).toMatchObject({ status: "expired", replayed: false, record: {
      snapshotId: "expired-snapshot", manifestRevision: "expired-manifest",
    } });
    if (firstExpiry.status !== "expired") throw new Error("expected persisted expiry record");
    expect(await pathExists(blob)).toBe(false);
    expect(await store.getPayloadExpiry("expired-snapshot", "expired-manifest")).toEqual(firstExpiry.record);
    expect(firstExpiry.record).toMatchObject({
      hostEpoch: store.hostEpoch, tombstoneRevision: "expired-tombstone",
      upsertChangeSeq: capture.event.changeSeq, deleteChangeSeq: deletion.event.changeSeq,
    });
    expect(await store.expireDeletedPayload(request)).toMatchObject({ status: "expired", replayed: true });
    expect(await store.getHead("expired-snapshot")).toBeUndefined();
    expect(await store.getDeletedHead("expired-snapshot")).toMatchObject({ tombstoneRevision: "expired-tombstone" });

    await closeStore(store);
    const journal = await openJournalBackendV2(join(directory, "journal"));
    try {
      expect(journal.getManifest("expired-snapshot", "expired-manifest")?.snapshotId).toBe("expired-snapshot");
      expect(journal.getReceipt(capture.receipt.receiptId)).toEqual(capture.receipt);
      const sha256 = digestV2(capture.fixture.rows[0]!.bytes);
      expect(journal.getRawObjects("expired-snapshot", "expired-manifest")).toEqual([expect.objectContaining({
        representationKey: "reclamation-text", itemIndex: 0, blobRef: "sha256-" + sha256,
        sha256, byteLength: capture.fixture.rows[0]!.bytes.byteLength,
      })]);
    } finally { await journal.close(); }

    store = await openStore({ directory });
    await expect(store.readSnapshot("expired-snapshot", "expired-manifest")).rejects.toMatchObject({ code: "payload-expired" });
    expect(await store.getConsumerCheckpoint("payload-gc-acked-worker")).toMatchObject({
      acknowledgedThrough: deletion.event.changeSeq,
    });
    const retry = await store.captureAndCommit({
      capture: capture.fixture.capture,
      manifest: (receipt) => makeManifestFromReceiptV2(capture.fixture, receipt, store.hostEpoch),
      expectedManifestRevision: null,
    });
    expect(retry).toMatchObject({
      status: "payload-expired", replayed: true, event: capture.event, receipt: capture.receipt,
    });
    const fresh = makeStoreCaptureV2({
      attemptId: "fresh-after-expiry-attempt", receiptId: "fresh-after-expiry-receipt",
      snapshotId: "expired-snapshot", manifestRevision: "fresh-after-expiry-manifest",
      contentRulesEnabled: false,
      rows: [{
        representationKey: "reclamation-text", itemIndex: 0, contentKind: "text",
        bytes: new TextEncoder().encode("fresh capture must not revive deleted id"),
        formatId: "public.utf8-plain-text", nativeName: "public.utf8-plain-text",
      }],
    });
    await expect(store.captureAndCommit({
      capture: fresh.capture,
      manifest: (receipt) => makeManifestFromReceiptV2(fresh, receipt, store.hostEpoch),
      expectedManifestRevision: null,
    })).rejects.toMatchObject({ code: "conflict" });
    expect(await pathExists(blob)).toBe(false);
    expect(await store.recover()).toBeDefined();
    expect(await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "cursor-expired" });
  });

  it("expires multiple historical revisions independently and only removes each unshared blob", async () => {
    const directory = await newDirectory();
    const store = await openStore({ directory });
    const first = await captureRevision(store, {
      snapshotId: "history-snapshot", manifestRevision: "history-rev-1",
      attemptId: "history-capture-1", payload: "older historical payload",
    });
    const second = await captureRevision(store, {
      snapshotId: "history-snapshot", manifestRevision: "history-rev-2",
      attemptId: "history-capture-2", payload: "newer current payload",
      expectedManifestRevision: "history-rev-1",
    });
    const deletion = await deleteSnapshot(store, "history-snapshot", "history-rev-2", "history-tombstone");
    await acknowledgeAndPrune(store, deletion.event.changeSeq);
    const firstBlob = objectPath(directory, first);
    const secondBlob = objectPath(directory, second);

    expect(await store.expireDeletedPayload(expiryRequest(store, "history-snapshot", "history-rev-1", "history-tombstone")))
      .toMatchObject({ status: "expired", replayed: false });
    expect(await pathExists(firstBlob)).toBe(false);
    expect(await pathExists(secondBlob)).toBe(true);
    await expect(store.readSnapshot("history-snapshot", "history-rev-1")).rejects.toMatchObject({ code: "payload-expired" });
    expect(Array.from((await store.readSnapshot("history-snapshot", "history-rev-2"))?.representations[0]?.bytes ?? []))
      .toEqual(Array.from(second.fixture.rows[0]?.bytes ?? []));

    expect(await store.expireDeletedPayload(expiryRequest(store, "history-snapshot", "history-rev-2", "history-tombstone")))
      .toMatchObject({ status: "expired", replayed: false });
    expect(await pathExists(secondBlob)).toBe(false);
    expect(await store.getPayloadExpiry("history-snapshot", "history-rev-1")).toBeDefined();
    expect(await store.getPayloadExpiry("history-snapshot", "history-rev-2")).toBeDefined();
  });

  it("retains a shared hash for another revision and live snapshot until the final reference expires", async () => {
    const directory = await newDirectory();
    const store = await openStore({ directory });
    const sharedPayload = "one hash shared by history and another live snapshot";
    const oldRevision = await captureRevision(store, {
      snapshotId: "shared-history-snapshot", manifestRevision: "shared-rev-1",
      attemptId: "shared-history-capture-1", payload: sharedPayload,
    });
    const currentRevision = await captureRevision(store, {
      snapshotId: "shared-history-snapshot", manifestRevision: "shared-rev-2",
      attemptId: "shared-history-capture-2", payload: sharedPayload,
      expectedManifestRevision: "shared-rev-1",
    });
    const otherLive = await captureRevision(store, {
      snapshotId: "shared-live-snapshot", manifestRevision: "shared-live-rev",
      attemptId: "shared-live-capture", payload: sharedPayload,
    });
    const firstDelete = await deleteSnapshot(store, "shared-history-snapshot", "shared-rev-2", "shared-history-delete");
    await acknowledgeAndPrune(store, firstDelete.event.changeSeq);
    const sharedBlob = objectPath(directory, oldRevision);
    expect(objectPath(directory, oldRevision)).toBe(objectPath(directory, currentRevision));
    expect(objectPath(directory, oldRevision)).toBe(objectPath(directory, otherLive));

    await store.expireDeletedPayload(expiryRequest(store, "shared-history-snapshot", "shared-rev-1", "shared-history-delete"));
    await store.expireDeletedPayload(expiryRequest(store, "shared-history-snapshot", "shared-rev-2", "shared-history-delete"));
    expect(await pathExists(sharedBlob)).toBe(true);
    expect(Array.from((await store.readSnapshot("shared-live-snapshot", "shared-live-rev"))?.representations[0]?.bytes ?? []))
      .toEqual(Array.from(otherLive.fixture.rows[0]?.bytes ?? []));

    const lastDelete = await deleteSnapshot(store, "shared-live-snapshot", "shared-live-rev", "shared-live-delete");
    await store.acknowledgeOutbox(lastDelete.event.changeSeq);
    await store.pruneThrough(lastDelete.event.changeSeq);
    await store.expireDeletedPayload(expiryRequest(store, "shared-live-snapshot", "shared-live-rev", "shared-live-delete"));
    expect(await pathExists(sharedBlob)).toBe(false);
  });

  it("fails closed on a corrupt expiry root and preserves both its payload and an orphan file", async () => {
    const directory = await newDirectory();
    let failOnce = true;
    const store = await openStore({ directory, faults: { reclamation: (point) => {
      if (point === "after-expiry-commit" && failOnce) { failOnce = false; throw new Error("post-marker fault"); }
    } } });
    const capture = await captureRevision(store, {
      snapshotId: "corrupt-expiry-snapshot", manifestRevision: "corrupt-expiry-manifest",
      attemptId: "corrupt-expiry-capture", payload: "must survive invalid expiry root",
    });
    const deletion = await deleteSnapshot(store, "corrupt-expiry-snapshot", "corrupt-expiry-manifest", "corrupt-expiry-tombstone");
    await acknowledgeAndPrune(store, deletion.event.changeSeq);
    const request = expiryRequest(store, "corrupt-expiry-snapshot", "corrupt-expiry-manifest", "corrupt-expiry-tombstone");
    await expectStorageCode(store.expireDeletedPayload(request), "storage-failed");
    const candidateBlob = objectPath(directory, capture);
    expect(await pathExists(candidateBlob)).toBe(true);
    await closeStore(store);

    const key = tupleKeyV2("payload-expired:", [request.snapshotId, request.manifestRevision]);
    await mutateJournal(directory, (db) => {
      const json = db.get(key);
      if (typeof json !== "string") throw new Error("missing expiry root");
      const record = JSON.parse(json) as Record<string, unknown>;
      record.manifestSha256 = "0".repeat(64);
      db.putSync(key, canonicalJsonV2(record));
    });
    const orphanBytes = new TextEncoder().encode("orphan retained if any lifecycle root is corrupt");
    const orphanHash = createHash("sha256").update(orphanBytes).digest("hex");
    const blobs = await openBlobStoreV2(join(directory, "objects"));
    await blobs.stage(orphanBytes, orphanHash);
    const orphan = join(directory, "objects", "sha256", orphanHash.slice(0, 2), orphanHash);

    await expect(openStore({ directory })).rejects.toMatchObject({ code: "storage-corrupt" });
    expect(Array.from(await fs.readFile(candidateBlob))).toEqual(Array.from(capture.fixture.rows[0]!.bytes));
    expect(Array.from(await fs.readFile(orphan))).toEqual(Array.from(orphanBytes));
  });

  it.each(["missing", "corrupt"] as const)(
    "does not commit expiry or sweep orphans when the candidate blob is %s",
    async (damage) => {
      const directory = await newDirectory();
      const store = await openStore({ directory });
      const capture = await captureRevision(store, {
        snapshotId: "damaged-payload-snapshot", manifestRevision: "damaged-payload-manifest",
        attemptId: "damaged-payload-capture", payload: "candidate bytes must pass full disk verification",
      });
      const deletion = await deleteSnapshot(
        store, "damaged-payload-snapshot", "damaged-payload-manifest", "damaged-payload-tombstone",
      );
      await acknowledgeAndPrune(store, deletion.event.changeSeq);
      const request = expiryRequest(
        store, "damaged-payload-snapshot", "damaged-payload-manifest", "damaged-payload-tombstone",
      );
      const blob = objectPath(directory, capture);
      let tampered: Buffer | undefined;
      if (damage === "missing") {
        await fs.rm(blob);
      } else {
        tampered = await fs.readFile(blob);
        tampered[0] = (tampered[0] ?? 0) ^ 0xff;
        await fs.writeFile(blob, tampered);
      }
      const orphanBytes = new TextEncoder().encode("recover must not sweep after payload integrity fails");
      const orphanHash = createHash("sha256").update(orphanBytes).digest("hex");
      const blobs = await openBlobStoreV2(join(directory, "objects"));
      await blobs.stage(orphanBytes, orphanHash);
      const orphan = join(directory, "objects", "sha256", orphanHash.slice(0, 2), orphanHash);

      await expectStorageCode(store.expireDeletedPayload(request), "storage-corrupt");
      expect(await store.getPayloadExpiry(request.snapshotId, request.manifestRevision)).toBeUndefined();
      expect(await store.getHead(request.snapshotId)).toBeUndefined();
      expect(await store.getDeletedHead(request.snapshotId)).toMatchObject({ tombstoneRevision: request.tombstoneRevision });
      expect(await store.getTombstone(request.snapshotId, request.tombstoneRevision)).toMatchObject({
        previousManifestRevision: request.manifestRevision,
      });
      await expect(store.readSnapshot(request.snapshotId, request.manifestRevision))
        .rejects.toMatchObject({ code: "storage-corrupt" });
      await expectStorageCode(store.recover(), "storage-corrupt");
      expect(await pathExists(blob)).toBe(damage === "corrupt");
      expect(Array.from(await fs.readFile(orphan))).toEqual(Array.from(orphanBytes));
      if (tampered) expect(await fs.readFile(blob)).toEqual(tampered);
    },
  );

});
