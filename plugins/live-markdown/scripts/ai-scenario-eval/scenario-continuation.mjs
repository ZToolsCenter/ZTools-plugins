import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assessExecutionCompletion } from "./scenario-attempt-control.mjs";
import { hasExactCaseOrder, hasExactRecordIdSet } from "./scenario-record-validation.mjs";

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));

export function verifyLedgerChain({ eventsBytes, summary, initialPreviousHash = "0".repeat(64) }) {
  const lines = eventsBytes.toString("utf8").trimEnd().split("\n").filter(Boolean);
  let previousHash = initialPreviousHash;
  for (let index = 0; index < lines.length; index += 1) {
    const event = JSON.parse(lines[index]);
    const { eventHash, ...body } = event;
    if (event.sequence !== index + 1 || event.previousHash !== previousHash || sha256(Buffer.from(JSON.stringify(body))) !== eventHash) {
      throw new Error(`Parent execution ledger chain is invalid at event ${index + 1}.`);
    }
    previousHash = eventHash;
  }
  if (!lines.length || summary.eventCount !== lines.length || summary.eventHeadSha256 !== previousHash) {
    throw new Error("Parent execution ledger head differs from its original summary.");
  }
  return { events: lines.map(line => JSON.parse(line)), headSha256: previousHash };
}

export function assessPreflightStopForResume({ eventsBytes, summary, expectedAttemptManifestSha256, expectedRunId, controlledReport, controlledAssessment }) {
  const chain = verifyLedgerChain({ eventsBytes, summary, initialPreviousHash: summary?.parentStopHeadSha256 });
  const events = chain.events;
  const expectedTypes = ["continuation-started", "first-group-reconciled", "group-started", "controlled-finished", "loopback-preflight", "continuation-stopped"];
  const first = events[0]?.data;
  const reconciled = events[1]?.data;
  const started = events[2]?.data;
  const controlled = events[3]?.data;
  const preflight = events[4]?.data;
  const stopped = events[5]?.data;
  const onlyGroup = summary?.completedGroups?.[0];
  const valid = summary?.schemaVersion === 1 && summary?.type === "continuation-ledger" &&
    summary.status === "infrastructure-invalid" && summary.candidateId === "B9" &&
    summary.attemptManifestSha256 === expectedAttemptManifestSha256 && summary.completedGroups?.length === 1 &&
    onlyGroup?.runId === expectedRunId && onlyGroup?.profile === "light" &&
    onlyGroup.controlled?.status === "controlled-safety-passed" &&
    onlyGroup.controlled?.supplement?.modelCalls === 0 && onlyGroup.controlled?.supplement?.networkUsed === false &&
    onlyGroup.real?.status === "infrastructure-invalid" && onlyGroup.real?.reason === "loopback-listen-EPERM" &&
    onlyGroup.real?.preflight?.code === "EPERM" && onlyGroup.real?.preflight?.ok === false &&
    events.length === expectedTypes.length && events.every((event, index) => event.type === expectedTypes[index]) &&
    events.filter(event => event.type === "real-started").length === 0 &&
    first?.attemptManifestSha256 === expectedAttemptManifestSha256 &&
    first?.parentStopHeadSha256 === summary.parentStopHeadSha256 &&
    first?.reconciliationSha256 === summary.reconciledFirstGroup?.reconciliationSha256 &&
    reconciled?.runId === summary.reconciledFirstGroup?.runId && reconciled?.reconciledCompletionStatus === "execution-complete" &&
    started?.runId === expectedRunId && started?.realDenominator === 87 && started?.controlledDenominator === 16 &&
    controlled?.runId === expectedRunId && controlled?.assessment?.status === "controlled-safety-passed" &&
    controlled?.assessment?.supplement?.modelCalls === 0 && controlled?.assessment?.supplement?.networkUsed === false &&
    controlled?.reportSha256 &&
    preflight?.runId === expectedRunId && preflight?.ok === false && preflight?.code === "EPERM" &&
    stopped?.status === "infrastructure-invalid" &&
    controlledReport?.runId === expectedRunId && controlledReport?.expectedTotal === 16 && controlledReport?.actualTotal === 16 &&
    controlledReport?.notRunIds?.length === 0 && controlledReport?.model?.newModelCalls === 0 &&
    controlledReport?.network?.used === false && controlledReport?.network?.fetchAttempts === 0 && controlledReport?.cases?.length === 16 &&
    controlledAssessment?.status === "controlled-safety-passed" && controlledAssessment?.strictOracle?.modelCalls === 0 &&
    controlledAssessment?.supplementalSafety?.modelCalls === 0 && controlledAssessment?.supplementalSafety?.networkUsed === false &&
    controlledAssessment?.supplementalSafety?.supplementalSafeIds?.join(",") === "E15,E16" &&
    summary.eventCount === events.length && summary.eventHeadSha256 === chain.headSha256;
  return {
    resumable: valid,
    reason: valid ? null : "prior-continuation-is-not-an-exact-preflight-only-EPERM-stop",
    priorEventCount: events.length,
    priorHeadSha256: chain.headSha256,
    parentStopHeadSha256: summary?.parentStopHeadSha256 ?? null,
    reusedControlledReportSha256: controlled?.reportSha256 ?? null
  };
}

