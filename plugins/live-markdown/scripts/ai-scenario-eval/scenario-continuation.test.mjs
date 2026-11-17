import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { assessCompletedRunEvidence, assessPreflightStopForResume } from "./scenario-continuation.mjs";

const ids = [
  ...Array.from({ length: 40 }, (_, index) => `L${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 24 }, (_, index) => `B${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 16 }, (_, index) => `G${String(index + 1).padStart(2, "0")}`),
  "H03-table-entity-unit-01", "H08-proofread-crlf-inline-01", "H08-proofread-lf-emoji-02",
  "H11-long-duplicate-paragraph-slots-01", "H14-source-bound-no-brand-01", "H16-continue-no-invented-date-01", "H04-mermaid-real-preview-01"
];

function evidence() {
  const records = [...ids].sort().map((id, index) => ({ id, calls: index < 82 ? [{ error: null, raw: "model response" }] : [] }));
  const report = {
    status: "failed", expectedTotal: 87, executedTotal: 87, cases: ids.map(id => ({ id })), notRunIds: [],
    source: { snapshotStableAfter: true }, toolSnapshot: { stableAfter: true }, cleanup: { errors: [] }, error: null
  };
  return { report, records, expectedCaseIds: ids, exitCode: 1, expectedResponses: 82 };
}

describe("first-group continuation attestation", () => {
  it("accepts all 87 uniquely present records independent of filesystem order and preserves failed evaluation status", () => {
    expect(assessCompletedRunEvidence(evidence())).toMatchObject({
      status: "execution-complete", reportStatus: "failed", runnerExitCode: 1,
      expectedCases: 87, actualRecordCount: 87, uniqueRecordCount: 87, reportedCaseCount: 87,
      successfulResponses: 82, cleanupErrors: [], sourceSnapshotStable: true, toolSnapshotStable: true
    });
  });

  it("rejects a missing or duplicate record, a report order change, unstable cleanup, or response-count drift", () => {
    const missing = evidence();
    missing.records.pop();
    expect(assessCompletedRunEvidence(missing).status).toBe("incomplete");

    const duplicate = evidence();
    duplicate.records[1].id = duplicate.records[0].id;
    expect(assessCompletedRunEvidence(duplicate).reason).toBe("case-record-set-or-order-mismatch");

    const reorderedReport = evidence();
    reorderedReport.report.cases.reverse();
    expect(assessCompletedRunEvidence(reorderedReport).reason).toBe("case-record-set-or-order-mismatch");

    const unclean = evidence();
    unclean.report.cleanup.errors = ["service cleanup failed"];
    expect(assessCompletedRunEvidence(unclean).status).toBe("incomplete");

    const wrongResponses = evidence();
    wrongResponses.records[0].calls = [];
    expect(assessCompletedRunEvidence(wrongResponses).reason).toBe("model-response-count-mismatch");
  });
});

function stoppedContinuation() {
  const parentStopHeadSha256 = "a".repeat(64);
  const expectedAttemptManifestSha256 = "b".repeat(64);
  const controlledReport = {
    runId: "common-b9-light-r1", expectedTotal: 16, actualTotal: 16, notRunIds: [],
    model: { newModelCalls: 0 }, network: { used: false, fetchAttempts: 0 }, cases: Array.from({ length: 16 }, (_, index) => ({ id: `E${String(index + 1).padStart(2, "0")}` }))
  };
  const controlledAssessment = {
    status: "controlled-safety-passed", strictOracle: { modelCalls: 0 },
    supplementalSafety: { status: "controlled-safety-passed", modelCalls: 0, networkUsed: false, supplementalSafeIds: ["E15", "E16"] }
  };
  const summary = {
    schemaVersion: 1, type: "continuation-ledger", status: "infrastructure-invalid", candidateId: "B9",
    attemptManifestSha256: expectedAttemptManifestSha256, parentStopHeadSha256,
    reconciledFirstGroup: { runId: "common-b9-balanced-r1", reconciliationSha256: "c".repeat(64) },
    completedGroups: [{ runId: "common-b9-light-r1", profile: "light",
      controlled: { status: "controlled-safety-passed", supplement: { modelCalls: 0, networkUsed: false } },
      real: { status: "infrastructure-invalid", reason: "loopback-listen-EPERM", preflight: { ok: false, code: "EPERM" } }
    }]
  };
  const data = [
    { attemptManifestSha256: expectedAttemptManifestSha256, parentStopHeadSha256, reconciliationSha256: "c".repeat(64) },
    { runId: "common-b9-balanced-r1", reconciledCompletionStatus: "execution-complete" },
    { runId: "common-b9-light-r1", realDenominator: 87, controlledDenominator: 16 },
    { runId: "common-b9-light-r1", assessment: { status: "controlled-safety-passed", supplement: { modelCalls: 0, networkUsed: false } }, reportSha256: "d".repeat(64) },
    { runId: "common-b9-light-r1", ok: false, code: "EPERM" },
    { status: "infrastructure-invalid" }
  ];
  const events = [];
  let previousHash = parentStopHeadSha256;
  for (const [index, type] of ["continuation-started", "first-group-reconciled", "group-started", "controlled-finished", "loopback-preflight", "continuation-stopped"].entries()) {
    const body = { sequence: index + 1, at: "2026-10-23T00:00:00.000Z", type, data: data[index], previousHash };
    const eventHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
    events.push({ ...body, eventHash });
    previousHash = eventHash;
  }
  summary.eventCount = events.length;
  summary.eventHeadSha256 = previousHash;
  return { expectedAttemptManifestSha256, summary, eventsBytes: Buffer.from(`${events.map(event => JSON.stringify(event)).join("\n")}\n`), controlledReport, controlledAssessment };
}

describe("preflight-only continuation resume gate", () => {
  it("allows resuming only after a verified no-model EPERM preflight stop", () => {
    const stopped = stoppedContinuation();
    expect(assessPreflightStopForResume({ ...stopped, expectedRunId: "common-b9-light-r1" })).toMatchObject({
      resumable: true, reason: null, priorEventCount: 6, parentStopHeadSha256: "a".repeat(64)
    });
  });

  it("rejects model-started, other failures, altered manifests, and missing controlled evidence", () => {
    const withModelStart = stoppedContinuation();
    withModelStart.eventsBytes = Buffer.from(withModelStart.eventsBytes.toString("utf8").replace('"type":"loopback-preflight"', '"type":"real-started"'));
    expect(() => assessPreflightStopForResume({ ...withModelStart, expectedRunId: "common-b9-light-r1" })).toThrow();

    const wrongManifest = stoppedContinuation();
    expect(assessPreflightStopForResume({ ...wrongManifest, expectedRunId: "common-b9-light-r1", expectedAttemptManifestSha256: "e".repeat(64) }).resumable).toBe(false);

    const changedFailure = stoppedContinuation();
    changedFailure.summary.completedGroups[0].real.reason = "runner-timeout";
    expect(assessPreflightStopForResume({ ...changedFailure, expectedRunId: "common-b9-light-r1" }).resumable).toBe(false);

    const missingEvidence = stoppedContinuation();
    missingEvidence.controlledReport.model.newModelCalls = 1;
    expect(assessPreflightStopForResume({ ...missingEvidence, expectedRunId: "common-b9-light-r1" }).resumable).toBe(false);
  });
});
