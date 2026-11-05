import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ClipboardSnapshotManifestV2,
  ContentPolicyScanRequestV2,
  ContentPolicyScanResultV2,
} from "@pasteboard-pro/core";
import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from "../src/index.js";
import type { BlobFaultPointV2 } from "../src/types.js";
import {
  digestV2,
  makeManifestFromReceiptV2,
  makeStoreCaptureV2,
  type StoreCaptureFixtureV2,
  type StoreRepresentationFixtureV2,
} from "./store-fixtures.js";

const artifactRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../artifacts/pasteboardpro/clipboard-format-g0/v020-store-tests",
);
const activeStores = new Set<Awaited<ReturnType<typeof openSnapshotStoreV2>>>();
const sandboxes = new Set<string>();

afterEach(async () => {
  for (const store of [...activeStores]) {
    activeStores.delete(store);
    await store.close().catch(() => undefined);
  }
  for (const sandbox of [...sandboxes]) {
    sandboxes.delete(sandbox);
    await fs.rm(sandbox, { recursive: true, force: true });
  }
});

async function newSandbox(): Promise<string> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const sandbox = await fs.mkdtemp(join(artifactRoot, "run-"));
  sandboxes.add(sandbox);
  return sandbox;
}

async function openStore(
  directory: string,
  options: Readonly<{
    authority?: PolicyCommitAuthorityV2;
    scan?: (request: ContentPolicyScanRequestV2) => Promise<ContentPolicyScanResultV2>;
    blobFault?: (point: BlobFaultPointV2) => void;
  }> = {},
) {
  const store = await openSnapshotStoreV2({
    directory,
    policy: options.authority ?? new PolicyCommitAuthorityV2("policy-1"),
    scan: options.scan ?? (async (request) => request.requiredScopes.map((scope) => ({ scope, status: "passed" as const }))),
    faults: {
      ...(options.blobFault ? { blob: options.blobFault } : {}),
    },
  });
  activeStores.add(store);
  return store;
}

async function closeStore(store: Awaited<ReturnType<typeof openSnapshotStoreV2>>): Promise<void> {
  activeStores.delete(store);
  await store.close();
}

function captureRequest(
  store: Awaited<ReturnType<typeof openSnapshotStoreV2>>,
  fixture: StoreCaptureFixtureV2,
  expectedManifestRevision: string | null = null,
  edit?: (manifest: ClipboardSnapshotManifestV2) => ClipboardSnapshotManifestV2,
) {
  return store.captureAndCommit({
    capture: fixture.capture,
    manifest: (receipt) => {
      const manifest = makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch);
      return edit ? edit(manifest) : manifest;
    },
    expectedManifestRevision,
  });
}

function sampleFormats(): StoreRepresentationFixtureV2[] {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2kAAAAASUVORK5CYII=",
    "base64",
  );
  return [
    {
      representationKey: "plain-text",
      itemIndex: 0,
      contentKind: "text",
      bytes: new TextEncoder().encode("Clipboard text: π and emoji 🧷"),
      formatId: "public.utf8-plain-text",
      nativeName: "public.utf8-plain-text",
      mime: "text/plain;charset=utf-8",
    },
    {
      representationKey: "html",
      itemIndex: 0,
      contentKind: "rich-text",
      bytes: new TextEncoder().encode("<p><strong>exact HTML</strong> fragment</p>"),
      formatId: "text/html",
      nativeName: "text/html",
      mime: "text/html",
    },
    {
      representationKey: "rtf",
      itemIndex: 0,
      contentKind: "rich-text",
      bytes: new TextEncoder().encode("{\\rtf1\\ansi exact {\\b RTF} bytes}"),
      formatId: "public.rtf",
      nativeName: "public.rtf",
      mime: "text/rtf",
    },
    {
      representationKey: "image-png",
      itemIndex: 0,
      contentKind: "image",
      bytes: Uint8Array.from(png),
      formatId: "public.png",
      nativeName: "public.png",
      mime: "image/png",
    },
    {
      representationKey: "file-references",
      itemIndex: 0,
      contentKind: "file-reference",
      bytes: new TextEncoder().encode("synthetic typed-reference sidecar bytes"),
      formatId: "public.file-url",
      nativeName: "public.file-url",
      references: [{
        url: "file:///synthetic/clipboard/report.pdf",
        isDirectory: false,
        observedAvailability: "unknown",
      }],
    },
  ];
}

