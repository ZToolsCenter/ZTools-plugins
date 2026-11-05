import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSnapshotStoreV2, PolicyCommitAuthorityV2, type SnapshotStoreV2 } from "../../../packages/snapshot-store/src/index";
import { digestV2, makeManifestFromReceiptV2, makeStoreCaptureV2 } from "../../../packages/snapshot-store/tests/store-fixtures";
import { scanner } from "./content-scanner-v2-fixtures";
import { makeRtf, rtf, rtfUnicode } from "./content-rtf-fixtures";

const ordinary = rtf("{|rtf1|ansi|uc0 prefix{|*|atnid AB}{|*|atnauthor Public Reviewer}|chatn{|*|annotation{|*|atndate 1180187342}|pard|plain reviewed ") +
  rtfUnicode("测试").replaceAll("?", "") + "} suffix}";
const root = path.resolve("artifacts/pasteboardpro/clipboard-format-g0/v024-rtf-storage-tests");

describe("RTF annotation policy to immutable durable bytes", () => {
  const stores: SnapshotStoreV2[] = [];
  const workers: Awaited<ReturnType<typeof scanner>>[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.dispose()));
    await Promise.all(stores.splice(0).map((store) => store.close()));
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: false })));
  });

  async function open(literal?: string, includePlain = false) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(path.join(root, "owned-"));
    directories.push(directory);
    const worker = await scanner({ codecs: [
      { representationKey: "rtf", contentKind: "rich-text", richTextFormat: "rtf" },
      ...(includePlain ? [{ representationKey: "plain", contentKind: "text" as const,
        encoding: "utf-8" as const, termination: "none" as const }] : []),
    ], policy: { revision: "policy-1", blockLikelySecrets: true,
      contentRules: literal ? [{ type: "literal", value: literal }] : [] } });
    workers.push(worker);
    const store = await openSnapshotStoreV2({ directory, policy: new PolicyCommitAuthorityV2("policy-1"), scan: worker.scan });
    stores.push(store);
    return { store, directory, worker };
  }

  function capture(source: string, includePlain = false) {
    return makeStoreCaptureV2({ contentRulesEnabled: true, rows: [
      { representationKey: "rtf", itemIndex: 0, contentKind: "rich-text", bytes: makeRtf(source),
        formatId: "public.rtf", nativeName: "public.rtf", mime: "application/rtf" },
      ...(includePlain ? [{ representationKey: "plain", itemIndex: 0, contentKind: "text" as const,
        bytes: new TextEncoder().encode("ordinary plain fallback"),
        formatId: "public.utf8-plain-text", nativeName: "public.utf8-plain-text", mime: "text/plain;charset=utf-8" }] : []),
    ] });
  }

  it("stores the complete annotated RTF unchanged, and reads exact bytes after close/reopen", async () => {
    const { store, directory, worker } = await open();
    const fixture = capture(ordinary);
    const input = fixture.capture.representations[0];
    if (input?.state !== "captured") throw new Error("expected synthetic captured bytes");
    const original = input.bytes.slice();
    const committed = await store.captureAndCommit({ capture: fixture.capture,
      manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch), expectedManifestRevision: null });
    expect(committed.status).toBe("committed");
    if (committed.status !== "committed") throw new Error("annotation fixture was not committed");
    expect(committed.receipt.representations[0]).toMatchObject({ retentionAllowed: true });
    expect(committed.receipt.permissions).toEqual({ preview: false, paste: false, sync: false });
    expect(input.bytes).toEqual(original);
    expect(JSON.stringify(committed.receipt)).not.toContain("Public Reviewer");
    const epoch = store.hostEpoch;
    await store.close();
    const reopened = await openSnapshotStoreV2({ directory, policy: new PolicyCommitAuthorityV2("policy-1"),
      scan: async () => { throw new Error("immutable read must not scan a current clipboard"); } });
    stores.push(reopened);
    expect(reopened.hostEpoch).toBe(epoch);
    const saved = await reopened.readSnapshot(fixture.capture.snapshotId, fixture.capture.manifestRevision);
    expect(saved?.manifest.captureState).toBe("ready");
    expect(saved?.representations).toHaveLength(1);
    expect(Array.from(saved!.representations[0]!.bytes)).toEqual(Array.from(original));
    expect(saved!.representations[0]!.sha256).toBe(digestV2(original));
    expect(saved!.manifest.items[0]!.representations[0]).toMatchObject({ fidelity: "exact", nativeName: "public.rtf" });
    expect(JSON.stringify(worker.diagnostics())).not.toContain("Public Reviewer");
  });

  it("blocks the whole copy when an encoded annotation matches, without persisting either representation", async () => {
    const { store, worker } = await open("测试", true);
    const fixture = capture(ordinary, true);
    const rejected = await store.captureAndCommit({ capture: fixture.capture,
      manifest: () => { throw new Error("denied copy must not materialize a manifest"); }, expectedManifestRevision: null });
    expect(rejected.status).toBe("rejected");
    const page = await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 });
    expect(page.status).toBe("ok");
    if (page.status !== "ok") throw new Error("expected synthetic event page");
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({ eventType: "outcome", outcomeCode: "policy-denied" });
    expect(JSON.stringify(page.events)).not.toContain("测试");
    expect(await store.readSnapshot(fixture.capture.snapshotId, fixture.capture.manifestRevision)).toBeUndefined();
    expect(await store.recover()).toEqual({ checkedObjects: 0, discardedStaging: 0, removedOrphans: 0 });
    expect(JSON.stringify(worker.diagnostics())).not.toContain("测试");
  });

  it("retains only the valid plain representation when isolated comment metadata cannot be completely checked", async () => {
    const { store } = await open(undefined, true);
    const fixture = capture(rtf("{|rtf1|ansi ordinary{|*|atnauthor isolated reviewer}}"), true);
    const result = await store.captureAndCommit({ capture: fixture.capture,
      manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch), expectedManifestRevision: null });
    expect(result.status).toBe("committed");
    const saved = await store.readSnapshot(fixture.capture.snapshotId, fixture.capture.manifestRevision);
    expect(saved?.manifest.captureState).toBe("partial");
    expect(saved?.manifest.coverage).toEqual({ requested: 2, captured: 1, omitted: 1 });
    expect(saved?.representations.map((row) => row.representationKey)).toEqual(["plain"]);
    expect(saved?.manifest.items[0]?.representations.find((row) => row.representationKey === "rtf"))
      .toMatchObject({ state: "policy-blocked", reasonCode: "required-check-unavailable" });
  });
});
