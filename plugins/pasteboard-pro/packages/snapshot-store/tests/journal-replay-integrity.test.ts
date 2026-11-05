import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { open as openLmdb, TransactionFlags } from "lmdb";

import { openJournalBackendV2 } from "../src/journal.js";
import {
  eventKeyV2,
  manifestKeyV2,
  outboxKeyV2,
  rawRecordKeyV2,
  receiptKeyV2,
  referenceKeyV2,
} from "../src/journal-records.js";
import type { JournalBackendV2, SnapshotCommitV2 } from "../src/types.js";
import { makeCaptureFixture } from "./journal-fixtures.js";

const artifactRoot = join(process.cwd(), "packages/snapshot-store/artifacts/journal-replay-integrity");
const activeStores = new Set<JournalBackendV2>();
const directories = new Set<string>();

type Target = "receipt" | "manifest" | "raw" | "reference" | "event" | "outbox";
type Mutation = "delete" | "corrupt";

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

function expectStorageCorrupt(action: () => unknown): void {
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ code: "storage-corrupt" });
}

function targetKey(target: Target, command: SnapshotCommitV2): string {
  switch (target) {
    case "receipt": return receiptKeyV2(command.receipt.receiptId);
    case "manifest": return manifestKeyV2(
      command.manifest.snapshotId, command.manifest.manifestRevision,
    );
    case "raw": return rawRecordKeyV2(
      command.manifest.snapshotId, command.manifest.manifestRevision,
    );
    case "reference": return referenceKeyV2(
      command.manifest.snapshotId,
      command.manifest.manifestRevision,
      command.rawObjects[0]!.representationKey,
    );
    case "event": return eventKeyV2("1");
    case "outbox": return outboxKeyV2("1");
  }
}

describe("capture replay storage integrity", () => {
  it.each([
    ["receipt", "delete"], ["receipt", "corrupt"],
    ["manifest", "delete"], ["manifest", "corrupt"],
    ["raw", "delete"], ["raw", "corrupt"],
    ["reference", "delete"], ["reference", "corrupt"],
    ["event", "delete"], ["outbox", "corrupt"],
  ] as const)("rejects replay when %s is %s", async (target, mutation) => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    const command = makeCaptureFixture(store.hostEpoch);
    store.commitCapture(command, () => undefined);
    if (target === "outbox") store.pruneThrough("1");
    await closeStore(store);

    const database = await openRawDatabase(directory);
    try {
      database.transactionSync(() => {
        const key = targetKey(target, command);
        if (mutation === "delete") {
          expect(database.removeSync(key)).toBe(true);
        } else {
          database.putSync(key, "{}");
        }
      }, TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
    } finally {
      await database.close();
    }

    const reopened = await openStore(directory);
    expectStorageCorrupt(() => reopened.checkCapture(command));
    expectStorageCorrupt(() => reopened.commitCapture(command, () => undefined));
  });
});
