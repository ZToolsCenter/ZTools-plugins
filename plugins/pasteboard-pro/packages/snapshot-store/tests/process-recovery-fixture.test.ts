import { renameSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";

import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from "../src/index.js";
import type { BlobFaultPointV2, JournalFaultPointV2 } from "../src/types.js";
import {
  makeManifestFromReceiptV2,
  makeProcessCrashFixtureV2,
  type ProcessCrashScenarioV2,
} from "./store-fixtures.js";

function isCrashScenario(value: string | undefined): value is ProcessCrashScenarioV2 {
  return value === "blob-published" || value === "journal-uncommitted" || value === "committed-control";
}

function signalBoundary(marker: string, scenario: ProcessCrashScenarioV2, hostEpoch: string, faultPoint: string): never {
  const temporaryMarker = `${marker}.tmp-${process.pid}`;
  writeFileSync(temporaryMarker, JSON.stringify({ scenario, hostEpoch, faultPoint }), { mode: 0o600 });
  renameSync(temporaryMarker, marker);
  const gate = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  for (;;) Atomics.wait(gate, 0, 0, 5_000);
}

const scenario = process.env["SNAPSHOT_STORE_CRASH_SCENARIO"];
const marker = process.env["SNAPSHOT_STORE_CRASH_MARKER"];
const directory = process.env["SNAPSHOT_STORE_CRASH_DIRECTORY"];

describe.skipIf(!isCrashScenario(scenario))("snapshot store process-crash fixture", () => {
  it("pauses at the requested durable boundary until the parent kills this process", async () => {
    if (!isCrashScenario(scenario) || !marker || !directory) {
      throw new Error("Missing process crash fixture environment");
    }
    let hostEpoch = "";
    const authority = new PolicyCommitAuthorityV2("policy-1");
    const store = await openSnapshotStoreV2({
      directory,
      policy: authority,
      scan: async (request) => request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })),
      faults: {
        blob: (point: BlobFaultPointV2) => {
          if (scenario === "blob-published" && point === "after-directory-sync") {
            signalBoundary(marker, scenario, hostEpoch, point);
          }
        },
        journal: (point: JournalFaultPointV2) => {
          if (scenario === "journal-uncommitted" && point === "after-event") {
            signalBoundary(marker, scenario, hostEpoch, point);
          }
        },
      },
    });
    hostEpoch = store.hostEpoch;
    const fixture = makeProcessCrashFixtureV2(scenario);
    const pending = store.captureAndCommit({
      capture: fixture.capture,
      manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch),
      expectedManifestRevision: null,
    });

    if (scenario === "committed-control") {
      const committed = await pending;
      if (committed.status !== "committed") throw new Error("Control capture did not commit");
      signalBoundary(marker, scenario, hostEpoch, "commit-returned");
    }

    await pending;
    throw new Error(`Requested process crash boundary was not reached for ${scenario}`);
  });
});
