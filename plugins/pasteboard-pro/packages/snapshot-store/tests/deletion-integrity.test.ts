import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { open as openLmdb, TransactionFlags } from "lmdb";

import { openBlobStoreV2 } from "../src/blob-store.js";
import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from "../src/index.js";
import { canonicalJsonV2, tupleKeyV2 } from "../src/journal-validation.js";
import { eventKeyV2, outboxKeyV2 } from "../src/journal-records.js";
import { makeManifestFromReceiptV2, makeStoreCaptureV2 } from "./store-fixtures.js";
import { newStoreDirectory, openConsumerJournal } from "./helperconsumer-fixtures.js";
import type { SnapshotStoreV2 } from "../src/snapshot-store.js";
import type { JournalBackendV2 } from "../src/types.js";

const activeStores = new Set<SnapshotStoreV2>();
const activeJournals = new Set<JournalBackendV2>();

afterEach(async () => {
  for (const store of [...activeStores]) {
    activeStores.delete(store);
    await store.close().catch(() => undefined);
  }
  for (const journal of [...activeJournals]) {
    activeJournals.delete(journal);
    await journal.close().catch(() => undefined);
  }
});

async function openRawDatabase(directory: string) {
  return openLmdb<string, string>(directory, {
    encoding: "string", keyEncoding: "ordered-binary", cache: false,
    compression: false, useWritemap: false, overlappingSync: false,
    noSync: false, noMetaSync: false, noMemInit: false,
  });
}

async function mutateDatabase(directory: string, mutate: (db: Awaited<ReturnType<typeof openRawDatabase>>) => void) {
  const db = await openRawDatabase(directory);
  try { db.transactionSync(() => mutate(db), TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT); }
  finally { await db.close(); }
}

async function makeDeletedStore(prefix: string) {
  const directory = await newStoreDirectory(prefix);
  const store = await openSnapshotStoreV2({
    directory,
    policy: new PolicyCommitAuthorityV2("policy-1"),
    scan: async (request) => request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })),
  });
  activeStores.add(store);
  const fixture = makeStoreCaptureV2({
    attemptId: "integrity-capture-attempt", snapshotId: "integrity-snapshot",
    manifestRevision: "integrity-manifest", receiptId: "integrity-capture-receipt",
    contentRulesEnabled: false,
    rows: [{
      representationKey: "integrity-text", itemIndex: 0, contentKind: "text",
      bytes: new TextEncoder().encode("integrity synthetic bytes"),
      formatId: "public.utf8-plain-text", nativeName: "public.utf8-plain-text",
    }],
  });
  const committed = await store.captureAndCommit({
    capture: fixture.capture,
    manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch),
    expectedManifestRevision: null,
  });
  expect(committed).toMatchObject({ status: "committed", event: { changeSeq: "1" } });
  const tombstone = {
    schemaVersion: 2 as const, hostEpoch: store.hostEpoch,
    snapshotId: "integrity-snapshot", tombstoneRevision: "integrity-tombstone",
    attemptId: "integrity-delete-attempt", previousManifestRevision: "integrity-manifest",
    reasonCode: "user-deleted" as const,
  };
  expect(await store.deleteSnapshot(tombstone)).toMatchObject({ event: { changeSeq: "2" } });
  activeStores.delete(store);
  await store.close();
  return { directory, tombstone };
}

async function putOrphan(directory: string): Promise<string> {
  const bytes = new TextEncoder().encode("orphan retained only to prove failed recovery is non-destructive");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const blobs = await openBlobStoreV2(join(directory, "objects"));
  await blobs.stage(bytes, hash);
  return join(directory, "objects", "sha256", hash.slice(0, 2), hash);
}

async function reopenTamperedStore(directory: string) {
  const store = await openSnapshotStoreV2({
    directory,
    policy: new PolicyCommitAuthorityV2("policy-1"),
    scan: async (request) => request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })),
  });
  activeStores.add(store);
  return store;
}

