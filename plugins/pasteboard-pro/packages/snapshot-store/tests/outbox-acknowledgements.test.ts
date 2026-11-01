import * as fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { open as openLmdb, TransactionFlags } from "lmdb";

import { openJournalBackendV2 } from "../src/journal.js";
import { canonicalJsonV2, sha256V2 } from "../src/journal-validation.js";
import { outboxAcknowledgementKeyV2 } from "../src/outbox-acknowledgements.js";
import type { JournalBackendV2 } from "../src/types.js";

const artifactRoot = resolve("artifacts/pasteboardpro/pr-preparation/test-fixture/run-data");
const journals = new Set<JournalBackendV2>();
const directories = new Set<string>();
async function directory() {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const value = await fs.mkdtemp(join(artifactRoot, "ack-"));
  directories.add(value);
  return value;
}
async function open(directory: string, options?: Parameters<typeof openJournalBackendV2>[1]) {
  const journal = await openJournalBackendV2(directory, options);
  journals.add(journal);
  return journal;
}
async function close(journal: JournalBackendV2) {
  await journal.close(); journals.delete(journal);
}
async function mutate(directory: string, callback: (db: ReturnType<typeof openLmdb<string, string>>) => void) {
  const db = openLmdb<string, string>(directory, { encoding: "string", keyEncoding: "ordered-binary",
    cache: false, compression: false, useWritemap: false, overlappingSync: false,
    noSync: false, noMetaSync: false, noMemInit: false });
  try { db.transactionSync(() => callback(db), TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT); }
  finally { await db.close(); }
}
afterEach(async () => {
  for (const journal of journals) await journal.close();
  journals.clear();
  for (const value of directories) await fs.rm(value, { recursive: true, force: true });
  directories.clear();
});

describe("durable outbox acknowledgement and legacy migration", () => {
  it("commits a canonical ACK, replays it after prune and reopens without a pending row", async () => {
    const dir = await directory(); const journal = await open(dir);
    const committed = journal.recordOutcome("ack-attempt", "unsupported");
    expect(journal.getOutboxAcknowledgement("1")).toBeUndefined();
    journal.acknowledgeOutbox("1");
    const receipt = journal.getOutboxAcknowledgement("1");
    expect(receipt).toEqual({ schemaVersion: 2, event: committed.event,
      eventSha256: sha256V2(canonicalJsonV2(committed.event)) });
    expect(journal.readOutbox(10)).toEqual([]);
    journal.pruneThrough("1"); journal.acknowledgeOutbox("1");
    expect(journal.getOutboxAcknowledgement("1")).toEqual(receipt);
    await close(journal);
    const reopened = await open(dir);
    expect(reopened.getOutboxAcknowledgement("1")).toEqual(receipt);
    expect(reopened.listReferencedObjects()).toEqual([]);
    expect(reopened.readChanges({ hostEpoch: reopened.hostEpoch, after: "1", limit: 10 }))
      .toMatchObject({ status: "ok", latestChangeSeq: "1", events: [] });
  });

  it("rolls receipt and pending-row removal back together at the ACK fault", async () => {
    const journal = await open(await directory(), { fault: (point) => {
      if (point === "after-outbox-ack") throw new Error("synthetic ACK abort");
    } });
    journal.recordOutcome("ack-abort-attempt", "timeout");
    expect(() => journal.acknowledgeOutbox("1")).toThrowError(expect.objectContaining({ code: "storage-failed" }));
    expect(journal.getOutboxAcknowledgement("1")).toBeUndefined();
    expect(journal.readOutbox(10)).toHaveLength(1);
    expect(journal.listReferencedObjects()).toEqual([]);
  });

  it("upgrades an actual v0.22 journal without inventing ACKs for legacy missing rows", async () => {
    const dir = await directory();
    const legacyModulePath = resolve("packages/snapshot-store/tests/fixtures/legacy-v022-journal/src/journal.ts");
    const legacyModule = await import(/* @vite-ignore */ legacyModulePath);
    const legacy = await legacyModule.openJournalBackendV2(dir) as JournalBackendV2;
    journals.add(legacy);
    legacy.recordOutcome("legacy-acked", "unsupported");
    legacy.recordOutcome("legacy-pending", "timeout");
    legacy.acknowledgeOutbox("1");
    await close(legacy);
    const upgraded = await open(dir);
    expect(upgraded.getOutboxAcknowledgement("1")).toBeUndefined();
    upgraded.acknowledgeOutbox("1");
    expect(upgraded.getOutboxAcknowledgement("1")).toBeUndefined();
    upgraded.acknowledgeOutbox("2");
    expect(upgraded.getOutboxAcknowledgement("2")?.event.changeSeq).toBe("2");
    expect(upgraded.listReferencedObjects()).toEqual([]);
    await close(upgraded);
    await mutate(dir, (db) => {
      expect(db.get("meta:schema")).toBe("3");
      expect(db.get("meta:outboxAckLegacyHeadSeq")).toBe("2");
    });
    await expect(legacyModule.openJournalBackendV2(dir)).rejects.toMatchObject({ code: "storage-corrupt" });
  });

  it("rejects a missing post-upgrade pending row instead of fabricating an ACK", async () => {
    const dir = await directory(); const journal = await open(dir);
    journal.recordOutcome("lost-new-pending", "unsupported");
    await close(journal);
    await mutate(dir, (db) => { db.removeSync("outbox:00000000000000000001"); });
    const reopened = await open(dir);
    expect(() => reopened.getOutboxAcknowledgement("1")).toThrowError(expect.objectContaining({ code: "storage-corrupt" }));
    expect(() => reopened.acknowledgeOutbox("1")).toThrowError(expect.objectContaining({ code: "storage-corrupt" }));
    expect(() => reopened.listReferencedObjects()).toThrowError(expect.objectContaining({ code: "storage-corrupt" }));
    expect(() => reopened.pruneThrough("1")).toThrowError(expect.objectContaining({ code: "storage-corrupt" }));
  });

  it.each(["bad-hash", "changed-event", "pending-and-ack", "invalid-key"] as const)(
    "fails closed on a malformed ACK record: %s", async (damage) => {
      const dir = await directory(); const journal = await open(dir);
      const event = journal.recordOutcome("ack-integrity", "unsupported").event;
      journal.acknowledgeOutbox("1"); await close(journal);
      await mutate(dir, (db) => {
        const key = outboxAcknowledgementKeyV2("1");
        const record = JSON.parse(db.get(key)!) as { event: typeof event; eventSha256: string };
        if (damage === "bad-hash") record.eventSha256 = "0".repeat(64);
        if (damage === "changed-event") {
          if (record.event.eventType !== "outcome") throw new Error("unexpected fixture event");
          record.event.outcomeCode = "timeout";
          record.eventSha256 = sha256V2(canonicalJsonV2(record.event));
        }
        if (damage === "pending-and-ack") db.putSync("outbox:00000000000000000001", canonicalJsonV2(event));
        if (damage === "invalid-key") db.putSync("outbox-ack:\u{10000}", canonicalJsonV2(record));
        db.putSync(key, canonicalJsonV2(record));
      });
      const reopened = await open(dir);
      expect(() => reopened.listReferencedObjects()).toThrowError(expect.objectContaining({ code: "storage-corrupt" }));
      expect(() => reopened.pruneThrough("1")).toThrowError(expect.objectContaining({ code: "storage-corrupt" }));
    },
  );
});
