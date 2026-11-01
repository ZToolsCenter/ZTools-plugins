import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from "../src/index";
import { manifestKeyV2, rawRecordKeyV2, receiptKeyV2, referenceKeyV2 } from "../src/journal-records";
import { makeManifestFromReceiptV2, makeStoreCaptureV2 } from "./store-fixtures";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const artifactRoot = fileURLToPath(new URL("../../../artifacts/pasteboardpro/clipboard-format-g0/", import.meta.url));
const corruptCommittedMetadata = `
  import { createRequire } from 'node:module';
  const require = createRequire(process.argv[1]);
  const { open, TransactionFlags } = require('lmdb');
  const db = open(process.argv[2], {encoding:'string',keyEncoding:'ordered-binary',cache:false});
  db.transactionSync(() => {
    if (process.argv[4] === 'delete') db.removeSync(process.argv[3]);
    else db.putSync(process.argv[3], '{}');
  }, TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
  await db.close();
`;

describe("service replay revalidates all committed metadata", () => {
  for (const target of ["manifest", "receipt", "raw", "reference"] as const) {
    for (const damage of ["delete", "corrupt"] as const) {
      it(`rejects a duplicate after ${damage} of ${target}, even when its object still exists`, async () => {
        const directory = await mkdtemp(path.join(artifactRoot, "v020-replay-integrity-"));
        const fixture = makeStoreCaptureV2({ contentRulesEnabled: false, rows: [{
          representationKey: "synthetic-text", itemIndex: 0, contentKind: "text",
          bytes: new TextEncoder().encode("synthetic replay integrity payload"),
          formatId: "public.utf8-plain-text", nativeName: "public.utf8-plain-text",
        }] });
        const store = await openSnapshotStoreV2({ directory, policy: new PolicyCommitAuthorityV2("policy-1"),
          scan: async () => { throw new Error("disabled fixture rules must not scan"); } });
        try {
          const request = { capture: fixture.capture,
            manifest: (receipt: Parameters<typeof makeManifestFromReceiptV2>[1]) =>
              makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch), expectedManifestRevision: null };
          expect(await store.captureAndCommit(request)).toMatchObject({ status: "committed", replayed: false });
          const { snapshotId, manifestRevision, receiptId } = fixture.capture;
          const key = target === "manifest" ? manifestKeyV2(snapshotId, manifestRevision) :
            target === "receipt" ? receiptKeyV2(receiptId) :
            target === "raw" ? rawRecordKeyV2(snapshotId, manifestRevision) :
            referenceKeyV2(snapshotId, manifestRevision, "synthetic-text");
          // A separate process changes the real DB while this owner is idle. Do
          // not open another LMDB environment for the same files in this process.
          const child = spawnSync(process.execPath, ["--input-type=module", "--eval", corruptCommittedMetadata,
            path.join(packageRoot, "package.json"), path.join(directory, "journal"), key, damage], {
            env: { ...process.env }, timeout: 5000, maxBuffer: 16 * 1024, encoding: "utf8",
          });
          expect(child.error).toBeUndefined(); expect(child.signal).toBeNull();
          expect(child.status, child.stderr).toBe(0); expect(child.stdout).toBe("");
          await expect(store.captureAndCommit(request)).rejects.toMatchObject({ code: "storage-corrupt" });
        } finally {
          await store.close();
          await rm(directory, { recursive: true, force: true });
        }
      });
    }
  }
});