describe("logical deletion root and event integrity", () => {
  it.each([
    "bad-tombstone-hash",
    "wrong-tombstone-key",
    "wrong-tombstone-epoch",
    "dangling-deleted-head",
    "missing-tombstone",
    "changed-event-reference",
    "missing-attempt",
    "wrong-attempt-fingerprint",
  ] as const)("fails closed during reads, pruning, and recovery on %s", async (damage) => {
    const { directory, tombstone } = await makeDeletedStore(`delete-integrity-${damage}-`);
    const tombstoneKey = tupleKeyV2("tombstone:", [tombstone.snapshotId, tombstone.tombstoneRevision]);
    const attemptKey = `attempt:${tombstone.attemptId}`;
    const sourceEventKey = "event:00000000000000000002";
    await mutateDatabase(join(directory, "journal"), (db) => {
      if (damage === "missing-tombstone") {
        db.removeSync(tombstoneKey);
        return;
      }
      if (damage === "wrong-tombstone-key") {
        const value = db.get(tombstoneKey);
        if (typeof value !== "string") throw new Error("missing tombstone");
        db.removeSync(tombstoneKey);
        db.putSync(tupleKeyV2("tombstone:", ["wrong-snapshot", "wrong-revision"]), value);
        return;
      }
      if (damage === "dangling-deleted-head") {
        db.putSync(`deleted:${tombstone.snapshotId}`, canonicalJsonV2({
          snapshotId: tombstone.snapshotId, tombstoneRevision: "absent-tombstone",
        }));
        return;
      }
      if (damage === "missing-attempt") {
        db.removeSync(attemptKey);
        return;
      }
      if (damage === "wrong-attempt-fingerprint") {
        const value = db.get(attemptKey);
        if (typeof value !== "string") throw new Error("missing deletion attempt");
        const attempt = JSON.parse(value) as Record<string, unknown>;
        attempt.fingerprint = "0".repeat(64);
        db.putSync(attemptKey, canonicalJsonV2(attempt));
        return;
      }
      if (damage === "changed-event-reference") {
        const value = db.get(sourceEventKey);
        if (typeof value !== "string") throw new Error("missing delete event");
        const event = JSON.parse(value) as Record<string, unknown>;
        event.tombstoneRef = "tombstone:wrong-reference";
        db.putSync(sourceEventKey, canonicalJsonV2(event));
        db.putSync(`outbox:${"2".padStart(20, "0")}`, canonicalJsonV2(event));
        const attemptValue = db.get(attemptKey);
        if (typeof attemptValue !== "string") throw new Error("missing deletion attempt");
        const attempt = JSON.parse(attemptValue) as Record<string, unknown>;
        attempt.event = event;
        db.putSync(attemptKey, canonicalJsonV2(attempt));
        return;
      }
      const value = db.get(tombstoneKey);
      if (typeof value !== "string") throw new Error("missing tombstone");
      const record = JSON.parse(value) as Record<string, unknown>;
      if (damage === "bad-tombstone-hash") record.sha256 = "0".repeat(64);
      else {
        const body = JSON.parse(String(record.tombstoneJson)) as Record<string, unknown>;
        body.hostEpoch = "00000000-0000-4000-8000-000000000001";
        const bodyJson = canonicalJsonV2(body);
        record.tombstoneJson = bodyJson;
        record.sha256 = createHash("sha256").update(bodyJson).digest("hex");
      }
      db.putSync(tombstoneKey, canonicalJsonV2(record));
    });

    const journal = await openConsumerJournal(join(directory, "journal"));
    activeJournals.add(journal);
    expect(() => journal.readChanges({ hostEpoch: tombstone.hostEpoch, after: "0", limit: 10 }))
      .toThrow(expect.objectContaining({ code: "storage-corrupt" }));
    expect(() => journal.readOutbox(10))
      .toThrow(expect.objectContaining({ code: "storage-corrupt" }));
    expect(() => journal.listReferencedObjects())
      .toThrow(expect.objectContaining({ code: "storage-corrupt" }));
    expect(() => journal.pruneThrough("2"))
      .toThrow(expect.objectContaining({ code: "storage-corrupt" }));
    const corruptAttempt = damage === "missing-attempt" || damage === "wrong-attempt-fingerprint";
    if (corruptAttempt) {
      expect(() => journal.acknowledgeOutbox("2"))
        .toThrow(expect.objectContaining({ code: "storage-corrupt" }));
    }
    await journal.close();
    activeJournals.delete(journal);
    if (corruptAttempt) {
      let deleteEvent: unknown;
      let deleteOutbox: unknown;
      let retentionFloor: unknown;
      await mutateDatabase(join(directory, "journal"), (db) => {
        deleteEvent = db.get(eventKeyV2("2"));
        deleteOutbox = db.get(outboxKeyV2("2"));
        retentionFloor = db.get("meta:retentionFloor");
      });
      expect(typeof deleteEvent).toBe("string");
      expect(typeof deleteOutbox).toBe("string");
      expect(retentionFloor).toBe("1");
    }
    await expect(reopenTamperedStore(directory)).rejects.toMatchObject({ code: "storage-corrupt" });
  });

  it("does not sweep blobs when corrupt deletion roots abort store recovery", async () => {
    const { directory, tombstone } = await makeDeletedStore("delete-recovery-gc-");
    const orphanPath = await putOrphan(directory);
    const tombstoneKey = tupleKeyV2("tombstone:", [tombstone.snapshotId, tombstone.tombstoneRevision]);
    await mutateDatabase(join(directory, "journal"), (db) => {
      const value = db.get(tombstoneKey);
      if (typeof value !== "string") throw new Error("missing tombstone");
      const record = JSON.parse(value) as Record<string, unknown>;
      record.sha256 = "f".repeat(64);
      db.putSync(tombstoneKey, canonicalJsonV2(record));
    });

    await expect(reopenTamperedStore(directory)).rejects.toMatchObject({ code: "storage-corrupt" });
    await expect(fs.access(orphanPath)).resolves.toBeUndefined();
    await expect(fs.access(join(directory, "objects", "sha256"))).resolves.toBeUndefined();
  });
});
