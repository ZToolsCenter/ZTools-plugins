import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { open as openLmdb, TransactionFlags } from "lmdb";
import { describe, expect, it } from "vitest";
import { openSnapshotStoreV2, PolicyCommitAuthorityV2, type SnapshotStoreV2 } from "../src/index";
import { digestV2, makeManifestFromReceiptV2, makeStoreCaptureV2 } from "./store-fixtures";

const artifacts = fileURLToPath(new URL("../../../artifacts/pasteboardpro/clipboard-format-g0/", import.meta.url));
const fixture = makeStoreCaptureV2({ contentRulesEnabled: false, rows: [{
  representationKey: "synthetic-gc-text", itemIndex: 0, contentKind: "text",
  bytes: new TextEncoder().encode("synthetic committed content must survive incomplete metadata"),
  formatId: "public.utf8-plain-text", nativeName: "public.utf8-plain-text",
}] });
const options = (directory: string) => ({ directory, policy: new PolicyCommitAuthorityV2("policy-1"),
  scan: async () => { throw new Error("this fixed fixture disables content rules"); } });

describe("recovery preserves objects referenced by incomplete committed metadata", () => {
  for (const soleRoot of ["manifest:", "receipt:", "head:", "event:", "outbox:", "attempt:"]) {
    it(`fails closed before orphan cleanup when only ${soleRoot} remains`, async () => {
      const directory = await mkdtemp(path.join(artifacts, "v020-gc-integrity-"));
      let store: SnapshotStoreV2 | undefined;
      try {
        store = await openSnapshotStoreV2(options(directory));
        const committed = await store.captureAndCommit({ capture: fixture.capture,
          manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store!.hostEpoch), expectedManifestRevision: null });
        expect(committed.status).toBe("committed");
        // Put the event behind retention before testing roots other than event;
        // lack of that row is then legitimate rather than a missing-page error.
        if (soleRoot !== "event:") await store.pruneThrough("1");
        if (soleRoot !== "outbox:") await store.acknowledgeOutbox("1");
        await store.close(); store = undefined;

        const db = openLmdb<string, string>(path.join(directory, "journal"), {
          encoding: "string", keyEncoding: "ordered-binary", cache: false,
        });
        try {
          const keys = [...db.getKeys()];
          db.transactionSync(() => {
            for (const key of keys) if (!key.startsWith("meta:") && !key.startsWith(soleRoot)) db.removeSync(key);
          }, TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
        } finally { await db.close(); }
        const sha256 = digestV2(fixture.rows[0]!.bytes);
        const objectPath = path.join(directory, "objects/sha256", sha256.slice(0, 2), sha256);
        expect(Array.from(await readFile(objectPath))).toEqual(Array.from(fixture.rows[0]!.bytes));
        let caught: unknown;
        try { store = await openSnapshotStoreV2(options(directory)); } catch (error) { caught = error; }
        // Assert bytes first so an unsafe recovery cannot hide deletion behind
        // the expected metadata error, nor succeed and silently discard a root.
        expect(Array.from(await readFile(objectPath))).toEqual(Array.from(fixture.rows[0]!.bytes));
        expect(caught).toMatchObject({ code: "storage-corrupt" });
      } finally {
        await store?.close();
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});
