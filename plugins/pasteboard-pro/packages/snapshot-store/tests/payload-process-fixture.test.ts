import { createHash } from "node:crypto";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { writeAtomicMarkerSync } from "./journal-process-controls.js";
import {
  openSnapshotStoreV2, PolicyCommitAuthorityV2,
  type PayloadReclamationFaultPointV2, type SnapshotStoreV2,
} from "../src/index.js";
import { makeManifestFromReceiptV2, makeStoreCaptureV2 } from "./store-fixtures.js";

// Transparent test probe: keep the actual LMDB object and transaction arguments/return values,
// writing only a marker at the native transactionSync call boundary before forwarding.
vi.mock("lmdb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lmdb")>();
  return {
    ...actual,
    open: (...args: Parameters<typeof actual.open>) => {
      const database = actual.open(...args);
      if (process.env["PAYLOAD_PROCESS_ROLE"] !== "purger") return database;
      const originalTransactionSync = database.transactionSync.bind(database);
      Object.defineProperty(database, "transactionSync", {
        configurable: true,
        writable: true,
        value: (...transactionArgs: Parameters<typeof database.transactionSync>) => {
          const arm = process.env["PAYLOAD_PROCESS_TRANSACTION_ARM"];
          const attempt = process.env["PAYLOAD_PROCESS_TRANSACTION_ATTEMPT"];
          if (arm && attempt && existsSync(arm) && !existsSync(attempt)) {
            const electronVersion = process.versions.electron ?? null;
            writeAtomicMarkerSync(attempt, JSON.stringify({
              scenario: process.env["PAYLOAD_PROCESS_SCENARIO"], role: "purger",
              hostEpoch: process.env["PAYLOAD_PROCESS_HOST_EPOCH"],
              snapshotId: process.env["PAYLOAD_PROCESS_SNAPSHOT_ID"],
              manifestRevision: process.env["PAYLOAD_PROCESS_MANIFEST_REVISION"],
              tombstoneRevision: process.env["PAYLOAD_PROCESS_TOMBSTONE_REVISION"],
              attemptId: process.env["PAYLOAD_PROCESS_ATTEMPT_ID"],
              receiptId: process.env["PAYLOAD_PROCESS_RECEIPT_ID"],
              pid: process.pid, timestamp: new Date().toISOString(),
              runtime: { tag: electronVersion ? "electron" : "node", nodeVersion: process.versions.node, electronVersion },
              boundary: "lmdb.transactionSync-before-forward",
            }));
          }
          return originalTransactionSync(...transactionArgs);
        },
      });
      return database;
    },
  };
});

const scenario = process.env["PAYLOAD_PROCESS_SCENARIO"];
const role = process.env["PAYLOAD_PROCESS_ROLE"];
const directory = process.env["PAYLOAD_PROCESS_DIRECTORY"];
const controls = process.env["PAYLOAD_PROCESS_CONTROLS"];
const deadlineAtMs = Number(process.env["PAYLOAD_PROCESS_DEADLINE_AT_MS"]);
const expectedHostEpoch = process.env["PAYLOAD_PROCESS_HOST_EPOCH"];
const armPath = process.env["PAYLOAD_PROCESS_TRANSACTION_ARM"];
const syntheticBytes = new TextEncoder().encode("v023 synthetic payload shared by independent snapshots");
const identities = {
  "restart-recovery": { snapshotId: "v023-restart-snapshot", manifestRevision: "v023-restart-manifest", tombstoneRevision: "v023-restart-tombstone", attemptId: "v023-restart-attempt", receiptId: "v023-restart-receipt" },
  "shared-hash-race": { snapshotId: "v023-shared-a", manifestRevision: "v023-shared-a-manifest", tombstoneRevision: "v023-shared-a-tombstone", attemptId: "v023-shared-a-attempt", receiptId: "v023-shared-a-receipt" },
  "read-gc-race": { snapshotId: "v023-read-a", manifestRevision: "v023-read-a-manifest", tombstoneRevision: "v023-read-a-tombstone", attemptId: "v023-read-a-attempt", receiptId: "v023-read-a-receipt" },
} as const;
type Scenario = keyof typeof identities;
type Role = "operation" | "reader" | "purger";
type MarkerName = "boundary" | "ready" | "expire-call-started" | "operation-complete" | "read-complete" | "owned-after-gc" | "before-object-unlink";

