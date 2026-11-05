import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from "../src/index.js";
import type { BlobFaultPointV2, JournalFaultPointV2 } from "../src/types.js";
import { digestV2, makeManifestFromReceiptV2, makeStoreCaptureV2 } from "./store-fixtures.js";

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

async function newStoreDirectory(): Promise<string> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const sandbox = await fs.mkdtemp(join(artifactRoot, "recovery-run-"));
  sandboxes.add(sandbox);
  return join(sandbox, "store");
}

async function openStore(
  directory: string,
  options: Readonly<{
    authority?: PolicyCommitAuthorityV2;
    blobFault?: (point: BlobFaultPointV2) => void;
    journalFault?: (point: JournalFaultPointV2) => void;
  }> = {},
) {
  const store = await openSnapshotStoreV2({
    directory,
    policy: options.authority ?? new PolicyCommitAuthorityV2("policy-1"),
    scan: async (request) => request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })),
    faults: {
      ...(options.blobFault ? { blob: options.blobFault } : {}),
      ...(options.journalFault ? { journal: options.journalFault } : {}),
    },
  });
  activeStores.add(store);
  return store;
}

function captureRequest(
  store: Awaited<ReturnType<typeof openSnapshotStoreV2>>,
  fixture: ReturnType<typeof makeStoreCaptureV2>,
) {
  return store.captureAndCommit({
    capture: fixture.capture,
    manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch),
    expectedManifestRevision: null,
  });
}

function oneTextCapture(payload: string) {
  return makeStoreCaptureV2({
    contentRulesEnabled: false,
    rows: [{
      representationKey: "recovery-text",
      itemIndex: 0,
      contentKind: "text",
      bytes: new TextEncoder().encode(payload),
      formatId: "public.utf8-plain-text",
      nativeName: "public.utf8-plain-text",
    }],
  });
}

describe("snapshot store recovery and durable fault boundaries", () => {
  it.each(["after-write", "after-file-sync", "after-rename", "after-directory-sync"] as const)(
    "does not publish a ready snapshot after blob fault %s and recovery removes orphans",
    async (point) => {
      const store = await openStore(await newStoreDirectory(), {
        blobFault: (actual) => {
          if (actual === point) throw new Error("synthetic blob fault");
        },
      });
      const fixture = oneTextCapture(`blob fault ${point}`);
      await expect(captureRequest(store, fixture)).rejects.toMatchObject({ code: "storage-failed" });
      expect(await store.readSnapshot("snapshot-1", "manifest-1")).toBeUndefined();
      expect(await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
        .toMatchObject({ status: "ok", latestChangeSeq: "0", events: [] });

      const recovery = await store.recover();
      expect(recovery).toMatchObject({
        discardedStaging: 0,
        removedOrphans: ["after-rename", "after-directory-sync"].includes(point) ? 1 : 0,
      });
    },
  );

  it.each(["before-manifest", "after-manifest", "after-receipt", "after-objects", "after-event", "before-head"] as const)(
    "rolls back the full snapshot transaction at journal fault %s and can retry",
    async (point) => {
      let injected = false;
      const store = await openStore(await newStoreDirectory(), {
        journalFault: (actual) => {
          if (actual === point && !injected) {
            injected = true;
            throw new Error("synthetic journal fault");
          }
        },
      });
      const fixture = oneTextCapture(`journal fault ${point}`);
      await expect(captureRequest(store, fixture)).rejects.toMatchObject({ code: "storage-failed" });
      expect(await store.readSnapshot("snapshot-1", "manifest-1")).toBeUndefined();
      expect(await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
        .toMatchObject({ status: "ok", latestChangeSeq: "0", events: [] });
      expect(await store.recover()).toMatchObject({ discardedStaging: 0, removedOrphans: 1 });
      expect(await captureRequest(store, fixture)).toMatchObject({
        status: "committed",
        event: { changeSeq: "1" },
      });
    },
  );

  it("discards a controlled stale staging file during service recovery", async () => {
    const directory = await newStoreDirectory();
    const store = await openStore(directory);
    const stagingPath = join(directory, "objects", ".staging", `blob-${"a".repeat(32)}.tmp`);
    await fs.writeFile(stagingPath, Uint8Array.of(0x53, 0x59, 0x4e, 0x54), { mode: 0o600 });

    expect(await store.recover()).toMatchObject({ discardedStaging: 1, removedOrphans: 0 });
    expect(await fs.access(stagingPath).then(() => true, () => false)).toBe(false);
  });

  it.each(["missing", "corrupt"] as const)(
    "fails closed when a committed snapshot references a %s blob",
    async (damage) => {
      const directory = await newStoreDirectory();
      const authority = new PolicyCommitAuthorityV2("policy-1");
      const store = await openStore(directory, { authority });
      const fixture = oneTextCapture("referenced blob integrity payload");
      await captureRequest(store, fixture);
      activeStores.delete(store);
      await store.close();

      const bytes = fixture.rows[0]!.bytes;
      const sha256 = digestV2(bytes);
      const objectPath = join(directory, "objects", "sha256", sha256.slice(0, 2), sha256);
      if (damage === "missing") await fs.rm(objectPath);
      else await fs.writeFile(objectPath, Uint8Array.from(bytes, (byte, index) => index === 0 ? byte ^ 0xff : byte));
      await expect(openStore(directory, { authority })).rejects.toMatchObject({ code: "storage-corrupt" });
    },
  );

  it("rejects Windows storage before creating directories without claiming ACL verification", async () => {
    const parent = await newStoreDirectory();
    const directory = join(parent, "must-not-exist");
    const originalPlatform = process.platform;
    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
      await expect(openSnapshotStoreV2({
        directory,
        policy: new PolicyCommitAuthorityV2("policy-1"),
        scan: async () => [],
      })).rejects.toMatchObject({ code: "private-directory-unavailable" });
      expect(await fs.access(directory).then(() => true, () => false)).toBe(false);
    } finally {
      Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
    }
  });
});
