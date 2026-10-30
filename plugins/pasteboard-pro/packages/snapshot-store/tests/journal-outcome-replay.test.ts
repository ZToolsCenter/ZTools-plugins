import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { open as openLmdb, TransactionFlags } from "lmdb";

import { openJournalBackendV2 } from "../src/journal.js";
import { eventKeyV2, outboxKeyV2 } from "../src/journal-records.js";
import type { JournalBackendV2 } from "../src/types.js";

const artifactRoot = join(process.cwd(), "packages/snapshot-store/artifacts/journal-outcome-replay");
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

async function mutateDatabase(
  directory: string,
  key: string,
  value: string | undefined,
): Promise<void> {
  const database = await openRawDatabase(directory);
  try {
    database.transactionSync(() => {
      if (value === undefined) expect(database.removeSync(key)).toBe(true);
      else database.putSync(key, value);
    }, TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
  } finally {
    await database.close();
  }
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

describe("outcome attempt replay integrity", () => {
  it.each([
    ["event", "missing"],
    ["outbox", "corrupt"],
  ] as const)("rejects a replay with %s %s", async (target, state) => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    store.recordOutcome("attempt-outcome", "timeout");
    await closeStore(store);

    await mutateDatabase(
      directory,
      target === "event" ? eventKeyV2("1") : outboxKeyV2("1"),
      state === "missing" ? undefined : "{}",
    );
    const reopened = await openStore(directory);
    expectStorageCorrupt(() => reopened.recordOutcome("attempt-outcome", "timeout"));
  });

  it("allows replay after the event is pruned and its outbox entry acknowledged", async () => {
    const directory = await makeDirectory();
    const store = await openStore(directory);
    const first = store.recordOutcome("attempt-pruned", "timeout");
    store.pruneThrough(first.event.changeSeq);
    store.acknowledgeOutbox(first.event.changeSeq);

    expect(store.recordOutcome("attempt-pruned", "timeout")).toMatchObject({ replayed: true });
  });
});