export function assessCompletedRunEvidence({ report, records, expectedCaseIds, exitCode, expectedResponses = 82 }) {
  const recordIds = records.map(({ id }) => id);
  const reportIds = report?.cases?.map(({ id }) => id) ?? [];
  const responseCount = records.flatMap(record => record.calls ?? [])
    .filter(call => call.error == null && typeof call.raw === "string").length;
  const completion = assessExecutionCompletion({ report, records, exitCode, expectedCases: expectedCaseIds.length });
  const shapeComplete = hasExactRecordIdSet(recordIds, expectedCaseIds) && hasExactCaseOrder(reportIds, expectedCaseIds);
  const responsesMatch = responseCount === expectedResponses;
  const completed = completion.status === "execution-complete" && shapeComplete && responsesMatch &&
    report.expectedTotal === expectedCaseIds.length && report.executedTotal === expectedCaseIds.length &&
    report.notRunIds?.length === 0 && report.cleanup?.errors?.length === 0 && report.error == null &&
    report.source?.snapshotStableAfter === true && report.toolSnapshot?.stableAfter === true;
  return {
    status: completed ? "execution-complete" : "incomplete",
    reason: completed ? null : !shapeComplete ? "case-record-set-or-order-mismatch" : !responsesMatch ? "model-response-count-mismatch" : completion.reason,
    expectedCases: expectedCaseIds.length, actualRecordCount: records.length, uniqueRecordCount: new Set(recordIds).size,
    reportedCaseCount: reportIds.length, successfulResponses: responseCount, expectedResponses,
    reportStatus: report.status, runnerExitCode: exitCode ?? null, cleanupErrors: report.cleanup?.errors ?? [],
    sourceSnapshotStable: report.source?.snapshotStableAfter === true, toolSnapshotStable: report.toolSnapshot?.stableAfter === true
  };
}

