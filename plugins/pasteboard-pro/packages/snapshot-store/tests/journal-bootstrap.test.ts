import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { open as openLmdb, TransactionFlags } from "lmdb";

import { openJournalBackendV2 } from "../src/journal.js";
import { syncDirectoryV2 } from "../src/fs-directory.js";
import { JOURNAL_INITIALIZATION_INTENT_FILE_V2 } from "../src/journal-files.js";
import type { JournalBackendV2 } from "../src/types.js";

const artifactRoot = join(process.cwd(), "packages/snapshot-store/artifacts/journal-bootstrap");
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

async function closeStore(store: JournalBackendV2): Promise<void> {
  activeStores.delete(store);
  await store.close();
}

async function createPrivateFile(path: string, contents = Buffer.alloc(0)): Promise<void> {
  const handle = await fs.open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    if (contents.byteLength > 0) await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeIntent(directory: string, contents = Buffer.alloc(0)): Promise<void> {
  await createPrivateFile(join(directory, JOURNAL_INITIALIZATION_INTENT_FILE_V2), contents);
  await syncDirectoryV2(directory);
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

function expectCodeAsync(action: () => Promise<unknown>, code: string): Promise<void> {
  return expect(action()).rejects.toMatchObject({ code });
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

describe("journal initialization intent recovery", () => {
  it.each(["intent-only", "single-empty-file", "two-empty-files"] as const)(
    "recovers authorized bootstrap state %s",
    async (state) => {
      const directory = await makeDirectory();
      await writeIntent(directory);
      if (state === "single-empty-file" || state === "two-empty-files") {
        await createPrivateFile(join(directory, "data.mdb"));
      }
      if (state === "two-empty-files") {
        await createPrivateFile(join(directory, "lock.mdb"));
      }

      const store = await openStore(directory);
      expect(store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 }))
        .toMatchObject({ status: "ok", latestChangeSeq: "0", events: [] });
      await closeStore(store);
      await expect(fs.lstat(join(directory, JOURNAL_INITIALIZATION_INTENT_FILE_V2)))
        .rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("keeps epoch when a crash leaves intent after metadata commit", async () => {
    const directory = await makeDirectory();
    const first = await openStore(directory);
    const epoch = first.hostEpoch;
    await closeStore(first);
    await writeIntent(directory);

    const reopened = await openStore(directory);
    expect(reopened.hostEpoch).toBe(epoch);
    await closeStore(reopened);
    await expect(fs.lstat(join(directory, JOURNAL_INITIALIZATION_INTENT_FILE_V2)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects malformed intent without creating or replacing database files", async () => {
    const directory = await makeDirectory();
    await writeIntent(directory, Buffer.from("not-an-empty-intent"));

    await expectCodeAsync(() => openJournalBackendV2(directory), "storage-corrupt");
    await expect(fs.readdir(directory)).resolves.toEqual([JOURNAL_INITIALIZATION_INTENT_FILE_V2]);
  });

  it.each(["single-empty-file", "two-empty-files"] as const)(
    "does not infer bootstrap intent from %s alone",
    async (state) => {
      const directory = await makeDirectory();
      await createPrivateFile(join(directory, "data.mdb"));
      if (state === "two-empty-files") await createPrivateFile(join(directory, "lock.mdb"));
      await expectCodeAsync(() => openJournalBackendV2(directory), "storage-corrupt");
    },
  );

  it("does not reset a nonempty LMDB environment whose journal metadata is missing", async () => {
    const directory = await makeDirectory();
    const raw = await openRawDatabase(directory);
    raw.transactionSync(() => raw.putSync("unrelated:existing-data", "preserve"),
      TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
    await raw.close();

    await expectCodeAsync(() => openJournalBackendV2(directory), "storage-corrupt");
    const verify = await openRawDatabase(directory);
    expect(verify.get("unrelated:existing-data")).toBe("preserve");
    expect(verify.get("meta:hostEpoch")).toBeUndefined();
    await verify.close();
  });
});
