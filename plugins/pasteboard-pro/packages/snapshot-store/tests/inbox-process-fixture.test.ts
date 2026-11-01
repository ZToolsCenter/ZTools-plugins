import { renameSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from "../src/index.js";
import type { ConsumerInboxFaultPointV2 } from "../src/consumer-types.js";
import { makeManifestFromReceiptV2, makeStoreCaptureV2 } from "./store-fixtures.js";

type Scenario = "stage-uncommitted" | "ack-uncommitted" | "ack-committed";
const scenario = process.env["INBOX_PROCESS_SCENARIO"];
const directory = process.env["INBOX_PROCESS_DIRECTORY"];
const marker = process.env["INBOX_PROCESS_MARKER"];
const consumerId = "inbox-crash-worker";
const stableNow = 100_000;

function isScenario(value: string | undefined): value is Scenario {
  return value === "stage-uncommitted" || value === "ack-uncommitted" || value === "ack-committed";
}

function captureFixture() {
  return makeStoreCaptureV2({
    attemptId: "inbox-process-attempt",
    snapshotId: "inbox-process-snapshot",
    manifestRevision: "inbox-process-manifest",
    receiptId: "inbox-process-receipt",
    capturedRevision: "synthetic-inbox-process-revision",
    contentRulesEnabled: false,
    rows: [{
      representationKey: "inbox-process-text",
      itemIndex: 0,
      contentKind: "text",
      bytes: new TextEncoder().encode("fixed synthetic inbox recovery bytes"),
      formatId: "public.utf8-plain-text",
      nativeName: "public.utf8-plain-text",
      mime: "text/plain;charset=utf-8",
    }],
  });
}

function pauseAtBoundary(
  scenarioValue: Scenario,
  hostEpoch: string,
  changeSeq: string,
  controlStatus: string,
  token?: string,
): never {
  if (!marker) throw new Error("Missing inbox process marker path");
  const contents = JSON.stringify({
    scenario: scenarioValue,
    hostEpoch,
    consumerId,
    changeSeq,
    ...(token ? { token } : {}),
    controlStatus,
  });
  const temporary = `${marker}.tmp-${process.pid}`;
  writeFileSync(temporary, contents, { mode: 0o600 });
  renameSync(temporary, marker);
  const waitGate = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  for (;;) Atomics.wait(waitGate, 0, 0, 5_000);
}

describe.skipIf(!isScenario(scenario))("inbox process crash fixture", () => {
  it("commits a source event, then pauses inside the requested inbox boundary", async () => {
    if (!isScenario(scenario) || !directory || !marker) {
      throw new Error("Missing inbox crash fixture environment");
    }
    let hostEpoch = "";
    let changeSeq = "";
    let leaseToken = "";
    const store = await openSnapshotStoreV2({
      directory,
      policy: new PolicyCommitAuthorityV2("policy-1"),
      scan: async () => { throw new Error("content scanner must not run with content rules disabled"); },
      consumer: {
        now: () => stableNow,
        fault: (point: ConsumerInboxFaultPointV2) => {
          if (scenario === "stage-uncommitted" && point === "before-cursor-advance") {
            pauseAtBoundary(scenario, hostEpoch, "1", "stage-row-written-before-cursor");
          }
          if (scenario === "ack-uncommitted" && point === "before-ack-cursor-advance") {
            pauseAtBoundary(scenario, hostEpoch, changeSeq, "ack-written-before-cursor", leaseToken);
          }
        },
      },
    });
    hostEpoch = store.hostEpoch;
    const fixture = captureFixture();
    const capture = await store.captureAndCommit({
      capture: fixture.capture,
      manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, hostEpoch),
      expectedManifestRevision: null,
    });
    if (capture.status !== "committed" || capture.event.changeSeq !== "1" || capture.receipt.representations.some((row) =>
      !row.retentionAllowed || row.contentScanStatus !== "not-scanned")) {
      throw new Error("Expected one committed not-scanned synthetic source event");
    }

    if (scenario === "stage-uncommitted") {
      await store.stageConsumerPage({ consumerId, hostEpoch, after: "0", limit: 1 });
      throw new Error("Stage fault boundary was not reached");
    }

    const staged = await store.stageConsumerPage({ consumerId, hostEpoch, after: "0", limit: 1 });
    if (staged.status !== "staged" || staged.stagedCount !== 1) {
      throw new Error("Expected one staged source event before lease handling");
    }
    const claim = await store.claimConsumerEvent({ consumerId, hostEpoch, leaseMs: 1_000 });
    if (claim.status !== "claimed") throw new Error(`Expected a lease, received ${claim.status}`);
    changeSeq = claim.task.event.changeSeq;
    leaseToken = claim.task.lease.token;
    const acknowledgement = await store.acknowledgeConsumerEvent({
      consumerId,
      hostEpoch,
      changeSeq,
      token: leaseToken,
    });
    if (acknowledgement.status !== "acknowledged" || acknowledgement.replayed) {
      throw new Error("Expected a newly committed acknowledgement");
    }
    if (scenario === "ack-committed") {
      pauseAtBoundary(scenario, hostEpoch, changeSeq, "ack-transaction-returned", leaseToken);
    }
    throw new Error("Acknowledgement fault boundary was not reached");
  });
});