function isScenario(value: string | undefined): value is Scenario { return value !== undefined && Object.hasOwn(identities, value); }
function isRole(value: string | undefined): value is Role { return value === "operation" || value === "reader" || value === "purger"; }
function runtime() {
  const electronVersion = process.versions.electron ?? null;
  return { tag: electronVersion ? "electron" : "node", nodeVersion: process.versions.node ?? "unknown", electronVersion } as const;
}
function writeMarker(name: MarkerName, extra: Readonly<Record<string, unknown>> = {}): void {
  if (!controls || !isScenario(scenario) || !isRole(role)) throw new Error("missing bounded payload process controls");
  const id = identities[scenario], path = join(controls, `${name}.json`), temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, JSON.stringify({ scenario, role, hostEpoch: storeHostEpoch, ...id,
    pid: process.pid, timestamp: new Date().toISOString(), runtime: runtime(), ...extra }), { flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
}
function awaitControl(name: string): void {
  if (!controls || !Number.isFinite(deadlineAtMs) || deadlineAtMs <= Date.now()) throw new Error("payload process control deadline is missing or elapsed");
  const path = join(controls, name.endsWith(".json") ? name : `${name}.json`);
  const gate = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  while (Date.now() < deadlineAtMs) {
    if (existsSync(path)) return;
    Atomics.wait(gate, 0, 0, Math.min(50, Math.max(1, deadlineAtMs - Date.now())));
  }
  throw new Error(`bounded payload process wait expired for ${name}`);
}
function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
let storeHostEpoch = "";

async function openStore(fault?: (point: PayloadReclamationFaultPointV2) => void): Promise<SnapshotStoreV2> {
  if (!directory) throw new Error("missing snapshot store directory");
  return openSnapshotStoreV2({ directory, policy: new PolicyCommitAuthorityV2("policy-1"),
    scan: async (request) => request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })),
    ...(fault ? { faults: { reclamation: fault } } : {}),
  });
}
function captureFixture(id: typeof identities[Scenario]) {
  return makeStoreCaptureV2({ attemptId: id.attemptId, snapshotId: id.snapshotId,
    manifestRevision: id.manifestRevision, receiptId: id.receiptId, contentRulesEnabled: false,
    rows: [{ representationKey: `${id.snapshotId}-text`, itemIndex: 0, contentKind: "text", bytes: syntheticBytes,
      formatId: "public.utf8-plain-text", nativeName: "public.utf8-plain-text", mime: "text/plain;charset=utf-8" }],
  });
}
async function seedDeletedPayload(target: SnapshotStoreV2, id: typeof identities[Scenario]) {
  const fixture = captureFixture(id);
  expect(await target.captureAndCommit({ capture: fixture.capture,
    manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, target.hostEpoch), expectedManifestRevision: null,
  })).toMatchObject({ status: "committed", replayed: false, event: { changeSeq: "1" } });
  const tombstone = { schemaVersion: 2 as const, hostEpoch: target.hostEpoch, snapshotId: id.snapshotId,
    tombstoneRevision: id.tombstoneRevision, attemptId: `${id.attemptId}-delete`,
    previousManifestRevision: id.manifestRevision, reasonCode: "user-deleted" as const };
  expect(await target.deleteSnapshot(tombstone)).toMatchObject({ replayed: false, event: { changeSeq: "2", eventType: "delete" } });
  await target.acknowledgeOutbox("1"); await target.acknowledgeOutbox("2"); await target.pruneThrough("2");
}

const boundaryFaults = new Set<PayloadReclamationFaultPointV2>([
  "after-expiry-commit", "before-payload-read", "before-object-unlink",
]);
describe.skipIf(!isScenario(scenario) || !isRole(role))("payload reclamation real-process fixture", () => {
  it("runs one bounded synthetic store operation at its requested process boundary", async () => {
    if (!isScenario(scenario) || !isRole(role) || !directory || !controls || deadlineAtMs <= Date.now()) {
      throw new Error("missing scenario-specific bounded fixture environment");
    }
    const id = identities[scenario];
    let target: SnapshotStoreV2 | undefined;
    try {
      target = await openStore((point) => {
        const wanted = scenario === "read-gc-race"
          ? role === "reader" ? "before-payload-read" : role === "purger" ? "before-object-unlink" : undefined
          : role === "operation" ? "after-expiry-commit" : undefined;
        if (!wanted || point !== wanted || !boundaryFaults.has(point)) return;
        const name = point === "before-object-unlink" ? "before-object-unlink" : "boundary";
        writeMarker(name, { faultPoint: point, sha256: digest(syntheticBytes) });
        if (point === "after-expiry-commit") awaitControl("resume-expiry");
        if (point === "before-payload-read") awaitControl("resume-read");
      });
      storeHostEpoch = target.hostEpoch;
      if (expectedHostEpoch && target.hostEpoch !== expectedHostEpoch) throw new Error("child store epoch mismatched parent-seeded data");
      if (scenario === "restart-recovery") await seedDeletedPayload(target, id);
      else expect(await target.getDeletedHead(id.snapshotId)).toMatchObject({ hostEpoch: target.hostEpoch,
        snapshotId: id.snapshotId, tombstoneRevision: id.tombstoneRevision, previousManifestRevision: id.manifestRevision });

      if (scenario === "read-gc-race" && role === "purger") {
        if (!armPath) throw new Error("purger lacks native transaction arm marker path");
        writeMarker("ready");
        awaitControl("start-expiry");
        writeAtomicMarkerSync(armPath, "armed");
        writeMarker("expire-call-started");
        const result = await target.expireDeletedPayload({ hostEpoch: target.hostEpoch, snapshotId: id.snapshotId,
          manifestRevision: id.manifestRevision, tombstoneRevision: id.tombstoneRevision });
        writeMarker("operation-complete", { result });
        return;
      }
      if (scenario === "read-gc-race" && role === "reader") {
        const snapshot = await target.readSnapshot(id.snapshotId, id.manifestRevision);
        if (!snapshot) throw new Error("eligible deleted manifest was not readable before expiry");
        const representation = snapshot.representations.find((entry) => entry.representationKey === `${id.snapshotId}-text`);
        if (!representation) throw new Error("synthetic payload representation is missing");
        writeMarker("read-complete", { byteLength: representation.bytes.byteLength, sha256: digest(representation.bytes) });
        awaitControl("gc-done");
        writeMarker("owned-after-gc", { byteLength: representation.bytes.byteLength, sha256: digest(representation.bytes) });
        return;
      }
      if (role !== "operation") throw new Error(`role ${role} is invalid for scenario ${scenario}`);
      const result = await target.expireDeletedPayload({ hostEpoch: target.hostEpoch, snapshotId: id.snapshotId,
        manifestRevision: id.manifestRevision, tombstoneRevision: id.tombstoneRevision });
      writeMarker("operation-complete", { result });
    } finally { if (target) await target.close(); }
  }, 42_000);
});
