import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { ContentPolicyScanRequestV2 } from "@pasteboard-pro/core";
import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from "../src/index.js";
import type { BlobFaultPointV2 } from "../src/types.js";
import { makeManifestFromReceiptV2, makeStoreCaptureV2, type StoreCaptureFixtureV2 } from "./store-fixtures.js";

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

async function openStore(
  directory: string,
  authority: PolicyCommitAuthorityV2,
  scan: (request: ContentPolicyScanRequestV2) => Promise<readonly { scope: "text" | "links" | "ocr" | "image-metadata" | "file-reference-metadata" | "file-body"; status: "passed" | "blocked" | "not-scanned" }[]>,
  blobFault?: (point: BlobFaultPointV2) => void,
) {
  const store = await openSnapshotStoreV2({
    directory,
    policy: authority,
    scan,
    ...(blobFault ? { faults: { blob: blobFault } } : {}),
  });
  activeStores.add(store);
  return store;
}

async function newStoreDirectory(): Promise<string> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const sandbox = await fs.mkdtemp(join(artifactRoot, "policy-run-"));
  sandboxes.add(sandbox);
  return join(sandbox, "store");
}

function commitFixture(
  store: Awaited<ReturnType<typeof openSnapshotStoreV2>>,
  fixture: StoreCaptureFixtureV2,
) {
  return store.captureAndCommit({
    capture: fixture.capture,
    manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch),
    expectedManifestRevision: null,
  });
}

describe("PolicyCommitAuthorityV2 store ordering", () => {
  it("revokes a capture when policy activation completes during scanning", async () => {
    const authority = new PolicyCommitAuthorityV2("policy-1");
    let announceScan!: () => void;
    let releaseScan!: () => void;
    const scanStarted = new Promise<void>((resolveScan) => { announceScan = resolveScan; });
    const scanRelease = new Promise<void>((resolveScan) => { releaseScan = resolveScan; });
    const staged: BlobFaultPointV2[] = [];
    const store = await openStore(
      await newStoreDirectory(),
      authority,
      async (request) => {
        announceScan();
        await scanRelease;
        return request.requiredScopes.map((scope) => ({ scope, status: "passed" as const }));
      },
      (point) => { staged.push(point); },
    );
    const fixture = makeStoreCaptureV2({ rows: [{
      representationKey: "revoked-text", itemIndex: 0, contentKind: "text",
      bytes: new TextEncoder().encode("must remain uncommitted after policy activation"),
      formatId: "public.utf8-plain-text", nativeName: "public.utf8-plain-text",
    }] });
    const pending = commitFixture(store, fixture);
    await scanStarted;
    await authority.activate("policy-2");
    releaseScan();

    const result = await pending;
    expect(result).toMatchObject({
      status: "rejected",
      result: { status: "policy-changed" },
      outcome: { eventType: "outcome" },
    });
    expect(staged).toEqual([]);
    expect(await store.readSnapshot("snapshot-1", "manifest-1")).toBeUndefined();
  });

  it("serializes activation behind a commit already inside the policy authority", async () => {
    const authority = new PolicyCommitAuthorityV2("policy-1");
    let activation: Promise<void> | undefined;
    let activatedDuringStage = false;
    const store = await openStore(
      await newStoreDirectory(),
      authority,
      async (request) => request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })),
      (point) => {
        if (!activatedDuringStage && point === "after-write") {
          activatedDuringStage = true;
          activation = authority.activate("policy-2");
        }
      },
    );
    const first = makeStoreCaptureV2({ rows: [{
      representationKey: "ordered-text", itemIndex: 0, contentKind: "text",
      bytes: new TextEncoder().encode("commit linearizes before policy activation"),
      formatId: "public.utf8-plain-text", nativeName: "public.utf8-plain-text",
    }] });

    const committed = await commitFixture(store, first);
    expect(committed).toMatchObject({ status: "committed", receipt: { policyRevision: "policy-1" } });
    await activation;
    expect(authority.currentRevision()).toBe("policy-2");

    const next = makeStoreCaptureV2({
      attemptId: "attempt-2", snapshotId: "snapshot-2", manifestRevision: "manifest-2", receiptId: "receipt-2",
      policyRevision: "policy-2",
      rows: [{
        representationKey: "ordered-text-2", itemIndex: 0, contentKind: "text",
        bytes: new TextEncoder().encode("next capture uses the activated policy"),
        formatId: "public.utf8-plain-text", nativeName: "public.utf8-plain-text",
      }],
    });
    expect(await commitFixture(store, next)).toMatchObject({
      status: "committed", receipt: { policyRevision: "policy-2" }, event: { changeSeq: "2" },
    });
  });
});
