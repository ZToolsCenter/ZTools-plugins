import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openSnapshotStoreV2, PolicyCommitAuthorityV2, type SnapshotStoreV2 } from "../../../packages/snapshot-store/src/index";
import { mapNativeCaptureWire } from "../preload/native-capture-adapter";
import { scanner } from "./content-scanner-v2-fixtures";
import { attestNativeFixture, nativeWireArtifacts, runNativeWireFixture } from "./native-capture-helper-fixture";
import { buildNativeFixtureManifestV2 } from "./native-storage-fixtures";
import { wireContext } from "./native-capture-wire-fixtures";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe.skipIf(process.platform !== "darwin")("owned native formats through durable consumer inbox", () => {
  let wire: Buffer;
  let attestation: Awaited<ReturnType<typeof attestNativeFixture>>;
  const cases: Array<{ name: string; status: "PASS" }> = [];
  const directories: string[] = [];
  const stores: SnapshotStoreV2[] = [];
  const workers: Awaited<ReturnType<typeof scanner>>[] = [];
  beforeAll(async () => {
    attestation = await attestNativeFixture();
    const result = await runNativeWireFixture(true);
    expect(result.code).toBe(0); expect(result.stderr).toBe("");
    expect(result.exitConfirmed && result.streamsClosed).toBe(true);
    wire = result.stdout;
  });
  afterAll(async () => {
    await Promise.all(workers.map((worker) => worker.dispose()));
    await Promise.all(stores.map((store) => store.close()));
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
    if (wire && attestation) await writeFile(path.join(nativeWireArtifacts, process.versions.electron
      ? "v021-electron-native-consumer.json" : "v021-node-native-consumer.json"), JSON.stringify({
      execution: cases.length === 2 ? "PASS" : "FAIL", cases, attestation,
      wireSha256: digest(wire), scope: "private-named-pasteboard-worker-LMDB-inbox-reopen-lease-and-ack",
      runtime: { node: process.versions.node, electron: process.versions.electron ?? null },
      generalClipboardAccess: false, productionWiring: false, targetApplicationAcceptance: false, gateComplete: false,
    }, null, 2) + "\n");
  });
  async function open(literal?: string) {
    const mapped = mapNativeCaptureWire(wire, wireContext());
    const worker = await scanner({ codecs: mapped.codecs, policy: { revision: mapped.input.policy.revision,
      blockLikelySecrets: false, contentRules: literal === undefined ? [] : [{ type: "literal", value: literal }] } });
    workers.push(worker);
    await mkdir(nativeWireArtifacts, { recursive: true });
    const directory = await mkdtemp(path.join(nativeWireArtifacts, "v021-native-consumer-"));
    directories.push(directory);
    const clock = { now: 1_000_000 };
    const store = await openSnapshotStoreV2({ directory, scan: worker.scan,
      policy: new PolicyCommitAuthorityV2(mapped.input.policy.revision), consumer: { now: () => clock.now } });
    stores.push(store);
    return { store, directory, mapped, clock, worker };
  }

  it("preserves original text/HTML/RTF while an inbox lease survives prune and process-owner reopen", async () => {
    const { store, directory, mapped, clock, worker } = await open();
    const captured = await store.captureAndCommit({ capture: mapped.input,
      manifest: (receipt) => buildNativeFixtureManifestV2(mapped, store.hostEpoch, receipt), expectedManifestRevision: null });
    expect(captured.status).toBe("committed");
    const consumerId = "synthetic-native-history";
    const epoch = store.hostEpoch;
    expect(await store.stageConsumerPage({ consumerId, hostEpoch: epoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "staged", stagedCount: 1, checkpoint: { enqueuedThrough: "1", acknowledgedThrough: "0" } });
    const first = await store.claimConsumerEvent({ consumerId, hostEpoch: epoch, leaseMs: 1000 });
    expect(first.status).toBe("claimed");
    if (first.status !== "claimed") throw new Error("synthetic-native-inbox-not-claimed");
    await store.pruneThrough("1");
    await store.close();
    const reopened = await openSnapshotStoreV2({ directory, scan: async () => { throw new Error("replay-must-not-rescan"); },
      policy: new PolicyCommitAuthorityV2(mapped.input.policy.revision), consumer: { now: () => clock.now } });
    stores.push(reopened);
    expect(await reopened.readChanges({ hostEpoch: epoch, after: "0", limit: 10 })).toMatchObject({ status: "cursor-expired" });
    expect(await reopened.claimConsumerEvent({ consumerId, hostEpoch: epoch, leaseMs: 1000 })).toMatchObject({ status: "idle" });
    clock.now += 1000;
    await expect(reopened.acknowledgeConsumerEvent({ consumerId, hostEpoch: epoch, changeSeq: "1", token: first.task.lease.token }))
      .rejects.toMatchObject({ code: "conflict" });
    const retry = await reopened.claimConsumerEvent({ consumerId, hostEpoch: epoch, leaseMs: 1000 });
    expect(retry.status).toBe("claimed");
    if (retry.status !== "claimed") throw new Error("synthetic-native-inbox-not-reclaimed");
    expect(retry.task.deliveryId).toBe(first.task.deliveryId);
    expect(retry.task.lease.token).not.toBe(first.task.lease.token);
    const saved = await reopened.readSnapshot(mapped.input.snapshotId, mapped.input.manifestRevision);
    expect(saved).toBeDefined();
    expect(saved!.manifest.items.flatMap((item) => item.representations).filter((row) => row.state === "ready"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ nativeName: "public.utf8-plain-text" }),
        expect.objectContaining({ nativeName: "public.html" }), expect.objectContaining({ nativeName: "public.rtf" })]));
    for (const row of saved!.representations) {
      const original = mapped.input.representations.find((candidate) => candidate.representationKey === row.representationKey);
      expect(original?.state).toBe("captured");
      if (original?.state === "captured") expect(digest(row.bytes)).toBe(digest(original.bytes));
    }
    const ack = { consumerId, hostEpoch: epoch, changeSeq: "1", token: retry.task.lease.token };
    expect(await reopened.acknowledgeConsumerEvent(ack)).toMatchObject({ checkpoint: { acknowledgedThrough: "1" }, replayed: false });
    expect(await reopened.acknowledgeConsumerEvent(ack)).toMatchObject({ replayed: true });
    expect((await reopened.readConsumerInbox({ consumerId, limit: 10 }))!.tasks).toEqual([]);
    expect(await reopened.readOutbox(10)).toHaveLength(1);
    expect(worker.diagnostics().active).toBe(0);
    cases.push({ name: "exact-native-formats-inbox-prune-reopen-expired-lease-fencing-ack", status: "PASS" });
  });

  it("delivers only a redacted denial outcome when the real privacy worker rejects native content", async () => {
    const { store, mapped } = await open("wire fixture hello");
    const rejected = await store.captureAndCommit({ capture: mapped.input,
      manifest: () => { throw new Error("denied-content-has-no-manifest"); }, expectedManifestRevision: null });
    expect(rejected.status).toBe("rejected");
    const consumerId = "synthetic-policy-outcomes";
    expect(await store.stageConsumerPage({ consumerId, hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "staged", stagedCount: 1 });
    const task = await store.claimConsumerEvent({ consumerId, hostEpoch: store.hostEpoch, leaseMs: 1000 });
    expect(task.status).toBe("claimed");
    if (task.status !== "claimed") throw new Error("synthetic-redacted-outcome-not-claimed");
    expect(task.task.event).toMatchObject({ eventType: "outcome", outcomeCode: "policy-denied" });
    expect(JSON.stringify(task.task)).not.toContain("wire fixture hello");
    expect(JSON.stringify(task.task)).not.toContain("public.html");
    expect(await store.readSnapshot(mapped.input.snapshotId, mapped.input.manifestRevision)).toBeUndefined();
    expect(await store.recover()).toEqual({ checkedObjects: 0, discardedStaging: 0, removedOrphans: 0 });
    cases.push({ name: "real-worker-rejection-redacted-inbox-only-no-raw-retention", status: "PASS" });
  });
});
