import * as fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { open as openLmdb, TransactionFlags } from "lmdb";

import { openJournalBackendV2 } from "../src/journal.js";
import type { JournalBackendV2, JournalFaultPointV2 } from "../src/types.js";
import { makeCaptureFixture, makeFileReferenceFixture } from "./journal-fixtures.js";
import {
  cleanupJournalChildren,
  runJournalWriterContentionScenario,
} from "./journal-process-controls.js";

const artifactRoot = join(process.cwd(), "packages/snapshot-store/artifacts/journal-tests");
const activeStores = new Set<JournalBackendV2>();
const testDirectories = new Set<string>();
const maxSequence = "18446744073709551615";

async function makeDirectory(): Promise<string> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(join(artifactRoot, "run-"));
  testDirectories.add(directory);
  return directory;
}

async function openStore(
  directory: string,
  options?: { fault?: (point: JournalFaultPointV2) => void },
): Promise<JournalBackendV2> {
  const store = await openJournalBackendV2(directory, options);
  activeStores.add(store);
  return store;
}

async function closeStore(store: JournalBackendV2): Promise<void> {
  activeStores.delete(store);
  await store.close();
}

async function afterEachCleanup(): Promise<void> {
  await cleanupJournalChildren();
  for (const store of [...activeStores]) {
    activeStores.delete(store);
    await store.close().catch(() => undefined);
  }
  for (const directory of [...testDirectories]) {
    testDirectories.delete(directory);
    await fs.rm(directory, { recursive: true, force: true });
  }
}
afterEach(afterEachCleanup);

function expectCode(action: () => unknown, code: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code });
}

async function expectCodeAsync(action: () => Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code });
}

async function openRawDatabase(directory: string) {
  return openLmdb<string, string>(directory, {
    encoding: "string",
    keyEncoding: "ordered-binary",
    cache: false,
    compression: false,
    useWritemap: false,
    overlappingSync: false,
    noSync: false,
    noMetaSync: false,
    noMemInit: false,
  });
}

