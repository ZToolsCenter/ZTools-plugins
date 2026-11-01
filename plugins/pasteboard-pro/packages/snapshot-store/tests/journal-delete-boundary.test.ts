import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { open as openLmdb, TransactionFlags } from "lmdb";

import { openJournalBackendV2 } from "../src/journal.js";
import { eventKeyV2, outboxKeyV2 } from "../src/journal-records.js";
import { canonicalJsonV2 } from "../src/journal-validation.js";
import type { JournalBackendV2 } from "../src/types.js";

const artifactRoot = join(process.cwd(), "packages/snapshot-store/artifacts/journal-delete-boundary");
const activeStores = new Set<JournalBackendV2>();
const directories = new Set<string>();

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

function expectStorageCorrupt(action: () => unknown): void {
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ code: "storage-corrupt" });
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

describe("unbound delete event integrity boundary", () => {
  it("rejects a forged tombstone event across read, outbox, and GC roots", async () => {
    const directory = await makeDirectory();
    const initial = await openStore(directory);
    const hostEpoch = initial.hostEpoch;
    await initial.close();
    activeStores.delete(initial);

    const database = await openRawDatabase(directory);
    try {
      const event = {
        hostEpoch,
        changeSeq: "1",
        eventType: "delete",
        snapshotId: "snapshot-deleted",
        tombstoneRevision: "tombstone-revision-1",
        tombstoneRef: "tombstone-object-not-stored",
        tombstoneSha256: "e".repeat(64),
      };
      database.transactionSync(() => {
        database.putSync("meta:headSeq", "1");
        database.putSync(eventKeyV2("1"), canonicalJsonV2(event));
        database.putSync(outboxKeyV2("1"), canonicalJsonV2(event));
      }, TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
    } finally {
      await database.close();
    }

    const store = await openStore(directory);
    expectStorageCorrupt(() => store.readChanges({ hostEpoch, after: "0", limit: 10 }));
    expectStorageCorrupt(() => store.readOutbox(10));
    expectStorageCorrupt(() => store.listReferencedObjects());
  });
});
