import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  openSnapshotStoreV2,
  PolicyCommitAuthorityV2,
  type PayloadLeaseV2,
  type PayloadLifecycleFaultPointV2,
  type SnapshotStoreOptionsV2,
  type SnapshotStoreV2,
} from "../src/index.js";
import { makeManifestFromReceiptV2, makeStoreCaptureV2 } from "./store-fixtures.js";

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../artifacts/pasteboardpro/clipboard-format-g0/");
const activeStores = new Set<SnapshotStoreV2>();
const directories = new Set<string>();

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
  const directory = await fs.mkdtemp(join(artifactRoot, "payload-leases-"));
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

async function captureOne(store: SnapshotStoreV2, options: {
  attemptId?: string;
  receiptId?: string;
  snapshotId?: string;
  manifestRevision?: string;
  payload?: string;
} = {}) {
  const fixture = makeStoreCaptureV2({
    attemptId: options.attemptId ?? "payload-lease-capture-attempt",
    receiptId: options.receiptId ?? "payload-lease-capture-receipt",
    snapshotId: options.snapshotId ?? "payload-lease-snapshot",
    manifestRevision: options.manifestRevision ?? "payload-lease-manifest",
    contentRulesEnabled: false,
    rows: [{
      representationKey: "payload-lease-text",
      itemIndex: 0,
      contentKind: "text",
      bytes: new TextEncoder().encode(options.payload ?? "synthetic payload lease bytes"),
      formatId: "public.utf8-plain-text",
      nativeName: "public.utf8-plain-text",
      mime: "text/plain;charset=utf-8",
    }],
  });
  const result = await store.captureAndCommit({
    capture: fixture.capture,
    manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch),
    expectedManifestRevision: null,
  });
  expect(result).toMatchObject({ status: "committed", event: { eventType: "upsert" } });
  return { fixture, result };
}

function makeLease(store: SnapshotStoreV2, overrides: Partial<PayloadLeaseV2> = {}): PayloadLeaseV2 {
  return {
    hostEpoch: store.hostEpoch,
    leaseId: randomUUID(),
    token: randomUUID(),
    snapshotId: "payload-lease-snapshot",
    manifestRevision: "payload-lease-manifest",
    purpose: "export",
    ...overrides,
  };
}