describe("openJournalBackendV2 real LMDB journal", () => {
  it("persists an exact capture, receipt, bindings, and head across restart", async () => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    const command = makeCaptureFixture(store.hostEpoch);

    const committed = store.commitCapture(command, () => undefined);
    expect(committed.replayed).toBe(false);
    expect(committed.event).toMatchObject({
      eventType: "upsert",
      changeSeq: "1",
      snapshotId: command.manifest.snapshotId,
      manifestRevision: command.manifest.manifestRevision,
    });
    expect(store.getManifest("snapshot-1", "revision-1")).toEqual(command.manifest);
    expect(store.getReceipt("receipt-1")).toEqual(command.receipt);
    expect(store.getRawObjects("snapshot-1", "revision-1")).toEqual(command.rawObjects);
    expect(store.getHead("snapshot-1")).toEqual({
      snapshotId: "snapshot-1",
      manifestRevision: "revision-1",
    });

    const returned = store.getManifest("snapshot-1", "revision-1")!;
    (returned.items[0]!.representations[0] as { formatId: string }).formatId = "caller-mutated";
    expect(store.getManifest("snapshot-1", "revision-1")!.items[0]!.representations[0]!.formatId)
      .toBe("public.utf8-plain-text");

    const epoch = store.hostEpoch;
    await closeStore(store);
    const reopened = await openStore(directory);
    expect(reopened.hostEpoch).toBe(epoch);
    expect(reopened.readChanges({ hostEpoch: epoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "ok", latestChangeSeq: "1", nextCursor: "1" });
    expect(reopened.readOutbox(10)).toHaveLength(1);
    expect(reopened.listReferencedObjects()).toEqual([command.rawObjects[0]!.blobRef]);
  });

  it.each([
    "before-manifest",
    "after-manifest",
    "after-receipt",
    "after-objects",
    "after-event",
    "before-head",
  ] as const)("rolls back every write at fault point %s without a sequence gap", async (point) => {
    const directory = await makeDirectory();
    const store = await openStore(directory, { fault: (actual) => {
      if (actual === point) throw new Error("injected failure");
    } });
    const command = makeCaptureFixture(store.hostEpoch);

    expectCode(() => store.commitCapture(command, () => undefined), "storage-failed");
    expect(store.getHead("snapshot-1")).toBeUndefined();
    expect(store.getManifest("snapshot-1", "revision-1")).toBeUndefined();
    expect(store.getReceipt("receipt-1")).toBeUndefined();
    expect(store.getRawObjects("snapshot-1", "revision-1")).toBeUndefined();
    expect(store.listReferencedObjects()).toEqual([]);
    expect(store.readOutbox(10)).toEqual([]);
    expect(store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "ok", latestChangeSeq: "0", events: [] });

    const epoch = store.hostEpoch;
    await closeStore(store);
    const reopened = await openStore(directory);
    expect(reopened.hostEpoch).toBe(epoch);
    expect(reopened.commitCapture(command, () => undefined).event.changeSeq).toBe("1");
  });

  it("binds file-reference sidecar bytes to the policy receipt", async () => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    const command = makeFileReferenceFixture(store.hostEpoch);
    expect(store.commitCapture(command, () => undefined).event.changeSeq).toBe("1");
    expect(store.getRawObjects("file-snapshot-1", "file-revision-1")).toEqual(command.rawObjects);

    const invalid = {
      ...command,
      rawObjects: command.rawObjects.map((binding) => ({
        ...binding,
        blobRef: "sha256-" + "0".repeat(64),
      })),
    };
    expectCode(() => store.commitCapture(invalid, () => undefined), "invalid-input");
  });

  it("makes attempts idempotent and enforces receipt, revision, and head conflicts", async () => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    const first = makeCaptureFixture(store.hostEpoch);

    const original = store.commitCapture(first, () => undefined);
    const replay = store.commitCapture(first, () => { throw new Error("replay must not re-run guard"); });
    expect(replay).toEqual({ event: original.event, replayed: true });
    expect(store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "ok", latestChangeSeq: "1" });

    const sameAttemptDifferentCapture = makeCaptureFixture(store.hostEpoch, {
      attemptId: "attempt-1",
      receiptId: "receipt-other",
      snapshotId: "snapshot-other",
      payload: "different clipboard bytes",
    });
    expectCode(() => store.commitCapture(sameAttemptDifferentCapture, () => undefined), "conflict");

    const sameReceipt = makeCaptureFixture(store.hostEpoch, {
      attemptId: "attempt-2",
      receiptId: "receipt-1",
      snapshotId: "snapshot-other",
    });
    expectCode(() => store.commitCapture(sameReceipt, () => undefined), "conflict");

    const staleHead = makeCaptureFixture(store.hostEpoch, {
      attemptId: "attempt-3",
      receiptId: "receipt-3",
      snapshotId: "snapshot-1",
      manifestRevision: "revision-2",
      expectedManifestRevision: null,
      payload: "revision two",
    });
    expectCode(() => store.commitCapture(staleHead, () => undefined), "conflict");

    const nextRevision = { ...staleHead, expectedManifestRevision: "revision-1" };
    expect(store.commitCapture(nextRevision, () => undefined).event.changeSeq).toBe("2");
    expect(store.getManifest("snapshot-1", "revision-1")).toEqual(first.manifest);
    expect(store.getHead("snapshot-1")?.manifestRevision).toBe("revision-2");

    const reusedRevision = makeCaptureFixture(store.hostEpoch, {
      attemptId: "attempt-4",
      receiptId: "receipt-4",
      snapshotId: "snapshot-1",
      manifestRevision: "revision-1",
      expectedManifestRevision: "revision-2",
    });
    expectCode(() => store.commitCapture(reusedRevision, () => undefined), "conflict");
  });

  it("keeps uint64 sequence precision and refuses overflow", async () => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    const epoch = store.hostEpoch;
    await closeStore(store);

    const raw = await openRawDatabase(directory);
    raw.transactionSync(() => raw.putSync("meta:headSeq", "18446744073709551614"),
      TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
    await raw.close();

    const reopened = await openStore(directory);
    const command = makeCaptureFixture(epoch);
    expect(reopened.commitCapture(command, () => undefined).event.changeSeq).toBe(maxSequence);
    expect(reopened.readChanges({
      hostEpoch: epoch,
      after: "18446744073709551614",
      limit: 1,
    })).toMatchObject({ status: "ok", nextCursor: maxSequence, latestChangeSeq: maxSequence });

    const overflow = makeCaptureFixture(epoch, {
      attemptId: "attempt-overflow",
      receiptId: "receipt-overflow",
      snapshotId: "snapshot-overflow",
    });
    expectCode(() => reopened.commitCapture(overflow, () => undefined), "over-limit");
    expect(reopened.getHead("snapshot-overflow")).toBeUndefined();
    expect(reopened.readOutbox(10)[0]?.changeSeq).toBe(maxSequence);
    expectCode(() => reopened.pruneThrough(maxSequence), "over-limit");
  });

  it("stores only redacted outcomes and keeps outbox acknowledgements durable", async () => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    const first = store.recordOutcome("attempt-redacted", "policy-denied");
    expect(first.event).toEqual({
      hostEpoch: store.hostEpoch,
      changeSeq: "1",
      eventType: "outcome",
      attemptId: "attempt-redacted",
      outcomeCode: "policy-denied",
    });
    expect(store.recordOutcome("attempt-redacted", "policy-denied"))
      .toEqual({ event: first.event, replayed: true });
    expectCode(() => store.recordOutcome("attempt-redacted", "unsupported"), "conflict");

    const second = store.commitCapture(makeCaptureFixture(store.hostEpoch, {
      attemptId: "attempt-second",
      receiptId: "receipt-second",
      snapshotId: "snapshot-second",
    }), () => undefined);
    expect(second.event.changeSeq).toBe("2");
    expect(store.readOutbox(10).map((event) => event.changeSeq)).toEqual(["1", "2"]);

    const epoch = store.hostEpoch;
    await closeStore(store);
    const reopened = await openStore(directory);
    expect(reopened.readOutbox(10).map((event) => event.changeSeq)).toEqual(["1", "2"]);
    reopened.acknowledgeOutbox("1");
    reopened.acknowledgeOutbox("1");
    expect(reopened.readOutbox(10).map((event) => event.changeSeq)).toEqual(["2"]);
    expect(reopened.readChanges({ hostEpoch: epoch, after: "0", limit: 1 }))
      .toMatchObject({ status: "ok", nextCursor: "1", latestChangeSeq: "2" });
    expect(reopened.readChanges({ hostEpoch: "other-epoch", after: "0", limit: 5 }))
      .toMatchObject({ status: "host-reset" });
    expectCode(() => reopened.readChanges({ hostEpoch: epoch, after: "3", limit: 5 }), "invalid-input");
    expectCode(() => reopened.acknowledgeOutbox("3"), "invalid-input");
  });

  it("prunes only journal events and retains all manifest and blob references", async () => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    const commands = [1, 2, 3].map((index) => makeCaptureFixture(store.hostEpoch, {
      attemptId: "attempt-" + index,
      receiptId: "receipt-" + index,
      snapshotId: "snapshot-" + index,
      payload: "payload-" + index,
    }));
    for (const command of commands) store.commitCapture(command, () => undefined);

    store.pruneThrough("2");
    expect(store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
      .toMatchObject({ status: "cursor-expired", retentionFloor: "3" });
    expect(store.readChanges({ hostEpoch: store.hostEpoch, after: "2", limit: 10 }))
      .toMatchObject({ status: "ok", nextCursor: "3", latestChangeSeq: "3" });
    expect(store.readOutbox(10).map((event) => event.changeSeq)).toEqual(["1", "2", "3"]);
    expect(store.getManifest("snapshot-1", "revision-1")).toEqual(commands[0]!.manifest);
    expect([...store.listReferencedObjects()].sort()).toEqual(
      commands.map((command) => command.rawObjects[0]!.blobRef).sort(),
    );

    store.pruneThrough("2");
    store.pruneThrough("3");
    expect(store.readChanges({ hostEpoch: store.hostEpoch, after: "2", limit: 10 }))
      .toMatchObject({ status: "cursor-expired", retentionFloor: "4" });
    expect(store.readOutbox(10)).toHaveLength(3);
  });

  it("rejects corrupt metadata and missing events without replacing the host epoch", async () => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    const epoch = store.hostEpoch;
    store.commitCapture(makeCaptureFixture(epoch), () => undefined);
    await closeStore(store);

    const raw = await openRawDatabase(directory);
    raw.transactionSync(() => {
      raw.removeSync("event:" + "1".padStart(20, "0"));
    }, TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
    await raw.close();

    const reopened = await openStore(directory);
    expect(reopened.hostEpoch).toBe(epoch);
    expectCode(() => reopened.readChanges({ hostEpoch: epoch, after: "0", limit: 10 }), "storage-corrupt");
    await closeStore(reopened);

    const damaged = await openRawDatabase(directory);
    damaged.transactionSync(() => damaged.putSync("meta:hostEpoch", "not-a-uuid"),
      TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
    await damaged.close();
    await expectCodeAsync(() => openJournalBackendV2(directory), "storage-corrupt");

    const confirm = await openRawDatabase(directory);
    expect(confirm.get("meta:hostEpoch")).toBe("not-a-uuid");
    await confirm.close();
  });

  it("uses private paths, refuses symlinks, and reserves one in-process owner", async () => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    const folderStat = await fs.stat(directory);
    expect(folderStat.mode & 0o777).toBe(0o700);
    await expectCodeAsync(() => openJournalBackendV2(directory), "conflict");

    const dataStat = await fs.stat(join(directory, "data.mdb"));
    expect(dataStat.mode & 0o077).toBe(0);
    const lockStat = await fs.stat(join(directory, "lock.mdb"));
    expect(lockStat.mode & 0o077).toBe(0);

    await closeStore(store);
    const alias = join(artifactRoot, "directory-link-" + Math.random().toString(16).slice(2));
    await fs.symlink(directory, alias, "dir");
    testDirectories.add(alias);
    await expectCodeAsync(() => openJournalBackendV2(alias), "invalid-input");

    const symlinkStore = join(artifactRoot, "database-link-" + Math.random().toString(16).slice(2));
    await fs.mkdir(symlinkStore, { mode: 0o700 });
    testDirectories.add(symlinkStore);
    const outside = join(artifactRoot, "outside-" + Math.random().toString(16).slice(2));
    await fs.writeFile(outside, "external file", { mode: 0o600 });
    await fs.symlink(outside, join(symlinkStore, "data.mdb"));
    await expectCodeAsync(() => openJournalBackendV2(symlinkStore), "storage-corrupt");
    expect(await fs.readFile(outside, "utf8")).toBe("external file");
    await fs.rm(outside, { force: true });
  });

  it("serializes two processes behind the real LMDB writer transaction", async () => {
    const directory = await makeDirectory();
    const initialized = await openStore(directory);
    const epoch = initialized.hostEpoch;
    await closeStore(initialized);

    const controls = await fs.mkdtemp(join(artifactRoot, "process-controls-"));
    testDirectories.add(controls);
    await runJournalWriterContentionScenario({
      directory,
      controlsDirectory: controls,
      holderCommand: makeCaptureFixture(epoch, {
        attemptId: "process-attempt-1",
        receiptId: "process-receipt-1",
        snapshotId: "process-snapshot-1",
      }),
      waiterCommand: makeCaptureFixture(epoch, {
        attemptId: "process-attempt-2",
        receiptId: "process-receipt-2",
        snapshotId: "process-snapshot-2",
      }),
      timingArtifactDirectory: resolve(process.cwd(), "artifacts/pasteboardpro/clipboard-format-g0/v028-consumer-tests"),
      runtime: process.versions.electron ? "electron" : "node",
    });

    const reopened = await openStore(directory);
    const changes = reopened.readChanges({ hostEpoch: epoch, after: "0", limit: 10 });
    if (changes.status !== "ok") throw new Error("expected the process writer feed page");
    expect(changes.events).toHaveLength(2);
    expect(changes.events.every((event) => event.eventType === "upsert")).toBe(true);
    const upserts = changes.events.filter((event) => event.eventType === "upsert");
    expect(upserts.map((event) => event.changeSeq)).toEqual(["1", "2"]);
    expect(upserts.map((event) => event.snapshotId)).toEqual([
      "process-snapshot-1", "process-snapshot-2",
    ]);
    expect(reopened.readOutbox(10).map((event) => event.changeSeq)).toEqual(["1", "2"]);
  }, 35_000);
});
