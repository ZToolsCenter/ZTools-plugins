import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from "@pasteboard-pro/snapshot-store";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.resolve(packageRoot, "../../artifacts/pasteboardpro/clipboard-format-g0/v023-runtime-runs");
await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
const tempRoot = await fs.mkdtemp(path.join(artifactRoot, "run-"));
const ownerMarker = path.join(tempRoot, ".snapshot-store-runtime-smoke-owned");
await fs.writeFile(ownerMarker, "snapshot-store-runtime-smoke-v1\n", { flag: "wx", mode: 0o600 });

const bytes = new TextEncoder().encode("Synthetic clipboard fixture: exact UTF-8 π 🧷\n");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const capture = {
  attemptId: "runtime-attempt-1",
  snapshotId: "runtime-snapshot-1",
  manifestRevision: "runtime-manifest-1",
  receiptId: "runtime-receipt-1",
  capturedRevision: "synthetic-clipboard-revision-1",
  observedRevision: "synthetic-clipboard-revision-1",
  policy: { revision: "synthetic-policy-1", contentRulesEnabled: true, requireFileBodyScan: false },
  preflight: {
    capturedRevision: "synthetic-clipboard-revision-1",
    policyRevision: "synthetic-policy-1",
    captureAllowed: true,
    localHistoryAllowed: true,
    cloudUploadAllowed: false,
  },
  representations: [{
    representationKey: "runtime-plain-text",
    itemIndex: 0,
    state: "captured",
    contentKind: "text",
    bytes,
  }],
};

function manifestFromReceipt(receipt, hostEpoch) {
  const admitted = receipt.representations[0];
  assert.equal(admitted?.retentionAllowed, true, "synthetic scanner must admit only its fixed fixture");
  return {
    schemaVersion: 2,
    snapshotId: capture.snapshotId,
    manifestRevision: capture.manifestRevision,
    source: {
      hostEpoch,
      platform: "macos",
      osRevision: capture.capturedRevision,
      capturedAt: "2026-10-27T12:00:00.000Z",
      osBuild: "synthetic-macOS-build",
      architecture: "arm64",
      adapterVersion: "synthetic-runtime-smoke-v1",
      itemModel: "macos-items",
      sourceApplication: { kind: "unknown" },
      attribution: "unknown",
    },
    policyReceiptId: receipt.receiptId,
    items: [{
      index: 0,
      representations: [{
        representationKey: "runtime-plain-text",
        formatId: "public.utf8-plain-text",
        nativeName: "public.utf8-plain-text",
        mime: "text/plain;charset=utf-8",
        state: "ready",
        storage: "blob",
        fidelity: "exact",
        byteLength: bytes.byteLength,
        sha256,
        blobRef: `sha256-${sha256}`,
      }],
    }],
    coverage: { requested: 1, captured: 1, omitted: 0 },
    captureState: "ready",
  };
}