export function attestFirstGroup({ pluginRoot, evaluationRoot, attempt, attemptManifestSha256, expectedCaseIds, reportPath, metricPath, logPath, recordsPath }) {
  const attemptRoot = path.join(evaluationRoot, attempt.attemptId);
  const parentSummaryPath = path.join(attemptRoot, "execution-ledger.json");
  const parentEventsPath = path.join(attemptRoot, "execution-ledger.jsonl");
  const parentSummaryBytes = fs.readFileSync(parentSummaryPath);
  const parentSummary = JSON.parse(parentSummaryBytes.toString("utf8"));
  const parentEventsBytes = fs.readFileSync(parentEventsPath);
  const parentChain = verifyLedgerChain({ eventsBytes: parentEventsBytes, summary: parentSummary });
  const expectedFirst = attempt.schedule[0];
  const onlyGroup = parentSummary.completedGroups?.[0];
  if (parentSummary.status !== "incomplete" || parentSummary.attemptManifestSha256 !== attemptManifestSha256 ||
      parentSummary.completedGroups?.length !== 1 || onlyGroup?.runId !== expectedFirst.runId || onlyGroup?.profile !== expectedFirst.profile ||
      onlyGroup?.real?.status !== "incomplete" || onlyGroup.real.statusReason !== "case-record-set-mismatch" ||
      onlyGroup.real.successfulModelResponses !== 82 || onlyGroup.real.cleanupErrors?.length !== 0 ||
      parentChain.events.filter(event => event.type === "real-started").length !== 1 ||
      parentChain.events.at(-1)?.type !== "attempt-stopped" || parentChain.events.at(-1)?.data?.status !== "incomplete") {
    throw new Error("Run03 is not the preserved single-group stop caused by the known record ordering defect.");
  }
  const controlled = onlyGroup.controlled;
  if (controlled?.status !== "controlled-safety-passed" || controlled.supplement?.supplementalSafeIds?.join(",") !== "E15,E16") {
    throw new Error("The completed first group lacks the frozen controlled safety attestation.");
  }
  const reportBytes = fs.readFileSync(reportPath);
  const metricBytes = fs.readFileSync(metricPath);
  const logBytes = fs.readFileSync(logPath);
  const report = JSON.parse(reportBytes.toString("utf8"));
  const metric = JSON.parse(metricBytes.toString("utf8"));
  if (sha256(reportBytes) !== onlyGroup.real.reportSha256 || path.relative(pluginRoot, reportPath).split(path.sep).join("/") !== onlyGroup.real.report ||
      path.relative(pluginRoot, metricPath).split(path.sep).join("/") !== onlyGroup.real.measurement ||
      path.relative(pluginRoot, logPath).split(path.sep).join("/") !== onlyGroup.real.log ||
      metric.runId !== expectedFirst.runId || metric.profile !== expectedFirst.profile || metric.exitCode !== onlyGroup.real.exitCode ||
      report.caseManifestSha256 !== attempt.inputs.caseManifestSha256 || report.source?.sourceManifestSha256 !== attempt.sourceSnapshot.manifestSha256 ||
      !metric.rssMeasurementAvailable || !Number.isFinite(metric.maxRssKiB)) {
    throw new Error("The first-group report or RSS metric no longer matches the original stop ledger.");
  }
  const records = fs.readdirSync(recordsPath).filter(name => name.endsWith(".json")).sort()
    .map(name => readJson(path.join(recordsPath, name)));
  const recordFiles = fs.readdirSync(recordsPath).filter(name => name.endsWith(".json")).sort();
  const recordHashes = Object.fromEntries(recordFiles.map(name => [name, sha256(fs.readFileSync(path.join(recordsPath, name)))]));
  const assessment = assessCompletedRunEvidence({ report, records, expectedCaseIds, exitCode: onlyGroup.real.exitCode, expectedResponses: 82 });
  if (assessment.status !== "execution-complete") throw new Error(`The completed first group cannot be reconciled: ${assessment.reason}.`);
  const parentHead = parentChain.headSha256;
  const lastEventLine = parentEventsBytes.toString("utf8").trimEnd().split("\n").at(-1);
  const reconciliation = {
    schemaVersion: 1, type: "completed-run-reconciliation", status: "execution-complete",
    attemptId: attempt.attemptId, candidateId: attempt.candidateId, runId: expectedFirst.runId,
    attemptManifestSha256, caseManifestSha256: attempt.inputs.caseManifestSha256,
    sourceManifestSha256: attempt.sourceSnapshot.manifestSha256,
    oldRunnerAssessment: onlyGroup.real, reconciledAssessment: assessment,
    rawEvaluationStatus: report.status,
    evidence: {
      report: { path: path.relative(pluginRoot, reportPath).split(path.sep).join("/"), sha256: sha256(reportBytes) },
      metric: { path: path.relative(pluginRoot, metricPath).split(path.sep).join("/"), sha256: sha256(metricBytes) },
      log: { path: path.relative(pluginRoot, logPath).split(path.sep).join("/"), sha256: sha256(logBytes) },
      records: { path: path.relative(pluginRoot, recordsPath).split(path.sep).join("/"), count: records.length,
        uniqueIds: new Set(records.map(record => record.id)).size, manifestSha256: sha256(Buffer.from(JSON.stringify(recordHashes))),
        successfulResponses: assessment.successfulResponses },
      parentLedger: { summaryPath: path.relative(pluginRoot, parentSummaryPath).split(path.sep).join("/"), summarySha256: sha256(parentSummaryBytes),
        eventsPath: path.relative(pluginRoot, parentEventsPath).split(path.sep).join("/"), eventsSha256: sha256(parentEventsBytes),
        stopHeadSha256: parentHead, stopRecordSha256: sha256(Buffer.from(`${lastEventLine}\n`)) }
    },
    interpretation: "The historical ledger and report remain unchanged. The report's evaluation status remains failed; this sidecar corrects only the harness completion classification after validating the exact 87-record set, manifest order, 82 model responses, stable snapshots, and clean child cleanup."
  };
  return { reconciliation, parentSummary, parentSummaryBytes, parentEventsBytes, parentHeadSha256: parentHead, records };
}

export function openContinuationLedger({ eventsPath, manifestSha256, parentHeadSha256, parentLedgerSha256, reconciliationSha256 }) {
  const fd = fs.openSync(eventsPath, "wx");
  let sequence = 0;
  let previousHash = parentHeadSha256;
  const append = (type, data = {}) => {
    const body = { sequence: ++sequence, at: new Date().toISOString(), type, data, previousHash };
    const eventHash = sha256(Buffer.from(JSON.stringify(body)));
    fs.writeSync(fd, `${JSON.stringify({ ...body, eventHash })}\n`);
    fs.fsyncSync(fd);
    previousHash = eventHash;
  };
  append("continuation-started", { attemptManifestSha256: manifestSha256, parentLedgerSha256, parentStopHeadSha256: parentHeadSha256, reconciliationSha256 });
  return { fd, append, finalHash: () => previousHash, count: () => sequence };
}
