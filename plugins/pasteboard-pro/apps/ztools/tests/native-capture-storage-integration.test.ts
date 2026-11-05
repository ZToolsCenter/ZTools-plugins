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


describe.skipIf(process.platform !== "darwin")("owned AppKit capture to durable G1 storage", () => {
  let wire: Buffer;
  let attestation: Awaited<ReturnType<typeof attestNativeFixture>>;
  const cases: Array<{ name: string; status: "PASS" }> = [];
  const stores: SnapshotStoreV2[] = [];
  const directories: string[] = [];
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
    if (attestation && wire) await writeFile(path.join(nativeWireArtifacts, process.versions.electron
      ? "v020-electron-native-storage.json" : "v020-node-native-storage.json"), JSON.stringify({
      execution: cases.length === 3 ? "PASS" : "FAIL", scope: "synthetic-private-named-pasteboard-to-real-LMDB-and-filesystem",
      runtime: { node: process.versions.node, electron: process.versions.electron ?? null },
      attestation, wireSha256: createHash("sha256").update(wire).digest("hex"), cases,
      productionWiring: false, generalClipboardAccess: false, gateComplete: false,
    }, null, 2) + "\n");
  });
  async function open(literal?: string, fault = false) {
    const mapped = mapNativeCaptureWire(wire, wireContext());
    const worker = await scanner({ codecs: mapped.codecs, policy: {
      revision: mapped.input.policy.revision, blockLikelySecrets: false,
      contentRules: literal === undefined ? [] : [{ type: "literal", value: literal }],
    } });
    workers.push(worker);
    await mkdir(nativeWireArtifacts, { recursive: true });
    const directory = await mkdtemp(path.join(nativeWireArtifacts, "v020-native-storage-"));
    directories.push(directory);
    const store = await openSnapshotStoreV2({ directory, scan: worker.scan, policy: new PolicyCommitAuthorityV2(mapped.input.policy.revision),
      ...(fault ? { faults: { journal: (point: string) => { if (point === "after-event") throw new Error("synthetic-g1-fault"); } } } : {}) });
    stores.push(store);
    return { store, directory, worker, mapped };
  }

  it("commits actual text, HTML and RTF bytes then replays the same immutable data after reopen", async () => {
    const { store, directory, worker, mapped } = await open();
    const committed = await store.captureAndCommit({ capture: mapped.input,
      manifest: (receipt) => buildNativeFixtureManifestV2(mapped, store.hostEpoch, receipt), expectedManifestRevision: null });
    expect(committed.status).toBe("committed");
    if (committed.status !== "committed") throw new Error("g1-fixture-not-committed");
    expect(committed.event.changeSeq).toBe("1"); expect(committed.receipt.permissions).toEqual({ preview: false, paste: false, sync: false });
    const epoch = store.hostEpoch;
    await store.close();
    const reopened = await openSnapshotStoreV2({ directory, policy: new PolicyCommitAuthorityV2(mapped.input.policy.revision),
      scan: async () => { throw new Error("replay-must-not-rescan-current-clipboard"); } });
    stores.push(reopened);
    expect(reopened.hostEpoch).toBe(epoch);
    const page = await reopened.readChanges({ hostEpoch: epoch, after: "0", limit: 20 });
    expect(page).toMatchObject({ status: "ok", nextCursor: "1", latestChangeSeq: "1" });
    const saved = await reopened.readSnapshot(mapped.input.snapshotId, mapped.input.manifestRevision);
    expect(saved).toBeDefined();
    expect(saved!.manifest.captureState).toBe("partial");
    for (const row of saved!.representations) {
      const original = mapped.input.representations.find((entry) => entry.representationKey === row.representationKey);
      expect(original?.state).toBe("captured");
      if (original?.state === "captured") expect(Array.from(row.bytes)).toEqual(Array.from(original.bytes));
      expect(createHash("sha256").update(row.bytes).digest("hex")).toBe(row.sha256);
    }
    for (const nativeName of ["public.utf8-plain-text", "public.html", "public.rtf"]) {
      expect(saved!.manifest.items.some((item) => item.representations.some((row) => row.nativeName === nativeName && row.state === "ready"))).toBe(true);
    }
    expect(worker.diagnostics().active).toBe(0);
    cases.push({ name: "actual-owned-native-bytes-durable-close-reopen-feed-readback", status: "PASS" });
  });

  it("persists a redacted denial without any raw object when a real worker finds a content match", async () => {
    const { store, mapped } = await open("wire fixture hello");
    const result = await store.captureAndCommit({ capture: mapped.input,
      manifest: () => { throw new Error("denied-content-must-not-materialize-a-manifest"); }, expectedManifestRevision: null });
    expect(result.status).toBe("rejected");
    const page = await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 20 });
    expect(page.status).toBe("ok");
    if (page.status === "ok") {
      expect(page.events).toHaveLength(1); expect(page.events[0]).toMatchObject({ eventType: "outcome", outcomeCode: "policy-denied" });
      expect(JSON.stringify(page.events)).not.toContain("wire fixture hello");
      expect(JSON.stringify(page.events)).not.toContain("public.html");
    }
    expect(await store.readSnapshot(mapped.input.snapshotId, mapped.input.manifestRevision)).toBeUndefined();
    expect(await store.recover()).toEqual({ checkedObjects: 0, discardedStaging: 0, removedOrphans: 0 });
    cases.push({ name: "real-worker-content-denial-only-redacted-journal-outcome", status: "PASS" });
  });

  it("never publishes a ready manifest after a real transaction fault and reconciles orphan bytes on restart", async () => {
    const { store, directory, mapped } = await open(undefined, true);
    await expect(store.captureAndCommit({ capture: mapped.input,
      manifest: (receipt) => buildNativeFixtureManifestV2(mapped, store.hostEpoch, receipt), expectedManifestRevision: null })).rejects.toMatchObject({ code: "storage-failed" });
    expect(await store.readSnapshot(mapped.input.snapshotId, mapped.input.manifestRevision)).toBeUndefined();
    await store.close();
    const reopened = await openSnapshotStoreV2({ directory, policy: new PolicyCommitAuthorityV2(mapped.input.policy.revision),
      scan: async () => { throw new Error("recovery-does-not-read-current-clipboard"); } });
    stores.push(reopened);
    expect(await reopened.readChanges({ hostEpoch: reopened.hostEpoch, after: "0", limit: 20 }))
      .toMatchObject({ status: "ok", latestChangeSeq: "0", events: [] });
    expect(await reopened.recover()).toEqual({ checkedObjects: 0, discardedStaging: 0, removedOrphans: 0 });
    cases.push({ name: "transaction-abort-no-ready-or-seq-and-locked-orphan-recovery", status: "PASS" });
  });
});