describe("durable payload leases in real LMDB", () => {
  it("replays the same caller-generated lease and returns a token-free summary across restart", async () => {
    const directory = await newDirectory();
    let store = await openStore({ directory });
    await captureOne(store);
    const lease = makeLease(store);

    expect(await store.acquirePayloadLease(lease)).toEqual({ status: "acquired", lease, replayed: false });
    expect(await store.acquirePayloadLease(lease)).toEqual({ status: "acquired", lease, replayed: true });
    const summary = await store.getPayloadLease(lease.leaseId);
    expect(summary).toEqual({
      hostEpoch: lease.hostEpoch,
      leaseId: lease.leaseId,
      snapshotId: lease.snapshotId,
      manifestRevision: lease.manifestRevision,
      purpose: lease.purpose,
    });
    expect(summary).not.toHaveProperty("token");

    const epoch = store.hostEpoch;
    await closeStore(store);
    store = await openStore({ directory });
    expect(store.hostEpoch).toBe(epoch);
    expect(await store.getPayloadLease(lease.leaseId)).toEqual(summary);
    expect(await store.acquirePayloadLease(lease)).toEqual({ status: "acquired", lease, replayed: true });
  });

  it("rejects epoch, strict-schema, token, and binding conflicts without changing the active lease", async () => {
    const store = await openStore();
    await captureOne(store);
    const lease = makeLease(store);
    await store.acquirePayloadLease(lease);

    await expect(store.acquirePayloadLease({
      ...lease,
      hostEpoch: "00000000-0000-4000-8000-000000000001",
    })).rejects.toMatchObject({ code: "conflict" });
    await expect(store.acquirePayloadLease({ ...lease, extra: true } as PayloadLeaseV2))
      .rejects.toMatchObject({ code: "invalid-input" });
    await expect(store.acquirePayloadLease({ ...lease, token: randomUUID() }))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(store.acquirePayloadLease({ ...lease, snapshotId: "other-snapshot" }))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(store.releasePayloadLease({
      hostEpoch: lease.hostEpoch,
      leaseId: lease.leaseId,
      token: randomUUID(),
    })).rejects.toMatchObject({ code: "conflict" });
    expect(await store.getPayloadLease(lease.leaseId)).toMatchObject({
      hostEpoch: lease.hostEpoch,
      leaseId: lease.leaseId,
      snapshotId: lease.snapshotId,
      manifestRevision: lease.manifestRevision,
      purpose: lease.purpose,
    });
  });

  it("keeps release terminal and idempotent after restart; a late acquire cannot repin", async () => {
    const directory = await newDirectory();
    let store = await openStore({ directory });
    await captureOne(store);
    const lease = makeLease(store);
    await store.acquirePayloadLease(lease);
    const release = { hostEpoch: lease.hostEpoch, leaseId: lease.leaseId, token: lease.token };

    expect(await store.releasePayloadLease(release)).toEqual({ status: "released", leaseId: lease.leaseId, replayed: false });
    expect(await store.releasePayloadLease(release)).toEqual({ status: "released", leaseId: lease.leaseId, replayed: true });
    expect(await store.getPayloadLease(lease.leaseId)).toBeUndefined();
    await closeStore(store);
    store = await openStore({ directory });

    expect(await store.acquirePayloadLease(lease)).toEqual({ status: "released", leaseId: lease.leaseId, replayed: true });
    expect(await store.releasePayloadLease(release)).toEqual({ status: "released", leaseId: lease.leaseId, replayed: true });
    expect(await store.getPayloadLease(lease.leaseId)).toBeUndefined();
  });

  it("enforces the 128 active-lease cap and frees one slot after release", async () => {
    const store = await openStore();
    await captureOne(store);
    const leases = Array.from({ length: 128 }, () => makeLease(store));
    for (const lease of leases) {
      expect(await store.acquirePayloadLease(lease)).toMatchObject({ status: "acquired", replayed: false });
    }
    const overflow = makeLease(store);
    await expect(store.acquirePayloadLease(overflow)).rejects.toMatchObject({ code: "over-limit" });
    const first = leases[0]!;
    await store.releasePayloadLease({ hostEpoch: first.hostEpoch, leaseId: first.leaseId, token: first.token });
    expect(await store.acquirePayloadLease(overflow)).toMatchObject({ status: "acquired", replayed: false });
  });

  it.each(["after-pin-write", "after-pin-release"] as const)(
    "rolls back the LMDB transaction at %s",
    async (point: PayloadLifecycleFaultPointV2) => {
      const directory = await newDirectory();
      let failOnce = true;
      const store = await openStore({
        directory,
        faults: { payloadLifecycle: (actual) => {
          if (actual === point && failOnce) {
            failOnce = false;
            throw new Error(`injected ${point}`);
          }
        } },
      });
      await captureOne(store);
      const lease = makeLease(store);
      if (point === "after-pin-write") {
        await expect(store.acquirePayloadLease(lease)).rejects.toMatchObject({ code: "storage-failed" });
        expect(await store.getPayloadLease(lease.leaseId)).toBeUndefined();
        expect(await store.acquirePayloadLease(lease)).toMatchObject({ status: "acquired", replayed: false });
        return;
      }

      await store.acquirePayloadLease(lease);
      const release = { hostEpoch: lease.hostEpoch, leaseId: lease.leaseId, token: lease.token };
      await expect(store.releasePayloadLease(release)).rejects.toMatchObject({ code: "storage-failed" });
      expect(await store.getPayloadLease(lease.leaseId)).toMatchObject({ leaseId: lease.leaseId });
      expect(await store.releasePayloadLease(release)).toEqual({ status: "released", leaseId: lease.leaseId, replayed: false });
    },
  );
});
