import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { open as openLmdb, TransactionFlags } from "lmdb";

import { openJournalBackendV2 } from "../src/journal.js";
import { canonicalJsonV2 } from "../src/journal-validation.js";
import {
  attemptKeyV2,
  headKeyV2,
  rawRecordKeyV2,
  referenceKeyV2,
} from "../src/journal-records.js";
import type { JournalBackendV2 } from "../src/types.js";
import { makeCaptureFixture } from "./journal-fixtures.js";

const artifactRoot = join(process.cwd(), "packages/snapshot-store/artifacts/journal-roots");
const activeStores = new Set<JournalBackendV2>();
const directories = new Set<string>();

function expectStorageCorrupt(action: () => unknown): void {
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ code: "storage-corrupt" });
}

async function makeDirectory(): Promise<string> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(join(artifactRoot, "run-"));
  directories.add(directory);
  return directory;
}

async function openStore(directory: string): Promise<JournalBackendV2> {
  const store = await openJournalBackendV2(directory);
  activeStores.add(store);
  return store;
}

async function closeStore(store: JournalBackendV2): Promise<void> {
  activeStores.delete(store);
  await store.close();
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

describe("journal roots for blob recovery", () => {
  it("returns roots only after every retained capture record is cross-checked", async () => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    const command = makeCaptureFixture(store.hostEpoch);
    store.commitCapture(command, () => undefined);

    expect(store.listReferencedObjects()).toEqual([command.rawObjects[0]!.blobRef]);
    store.pruneThrough("1");
    store.acknowledgeOutbox("1");
    expect(store.listReferencedObjects()).toEqual([command.rawObjects[0]!.blobRef]);
  });

  it("rejects roots when raw and every reference binding disappear", async () => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    const command = makeCaptureFixture(store.hostEpoch);
    store.commitCapture(command, () => undefined);
    await closeStore(store);

    const database = await openRawDatabase(directory);
    try {
      database.transactionSync(() => {
        expect(database.removeSync(rawRecordKeyV2(
          command.manifest.snapshotId, command.manifest.manifestRevision,
        ))).toBe(true);
        for (const binding of command.rawObjects) {
          expect(database.removeSync(referenceKeyV2(
            command.manifest.snapshotId,
            command.manifest.manifestRevision,
            binding.representationKey,
          ))).toBe(true);
        }
      }, TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
    } finally {
      await database.close();
    }

    const reopened = await openStore(directory);
    expectStorageCorrupt(() => reopened.listReferencedObjects());
  });

  it("requires a capture attempt even after its event and outbox are pruned", async () => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    const command = makeCaptureFixture(store.hostEpoch);
    store.commitCapture(command, () => undefined);
    store.pruneThrough("1");
    store.acknowledgeOutbox("1");
    expect(store.listReferencedObjects()).toEqual([command.rawObjects[0]!.blobRef]);
    await closeStore(store);

    const database = await openRawDatabase(directory);
    try {
      database.transactionSync(() => {
        expect(database.removeSync(headKeyV2(command.manifest.snapshotId))).toBe(true);
        expect(database.removeSync(attemptKeyV2(command.receipt.attemptId))).toBe(true);
      }, TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
    } finally {
      await database.close();
    }

    const reopened = await openStore(directory);
    expectStorageCorrupt(() => reopened.listReferencedObjects());
  });

  it("rejects a malformed supplementary-Unicode family key", async () => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    await closeStore(store);

    const database = await openRawDatabase(directory);
    try {
      database.transactionSync(() => {
        database.putSync("head:\u{10000}", canonicalJsonV2({
          snapshotId: "snapshot-1",
          manifestRevision: "revision-1",
        }));
      }, TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
    } finally {
      await database.close();
    }

    const reopened = await openStore(directory);
    expectStorageCorrupt(() => reopened.listReferencedObjects());
  });
});
