import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openJournalBackendV2 } from "../src/journal.js";
import type { JournalBackendV2 } from "../src/types.js";
import { makeCaptureFixture } from "./journal-fixtures.js";

const artifactRoot = join(process.cwd(), "packages/snapshot-store/artifacts/journal-check-capture");
const activeStores = new Set<JournalBackendV2>();
const directories = new Set<string>();

async function openStore(): Promise<JournalBackendV2> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(join(artifactRoot, "run-"));
  directories.add(directory);
  const store = await openJournalBackendV2(directory);
  activeStores.add(store);
  return store;
}

afterEach(async () => {
  for (const store of [...activeStores]) {
    activeStores.delete(store);
    await store.close();
  }
  for (const directory of [...directories]) {
    directories.delete(directory);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe("journal checkCapture preflight", () => {
  it("rejects stale CAS before returning a stageable capture", async () => {
    const store = await openStore();
    const first = makeCaptureFixture(store.hostEpoch);
    store.commitCapture(first, () => undefined);

    const stale = makeCaptureFixture(store.hostEpoch, {
      attemptId: "attempt-stale-cas",
      receiptId: "receipt-stale-cas",
      snapshotId: "snapshot-1",
      manifestRevision: "revision-2",
      expectedManifestRevision: null,
    });
    let caught: unknown;
    try { store.checkCapture(stale); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: "conflict" });

    const nextRevision = { ...stale, expectedManifestRevision: "revision-1" };
    expect(store.checkCapture(nextRevision)).toBeUndefined();
    expect(store.checkCapture(first)).toMatchObject({ replayed: true });
    expect(store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "ok", latestChangeSeq: "1" });
    expect(store.getReceipt("receipt-stale-cas")).toBeUndefined();
  });

  it("replays an intact capture after its event was pruned or its outbox acknowledged", async () => {
    const store = await openStore();
    const command = makeCaptureFixture(store.hostEpoch);
    const original = store.commitCapture(command, () => undefined);
    store.pruneThrough("1");

    expect(store.checkCapture(command)).toEqual({ event: original.event, replayed: true });
    expect(store.acknowledgeOutbox("1")).toBeUndefined();
    expect(store.checkCapture(command)).toEqual({ event: original.event, replayed: true });
    expect(store.commitCapture(command, () => { throw new Error("replay must not run guard"); }))
      .toEqual({ event: original.event, replayed: true });
  });

  it("rejects capture attempts already recorded as outcomes", async () => {
    const store = await openStore();
    const outcome = store.recordOutcome("attempt-outcome", "policy-denied");
    const capture = makeCaptureFixture(store.hostEpoch, {
      attemptId: "attempt-outcome",
      receiptId: "receipt-outcome-reuse",
      snapshotId: "snapshot-outcome-reuse",
    });

    let caught: unknown;
    try { store.checkCapture(capture); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: "conflict" });
    expect(store.getHead("snapshot-outcome-reuse")).toBeUndefined();
    expect(store.getReceipt("receipt-outcome-reuse")).toBeUndefined();
    expect(store.readOutbox(10)).toEqual([outcome.event]);
    expect(store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "ok", latestChangeSeq: "1" });
  });
});
