import { renameSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { openJournalBackendV2 } from "../src/journal.js";
import type { DeletionFaultPointV2 } from "../src/types.js";
import { makeCaptureFixture } from "./journal-fixtures.js";

type Scenario = "after-tombstone" | "after-delete-head" | "committed-delete";
const scenario = process.env["DELETE_PROCESS_SCENARIO"];
const directory = process.env["DELETE_PROCESS_DIRECTORY"];
const marker = process.env["DELETE_PROCESS_MARKER"];
const snapshotId = "delete-crash-snapshot";
const manifestRevision = "delete-crash-manifest";
const tombstoneRevision = "delete-crash-tombstone";

function isScenario(value: string | undefined): value is Scenario {
  return value === "after-tombstone" || value === "after-delete-head" || value === "committed-delete";
}

function pauseAtBoundary(
  scenarioValue: Scenario,
  hostEpoch: string,
  controlStatus: string,
): never {
  if (!marker) throw new Error("Missing deletion process marker path");
  const contents = JSON.stringify({
    scenario: scenarioValue,
    hostEpoch,
    snapshotId,
    changeSeq: "2",
    tombstoneRevision,
    controlStatus,
  });
  const temporary = `${marker}.tmp-${process.pid}`;
  writeFileSync(temporary, contents, { mode: 0o600 });
  renameSync(temporary, marker);
  const waitGate = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  for (;;) Atomics.wait(waitGate, 0, 0, 5_000);
}

describe.skipIf(!isScenario(scenario))("deletion process crash fixture", () => {
  it("commits one synthetic capture and pauses at the selected deletion boundary", async () => {
    if (!isScenario(scenario) || !directory || !marker) {
      throw new Error("Missing bounded deletion process fixture environment");
    }
    let hostEpoch = "";
    const store = await openJournalBackendV2(directory, {
      deletionFault: (point: DeletionFaultPointV2) => {
        if (scenario === "after-tombstone" && point === "after-tombstone") {
          pauseAtBoundary(scenario, hostEpoch, "tombstone-written-before-event");
        }
        if (scenario === "after-delete-head" && point === "after-delete-head") {
          pauseAtBoundary(scenario, hostEpoch, "delete-head-written-before-commit");
        }
      },
    });
    hostEpoch = store.hostEpoch;
    const capture = makeCaptureFixture(hostEpoch, {
      attemptId: "delete-crash-capture-attempt",
      receiptId: "delete-crash-capture-receipt",
      snapshotId,
      manifestRevision,
      expectedManifestRevision: null,
      payload: "fixed synthetic deletion recovery bytes",
    });
    const captured = store.commitCapture(capture, () => {});
    if (captured.replayed || captured.event.eventType !== "upsert" || captured.event.changeSeq !== "1") {
      throw new Error("Expected one newly committed synthetic source capture at sequence 1");
    }

    const deletion = store.commitDeletion({
      schemaVersion: 2,
      hostEpoch,
      snapshotId,
      tombstoneRevision,
      attemptId: "delete-crash-attempt",
      previousManifestRevision: manifestRevision,
      reasonCode: "user-deleted",
    }, () => {});
    if (scenario !== "committed-delete") throw new Error("Requested deletion fault boundary was not reached");
    if (deletion.replayed || deletion.event.eventType !== "delete" || deletion.event.changeSeq !== "2") {
      throw new Error("Expected one newly committed deletion at sequence 2");
    }
    pauseAtBoundary(scenario, hostEpoch, "delete-transaction-committed");
  }, 30_000);
});