let store;
try {
  store = await openSnapshotStoreV2({
    directory: path.join(tempRoot, "store"),
    policy: new PolicyCommitAuthorityV2("synthetic-policy-1"),
    scan: async (request) => {
      assert.equal(request.representationKey, "runtime-plain-text");
      assert.deepEqual(Buffer.from(request.bytes), Buffer.from(bytes));
      return request.requiredScopes.map((scope) => ({ scope, status: "passed" }));
    },
  });
  const originalEpoch = store.hostEpoch;
  const commit = await store.captureAndCommit({
    capture,
    manifest: (receipt) => manifestFromReceipt(receipt, originalEpoch),
    expectedManifestRevision: null,
  });
  assert.equal(commit.status, "committed");
  assert.equal(commit.replayed, false);
  assert.equal(commit.event.changeSeq, "1");
  const consumerId = "synthetic-runtime-consumer";
  const staged = await store.stageConsumerPage({ consumerId, hostEpoch: originalEpoch, after: "0", limit: 10 });
  assert.equal(staged.status, "staged");
  assert.equal(staged.stagedCount, 1);
  const delivery = await store.claimConsumerEvent({ consumerId, hostEpoch: originalEpoch, leaseMs: 300_000 });
  assert.equal(delivery.status, "claimed");
  assert.equal(delivery.task.event.changeSeq, "1");
  await store.close();
  store = undefined;

  store = await openSnapshotStoreV2({
    directory: path.join(tempRoot, "store"),
    policy: new PolicyCommitAuthorityV2("synthetic-policy-1"),
    scan: async () => { throw new Error("reopen must not rescan a committed attempt"); },
  });
  assert.equal(store.hostEpoch, originalEpoch);
  const feed = await store.readChanges({ hostEpoch: originalEpoch, after: "0", limit: 10 });
  assert.equal(feed.status, "ok");
  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0]?.changeSeq, "1");
  const snapshot = await store.readSnapshot("runtime-snapshot-1", "runtime-manifest-1");
  assert.ok(snapshot);
  assert.deepEqual(Buffer.from(snapshot.representations[0].bytes), Buffer.from(bytes));
  assert.equal(digest(snapshot.representations[0].bytes), sha256);
  const inbox = await store.readConsumerInbox({ consumerId, limit: 10 });
  assert.equal(inbox.checkpoint.enqueuedThrough, "1");
  assert.equal(inbox.checkpoint.acknowledgedThrough, "0");
  assert.equal(inbox.tasks[0].deliveryId, delivery.task.deliveryId);
  assert.equal(inbox.tasks[0].state, "leased");
  assert.equal("token" in inbox.tasks[0].lease, false);
  const completed = await store.acknowledgeConsumerEvent({ consumerId, hostEpoch: originalEpoch,
    changeSeq: "1", token: delivery.task.lease.token });
  assert.equal(completed.checkpoint.acknowledgedThrough, "1");
  assert.deepEqual((await store.readConsumerInbox({ consumerId, limit: 10 })).tasks, []);
  const tombstone = {
    schemaVersion: 2, hostEpoch: originalEpoch, snapshotId: capture.snapshotId,
    tombstoneRevision: "runtime-tombstone-1", attemptId: "runtime-delete-attempt-1",
    previousManifestRevision: capture.manifestRevision, reasonCode: "user-deleted",
  };
  const deletion = await store.deleteSnapshot(tombstone);
  assert.equal(deletion.event.eventType, "delete");
  assert.equal(deletion.event.changeSeq, "2");
  assert.equal((await store.stageConsumerPage({ consumerId, hostEpoch: originalEpoch,
    after: "1", limit: 10 })).stagedCount, 1);
  const deletionDelivery = await store.claimConsumerEvent({ consumerId, hostEpoch: originalEpoch, leaseMs: 300_000 });
  assert.equal(deletionDelivery.status, "claimed");
  assert.equal(deletionDelivery.task.event.eventType, "delete");
  const deletionAck = await store.acknowledgeConsumerEvent({ consumerId, hostEpoch: originalEpoch,
    changeSeq: "2", token: deletionDelivery.task.lease.token });
  assert.equal(deletionAck.checkpoint.acknowledgedThrough, "2");
  await store.close();
  store = undefined;
  store = await openSnapshotStoreV2({
    directory: path.join(tempRoot, "store"),
    policy: new PolicyCommitAuthorityV2("synthetic-policy-1"),
    scan: async () => { throw new Error("historical retry must not rescan"); },
  });
  assert.deepEqual(await store.getDeletedHead(capture.snapshotId), tombstone);
  assert.deepEqual(await store.getTombstone(capture.snapshotId, tombstone.tombstoneRevision), tombstone);
  assert.equal(await store.getHead(capture.snapshotId), undefined);
  assert.equal((await store.deleteSnapshot(tombstone)).replayed, true);
  const replay = await store.captureAndCommit({ capture,
    manifest: (receipt) => manifestFromReceipt(receipt, originalEpoch), expectedManifestRevision: null });
  assert.equal(replay.replayed, true);
  assert.equal(await store.getHead(capture.snapshotId), undefined);
  const retained = await store.readSnapshot(capture.snapshotId, capture.manifestRevision);
  assert.equal(digest(retained.representations[0].bytes), sha256);
  const leaseRequest = { hostEpoch: originalEpoch, leaseId: randomUUID(), token: randomUUID(),
    snapshotId: capture.snapshotId, manifestRevision: capture.manifestRevision, purpose: "pending-target" };
  assert.equal((await store.acquirePayloadLease(leaseRequest)).status, "acquired");
  assert.equal("token" in await store.getPayloadLease(leaseRequest.leaseId), false);
  await store.acknowledgeOutbox("1");
  await store.acknowledgeOutbox("2");
  assert.equal((await store.getOutboxAcknowledgement("2")).event.changeSeq, "2");
  await store.pruneThrough("2");
  const expiryRequest = { hostEpoch: originalEpoch, snapshotId: capture.snapshotId,
    manifestRevision: capture.manifestRevision, tombstoneRevision: tombstone.tombstoneRevision };
  assert.deepEqual(await store.expireDeletedPayload(expiryRequest), { status: "blocked", reason: "active-payload-lease" });
  await store.releasePayloadLease({ hostEpoch: originalEpoch, leaseId: leaseRequest.leaseId, token: leaseRequest.token });
  assert.equal(await store.getPayloadLease(leaseRequest.leaseId), undefined);
  const expired = await store.expireDeletedPayload(expiryRequest);
  assert.equal(expired.status, "expired");
  assert.equal(expired.recovery.removedOrphans, 1);
  await assert.rejects(store.readSnapshot(capture.snapshotId, capture.manifestRevision), { code: "payload-expired" });
  const expiredReplay = await store.captureAndCommit({ capture,
    manifest: (receipt) => manifestFromReceipt(receipt, originalEpoch), expectedManifestRevision: null });
  assert.equal(expiredReplay.status, "payload-expired");
  assert.equal(expiredReplay.replayed, true);
  assert.equal(digest(retained.representations[0].bytes), sha256);
  await store.close();
  store = undefined;
  store = await openSnapshotStoreV2({ directory: path.join(tempRoot, "store"),
    policy: new PolicyCommitAuthorityV2("synthetic-policy-1"), scan: async () => { throw new Error("no rescan after expiry"); } });
  assert.equal((await store.getPayloadExpiry(capture.snapshotId, capture.manifestRevision)).deleteChangeSeq, "2");
  assert.equal((await store.acquirePayloadLease(leaseRequest)).status, "released");
  await assert.rejects(store.readSnapshot(capture.snapshotId, capture.manifestRevision), { code: "payload-expired" });
  await store.close();
  store = undefined;

  console.log(JSON.stringify({
    status: "PASS",
    runtime: `${process.release.name} ${process.version}`,
    platform: process.platform,
    packageImport: "@pasteboard-pro/snapshot-store",
    fixture: "synthetic UTF-8 plain text; no system clipboard reads",
    commitSeq: feed.events[0]?.changeSeq,
    consumerEnqueuedThrough: inbox.checkpoint.enqueuedThrough,
    consumerAcknowledgedThrough: completed.checkpoint.acknowledgedThrough,
    exactBytesSha256: sha256,
    reopenedEpoch: originalEpoch,
    deletionSeq: deletion.event.changeSeq,
    deletionAcknowledgedThrough: deletionAck.checkpoint.acknowledgedThrough,
    deletedHeadSurvivedReopen: true,
    historicalRetryRevivedHead: false,
    payloadExpired: true,
    physicalObjectsReclaimed: expired.recovery.removedOrphans,
    expiredReplayStatus: expiredReplay.status,
    releasedLeaseStayedTerminal: true,
  }, null, 2));
} finally {
  if (store) await store.close().catch(() => undefined);
  const marker = await fs.readFile(ownerMarker, "utf8");
  assert.equal(marker, "snapshot-store-runtime-smoke-v1\n");
  const stat = await fs.lstat(tempRoot);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(path.dirname(tempRoot), artifactRoot);
  await fs.rm(tempRoot, { recursive: true, force: false });
}