describe("openSnapshotStoreV2 service integration", () => {
  it("persists exact multi-format bytes and ordered changes across close and reopen", async () => {
    const directory = join(await newSandbox(), "store");
    const scan = vi.fn(async (request: ContentPolicyScanRequestV2) =>
      request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })));
    const authority = new PolicyCommitAuthorityV2("policy-1");
    const store = await openStore(directory, { authority, scan });
    const fixture = makeStoreCaptureV2({ rows: sampleFormats(), contentRulesEnabled: false });
    const first = await captureRequest(store, fixture);
    expect(first).toMatchObject({ status: "committed", replayed: false, event: { changeSeq: "1", eventType: "upsert" } });
    if (first.status !== "committed") throw new Error("Expected multi-format commit");
    expect(scan).not.toHaveBeenCalled();
    expect(first.receipt.representations.every((row) => row.retentionAllowed)).toBe(true);
    expect(first.receipt.representations.every((row) => row.contentScanStatus === "not-scanned")).toBe(true);
    expect(first.receipt.permissions).toEqual({ preview: false, paste: false, sync: false });

    const secondFixture = makeStoreCaptureV2({
      attemptId: "attempt-2", snapshotId: "snapshot-2", manifestRevision: "manifest-2", receiptId: "receipt-2",
      rows: [{
        representationKey: "next-text", itemIndex: 0, contentKind: "text",
        bytes: new TextEncoder().encode("second event"), formatId: "public.utf8-plain-text",
        nativeName: "public.utf8-plain-text", mime: "text/plain",
      }],
      contentRulesEnabled: false,
    });
    const second = await captureRequest(store, secondFixture);
    expect(second).toMatchObject({ status: "committed", event: { changeSeq: "2" } });

    const epoch = store.hostEpoch;
    await closeStore(store);
    const reopened = await openStore(directory, { authority, scan });
    expect(reopened.hostEpoch).toBe(epoch);
    const loaded = await reopened.readSnapshot("snapshot-1", "manifest-1");
    expect(loaded?.manifest.source.hostEpoch).toBe(epoch);
    expect(loaded?.manifest.captureState).toBe("ready");
    expect(loaded?.receipt.receiptId).toBe("receipt-1");
    expect(loaded?.representations).toHaveLength(fixture.rows.length);
    for (const row of fixture.rows) {
      const raw = loaded?.representations.find((entry) => entry.representationKey === row.representationKey);
      expect(raw).toBeDefined();
      expect(Array.from(raw!.bytes)).toEqual(Array.from(row.bytes));
      expect(raw!.sha256).toBe(digestV2(row.bytes));
      expect(raw!.byteLength).toBe(row.bytes.byteLength);
    }
    const fileRef = loaded?.manifest.items[0]?.representations.find((entry) => entry.representationKey === "file-references");
    expect(fileRef).toMatchObject({ storage: "file-reference", fidelity: "reference" });

    const page1 = await reopened.readChanges({ hostEpoch: epoch, after: "0", limit: 1 });
    const page2 = await reopened.readChanges({ hostEpoch: epoch, after: "1", limit: 1 });
    expect(page1).toMatchObject({ status: "ok", nextCursor: "1", events: [{ changeSeq: "1", snapshotId: "snapshot-1" }] });
    expect(page2).toMatchObject({ status: "ok", nextCursor: "2", events: [{ changeSeq: "2", snapshotId: "snapshot-2" }] });
    expect(await reopened.readOutbox(10)).toHaveLength(2);
    await reopened.acknowledgeOutbox("1");
    expect(await reopened.readOutbox(10)).toHaveLength(1);
  });

  it("returns only redacted denied outcomes and never persists rejected payloads", async () => {
    const directory = join(await newSandbox(), "store");
    const secret = "synthetic-secret-payload-do-not-keep";
    const fixture = makeStoreCaptureV2({ rows: [{
      representationKey: "secret-text", itemIndex: 0, contentKind: "text",
      bytes: new TextEncoder().encode(secret), formatId: "public.utf8-plain-text",
      nativeName: "private synthetic format name", mime: "text/plain",
    }] });
    const store = await openStore(directory, { scan: async (request) =>
      request.requiredScopes.map((scope) => ({ scope, status: "blocked" as const })) });
    const result = await captureRequest(store, fixture);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("Expected denied outcome");
    expect(result.result).toMatchObject({ status: "denied", outcomeCode: "policy-denied", reasonCode: "content-match" });
    expect(result.outcome).toMatchObject({ eventType: "outcome", changeSeq: "1", attemptId: "attempt-1" });
    const redacted = JSON.stringify(result);
    expect(redacted).not.toContain(secret);
    expect(redacted).not.toContain("private synthetic format name");
    expect(redacted).not.toContain("plain-text");
    const changes = await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 });
    expect(changes).toMatchObject({ status: "ok", events: [{ eventType: "outcome" }] });
    expect(await store.readSnapshot("snapshot-1", "manifest-1")).toBeUndefined();
  });

  it("commits a partial capture with only safe retained representations", async () => {
    const directory = join(await newSandbox(), "store");
    const fixture = makeStoreCaptureV2({ rows: [
      {
        representationKey: "safe-text", itemIndex: 0, contentKind: "text",
        bytes: new TextEncoder().encode("safe retained value"), formatId: "public.utf8-plain-text",
        nativeName: "public.utf8-plain-text",
      },
      {
        representationKey: "uncertain-html", itemIndex: 0, contentKind: "rich-text",
        bytes: new TextEncoder().encode("<p>scanner unavailable</p>"), formatId: "text/html",
        nativeName: "text/html", mime: "text/html",
      },
      {
        representationKey: "unsupported-format", itemIndex: 0, contentKind: "image",
        bytes: new Uint8Array(), unavailableReason: "unsupported", formatId: "private.synthetic.image",
        nativeName: "private.synthetic.image",
      },
    ] });
    const store = await openStore(directory, { scan: async (request) => request.representationKey === "uncertain-html"
      ? request.requiredScopes.map((scope) => ({ scope, status: scope === "text" ? "passed" as const : "not-scanned" as const }))
      : request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })) });
    const result = await captureRequest(store, fixture);
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error("Expected partial capture commit");
    expect(result.receipt.representations.map((row) => row.retentionAllowed)).toEqual([true, false, false]);
    const loaded = await store.readSnapshot("snapshot-1", "manifest-1");
    expect(loaded?.manifest.captureState).toBe("partial");
    expect(loaded?.manifest.coverage).toEqual({ requested: 3, captured: 1, omitted: 2 });
    expect(loaded?.representations.map((row) => row.representationKey)).toEqual(["safe-text"]);
    expect(loaded?.manifest.items[0]?.representations).toMatchObject([
      { representationKey: "safe-text", state: "ready", storage: "blob" },
      { representationKey: "uncertain-html", state: "policy-blocked", reasonCode: "required-check-unavailable" },
      { representationKey: "unsupported-format", state: "unsupported", reasonCode: "unsupported" },
    ]);
  });

  it("rejects mismatched provenance, metadata, and hashes before blob staging", async () => {
    const edits: Array<Readonly<[string, (manifest: ClipboardSnapshotManifestV2) => ClipboardSnapshotManifestV2]>> = [
      ["host epoch", (manifest) => ({ ...manifest, source: { ...manifest.source, hostEpoch: "wrong-host-epoch" } })],
      ["captured revision", (manifest) => ({ ...manifest, source: { ...manifest.source, osRevision: "wrong-capture-revision" } })],
      ["receipt id", (manifest) => ({ ...manifest, policyReceiptId: "wrong-receipt-id" })],
      ["manifest revision", (manifest) => ({ ...manifest, manifestRevision: "wrong-manifest-revision" })],
      ["raw hash", (manifest) => ({
        ...manifest,
        items: manifest.items.map((item) => ({ ...item, representations: item.representations.map((row) =>
          row.representationKey === "plain-text" && row.state === "ready" && row.storage === "blob"
            ? { ...row, sha256: "0".repeat(64), blobRef: `sha256-${"0".repeat(64)}` }
            : row) })),
      })],
    ];
    for (const [label, edit] of edits) {
      const directory = join(await newSandbox(), "store");
      const staged: BlobFaultPointV2[] = [];
      const store = await openStore(directory, { blobFault: (point) => { staged.push(point); } });
      const fixture = makeStoreCaptureV2({ rows: [{
        representationKey: "plain-text", itemIndex: 0, contentKind: "text",
        bytes: new TextEncoder().encode(`bound payload for ${label}`), formatId: "public.utf8-plain-text",
        nativeName: "public.utf8-plain-text",
      }], contentRulesEnabled: false });
      await expect(captureRequest(store, fixture, null, edit)).rejects.toMatchObject({ code: "invalid-input" });
      expect(staged, label).toEqual([]);
      expect(await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
        .toMatchObject({ status: "ok", latestChangeSeq: "0", events: [] });
    }
  });

  it("checks an expected manifest revision before staging replacement blobs", async () => {
    const directory = join(await newSandbox(), "store");
    const staged: BlobFaultPointV2[] = [];
    const store = await openStore(directory, { blobFault: (point) => { staged.push(point); } });
    const initial = makeStoreCaptureV2({ rows: [{
      representationKey: "plain-text", itemIndex: 0, contentKind: "text",
      bytes: new TextEncoder().encode("first revision"), formatId: "public.utf8-plain-text",
      nativeName: "public.utf8-plain-text",
    }], contentRulesEnabled: false });
    await captureRequest(store, initial);
    staged.splice(0);
    const replacement = makeStoreCaptureV2({
      attemptId: "attempt-2", snapshotId: "snapshot-1", manifestRevision: "manifest-2", receiptId: "receipt-2",
      rows: [{
        representationKey: "plain-text", itemIndex: 0, contentKind: "text",
        bytes: new TextEncoder().encode("replacement bytes must not stage on stale CAS"),
        formatId: "public.utf8-plain-text", nativeName: "public.utf8-plain-text",
      }], contentRulesEnabled: false,
    });
    await expect(captureRequest(store, replacement, "stale-revision")).rejects.toMatchObject({ code: "conflict" });
    expect(staged).toEqual([]);
    expect(await store.readSnapshot("snapshot-1", "manifest-1")).toBeDefined();
    expect(await store.readSnapshot("snapshot-1", "manifest-2")).toBeUndefined();
  });

  it("replays a committed attempt without rescanning or staging and keeps permissions false", async () => {
    const directory = join(await newSandbox(), "store");
    const authority = new PolicyCommitAuthorityV2("policy-1");
    const scans: string[] = [];
    const staged: BlobFaultPointV2[] = [];
    const store = await openStore(directory, {
      authority,
      scan: async (request) => {
        scans.push(request.representationKey);
        return request.requiredScopes.map((scope) => ({ scope, status: "passed" as const }));
      },
      blobFault: (point) => { staged.push(point); },
    });
    const fixture = makeStoreCaptureV2({ rows: [{
      representationKey: "replayed-text", itemIndex: 0, contentKind: "text",
      bytes: new TextEncoder().encode("exact replay input"), formatId: "public.utf8-plain-text",
      nativeName: "public.utf8-plain-text",
    }] });
    const first = await captureRequest(store, fixture);
    expect(first.status).toBe("committed");
    const stagesAfterFirst = staged.length;
    await authority.activate("policy-2");
    const replay = await captureRequest(store, fixture);
    expect(replay).toMatchObject({ status: "committed", replayed: true, event: { changeSeq: "1" } });
    expect(scans).toEqual(["replayed-text"]);
    expect(staged).toHaveLength(stagesAfterFirst);
    if (replay.status === "committed") {
      expect(replay.receipt.permissions).toEqual({ preview: false, paste: false, sync: false });
    }
    expect(await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "ok", latestChangeSeq: "1", events: [{ changeSeq: "1" }] });
  });

  it("owns queued input bytes before the caller can mutate them", async () => {
    const directory = join(await newSandbox(), "store");
    let announceFirstScan!: () => void;
    let releaseFirstScan!: () => void;
    const firstStarted = new Promise<void>((resolveScan) => { announceFirstScan = resolveScan; });
    const firstRelease = new Promise<void>((resolveScan) => { releaseFirstScan = resolveScan; });
    const store = await openStore(directory, { scan: async (request) => {
      if (request.representationKey === "first-text") {
        announceFirstScan();
        await firstRelease;
      }
      return request.requiredScopes.map((scope) => ({ scope, status: "passed" as const }));
    } });
    const firstFixture = makeStoreCaptureV2({ rows: [{
      representationKey: "first-text", itemIndex: 0, contentKind: "text",
      bytes: new TextEncoder().encode("blocking first attempt"), formatId: "public.utf8-plain-text",
      nativeName: "public.utf8-plain-text",
    }] });
    const first = captureRequest(store, firstFixture);
    await firstStarted;
    const queued = makeStoreCaptureV2({
      attemptId: "attempt-2", snapshotId: "snapshot-2", manifestRevision: "manifest-2", receiptId: "receipt-2",
      rows: [{
        representationKey: "queued-text", itemIndex: 0, contentKind: "text",
        bytes: new TextEncoder().encode("bytes copied synchronously before await"),
        formatId: "public.utf8-plain-text", nativeName: "public.utf8-plain-text",
      }],
    });
    const expected = Array.from(queued.rows[0]!.bytes);
    const second = captureRequest(store, queued);
    const queuedInput = queued.capture.representations[0];
    if (queuedInput?.state !== "captured") throw new Error("Expected queued bytes");
    queuedInput.bytes.fill(0x58);
    releaseFirstScan();
    await Promise.all([first, second]);
    const loaded = await store.readSnapshot("snapshot-2", "manifest-2");
    expect(Array.from(loaded!.representations[0]!.bytes)).toEqual(expected);
  });

  it("waits for accepted queued work on close and rejects new calls", async () => {
    const directory = join(await newSandbox(), "store");
    let announceScan!: () => void;
    let releaseScan!: () => void;
    const scanStarted = new Promise<void>((resolveScan) => { announceScan = resolveScan; });
    const scanRelease = new Promise<void>((resolveScan) => { releaseScan = resolveScan; });
    const store = await openStore(directory, { scan: async (request) => {
      announceScan();
      await scanRelease;
      return request.requiredScopes.map((scope) => ({ scope, status: "passed" as const }));
    } });
    const fixture = makeStoreCaptureV2({ rows: [{
      representationKey: "closing-text", itemIndex: 0, contentKind: "text",
      bytes: new TextEncoder().encode("finish before close resolves"), formatId: "public.utf8-plain-text",
      nativeName: "public.utf8-plain-text",
    }] });
    const pending = captureRequest(store, fixture);
    await scanStarted;
    let closed = false;
    const closing = closeStore(store).then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    await expect(store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 1 }))
      .rejects.toMatchObject({ code: "closed" });
    releaseScan();
    expect((await pending).status).toBe("committed");
    await closing;
    expect(closed).toBe(true);
  });

});
