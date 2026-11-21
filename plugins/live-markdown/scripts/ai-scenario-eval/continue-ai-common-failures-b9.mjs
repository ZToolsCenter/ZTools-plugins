// Reconcile the completed first group, then run only the three untouched B9 groups.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  controlledReportPath, realReportPath, runControlled, runReal,
  selectAttempt, verifyFreezeAndAttempt
} from "./run-ai-common-failures-b8.mjs";
import { buildCandidateSourceAlias, serializeCandidateSourceAlias, verifyCandidateSourceAlias } from "./candidate-source-alias.mjs";
import { attestFirstGroup, openContinuationLedger } from "./scenario-continuation.mjs";
import { probeLoopbackListen } from "./scenario-attempt-control.mjs";
import { assertFreshOutputPath, pluginRoot } from "./scenario-v2-paths.mjs";

const root = pluginRoot;
const evaluationRoot = path.join(root, ".cache/acceptance/ai-common-failures/v1");
const attemptId = "authorized-run-03";
const attemptRoot = path.join(evaluationRoot, attemptId);
const measurementsPath = path.join(attemptRoot, "measurements");
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const relative = file => path.relative(root, file).split(path.sep).join("/");

function parseArgs(args) {
  let manifestSha256;
  const seen = new Set();
  for (const arg of args) {
    const match = /^--(attempt|candidate|manifest-sha256|execute)(?:=(.*))?$/u.exec(arg);
    if (!match || seen.has(match[1])) throw new Error(`Unexpected or duplicate argument: ${arg}`);
    seen.add(match[1]);
    if (match[1] === "attempt" && match[2] !== attemptId) throw new Error("Continuation is only defined for authorized-run-03.");
    if (match[1] === "candidate" && match[2] !== "B9") throw new Error("Continuation requires candidate B9.");
    if (match[1] === "manifest-sha256") manifestSha256 = match[2];
    if (match[1] === "execute" && match[2] !== undefined) throw new Error("Use --execute without a value.");
  }
  if (!seen.has("attempt") || !seen.has("candidate") || !seen.has("execute") || !/^[a-f0-9]{64}$/u.test(manifestSha256 ?? "")) {
    throw new Error("Usage: node scripts/ai-scenario-eval/continue-ai-common-failures-b9.mjs --attempt=authorized-run-03 --candidate=B9 --manifest-sha256=<sha256> --execute");
  }
  return { manifestSha256 };
}

function assertFreshContinuationOutputs(profiles, schedule) {
  const continuationFiles = [
    path.join(attemptRoot, "continuation-ledger.jsonl"), path.join(attemptRoot, "continuation-ledger.json"),
    path.join(attemptRoot, "reconciliations")
  ];
  for (const output of continuationFiles) assertFreshOutputPath(output, "Continuation evidence");
  for (const item of schedule.slice(1)) {
    const profile = profiles[item.profile];
    for (const output of [
      path.dirname(controlledReportPath(profile, item.runId)), path.dirname(realReportPath(profile, item.runId)),
      path.join(measurementsPath, `${item.runId}.controlled.log`),
      path.join(measurementsPath, `${item.runId}.real.log`), path.join(measurementsPath, `${item.runId}.rss.json`)
    ]) assertFreshOutputPath(output, "Unstarted B9 group output");
  }
}

function verifyControlledAlias(verified) {
  const aliasPath = path.join(attemptRoot, "controlled-source-manifest.json");
  const binding = {
    candidateId: "B9", canonicalSha256: verified.attempt.sourceSnapshot.manifestSha256,
    baseCaseManifestSha256: verified.sourceManifest.caseManifestSha256,
    derivedCaseManifestSha256: verified.caseManifestSha256
  };
  const alias = buildCandidateSourceAlias(verified.sourceManifest, binding);
  verifyCandidateSourceAlias(verified.sourceManifest, alias, binding);
  const bytes = Buffer.from(serializeCandidateSourceAlias(alias));
  const previous = readJson(path.join(attemptRoot, "execution-ledger.json"));
  const expectedSha256 = previous.controlledSourceAlias?.sha256;
  if (!expectedSha256 || sha256(bytes) !== expectedSha256 || !fs.existsSync(aliasPath) || !fs.readFileSync(aliasPath).equals(bytes)) {
    throw new Error("The existing B9 controlled source alias differs from the original first-group ledger.");
  }
  return { alias, aliasPath, aliasSha256: expectedSha256 };
}

export async function continueAiCommonFailuresB9({ manifestSha256, readinessProbe = probeLoopbackListen } = {}) {
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error(`Use Node 24; current runtime is ${process.version}`);
  selectAttempt(attemptId, "B9");
  const verified = verifyFreezeAndAttempt(manifestSha256);
  const firstItem = verified.attempt.schedule[0];
  const firstProfile = verified.profiles[firstItem.profile];
  const firstReportPath = realReportPath(firstProfile, firstItem.runId);
  const firstMetricPath = path.join(measurementsPath, `${firstItem.runId}.rss.json`);
  const firstLogPath = path.join(measurementsPath, `${firstItem.runId}.real.log`);
  const firstRecordsPath = path.join(path.dirname(firstReportPath), "records");
  const alias = verifyControlledAlias(verified);
  assertFreshContinuationOutputs(verified.profiles, verified.attempt.schedule);
  const first = attestFirstGroup({
    pluginRoot: root, evaluationRoot, attempt: verified.attempt, attemptManifestSha256: verified.attemptManifestSha256,
    expectedCaseIds: verified.caseManifest.realCases.map(({ id }) => id), reportPath: firstReportPath,
    metricPath: firstMetricPath, logPath: firstLogPath, recordsPath: firstRecordsPath
  });
  fs.mkdirSync(path.join(attemptRoot, "reconciliations"), { recursive: false });
  const reconciliationPath = path.join(attemptRoot, "reconciliations", `${firstItem.runId}.json`);
  fs.writeFileSync(reconciliationPath, `${JSON.stringify(first.reconciliation, null, 2)}\n`, { flag: "wx" });
  const reconciliationSha256 = sha256(fs.readFileSync(reconciliationPath));
  const eventsPath = path.join(attemptRoot, "continuation-ledger.jsonl");
  const summaryPath = path.join(attemptRoot, "continuation-ledger.json");
  const ledger = openContinuationLedger({
    eventsPath, manifestSha256: verified.attemptManifestSha256, parentHeadSha256: first.parentHeadSha256,
    parentLedgerSha256: first.reconciliation.evidence.parentLedger.summarySha256, reconciliationSha256
  });
  const suffix = verified.attempt.schedule.slice(1);
  const runs = [];
  let status = "incomplete";
  let error = null;
  ledger.append("first-group-reconciled", {
    runId: firstItem.runId, reportSha256: first.reconciliation.evidence.report.sha256,
    metricSha256: first.reconciliation.evidence.metric.sha256, recordsManifestSha256: first.reconciliation.evidence.records.manifestSha256,
    successfulResponses: first.reconciliation.reconciledAssessment.successfulResponses,
    historicalEvaluationStatus: first.reconciliation.rawEvaluationStatus,
    historicalRunnerStatus: first.reconciliation.oldRunnerAssessment.status,
    reconciledCompletionStatus: first.reconciliation.reconciledAssessment.status,
    parentStopHeadSha256: first.parentHeadSha256, reconciliation: relative(reconciliationPath), reconciliationSha256
  });
  try {
    for (let index = 1; index < verified.attempt.schedule.length; index += 1) {
      const item = verified.attempt.schedule[index];
      const profile = verified.profiles[item.profile];
      ledger.append("group-started", { runId: item.runId, profile: item.profile, round: item.round, realDenominator: 87, controlledDenominator: 16 });
      const controlled = await runControlled({
        item, profile, measurementRoot: measurementsPath, ledger, caseManifestSha256: verified.caseManifestSha256,
        sourceManifestSha256: alias.aliasSha256, canonicalSourceManifestSha256: verified.attempt.sourceSnapshot.manifestSha256,
        sourceRoot: verified.sourceRoot, aliasPath: alias.aliasPath
      });
      runs.push({ runId: item.runId, profile: item.profile, controlled: controlled.result });
      if (!new Set(["controlled-passed", "controlled-safety-passed"]).has(controlled.result.status)) {
        status = controlled.result.status;
        throw new Error(`${item.runId} controlled suite failed; no real calls started for that or later group.`);
      }
      const real = await runReal({
        item, profile, scheduleIndex: index, measurementRoot: measurementsPath, ledger, readinessProbe,
        expectedCaseIds: verified.caseManifest.realCases.map(({ id }) => id),
        caseManifestSha256: verified.caseManifestSha256, sourceManifestSha256: verified.attempt.sourceSnapshot.manifestSha256
      });
      runs[runs.length - 1].real = real;
      if (real.status !== "execution-complete") {
        status = real.status;
        throw new Error(`Stopped after ${item.runId} (${real.status}); continuation never retries model runs.`);
      }
    }
    status = "all-remaining-groups-executed";
  } catch (caught) {
    error = String(caught?.message ?? caught);
    ledger.append("continuation-stopped", { status, error });
  } finally {
    const summary = {
      schemaVersion: 1, type: "continuation-ledger", evaluationId: verified.attempt.evaluationId,
      attemptId, candidateId: "B9", status, attemptManifestSha256: verified.attemptManifestSha256,
      parentAttemptId: attemptId, parentExecutionLedger: relative(path.join(attemptRoot, "execution-ledger.json")),
      parentExecutionLedgerSha256: first.reconciliation.evidence.parentLedger.summarySha256,
      parentStopHeadSha256: first.parentHeadSha256,
      reconciledFirstGroup: { runId: firstItem.runId, status: "execution-complete", reconciliation: relative(reconciliationPath), reconciliationSha256 },
      remainingSchedule: suffix, completedGroups: runs, realCaseDenominatorPerRun: 87, controlledCaseDenominatorPerRun: 16,
      retries: 0, eventLedger: relative(eventsPath), eventCount: ledger.count(), eventHeadSha256: ledger.finalHash(),
      runnerSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))), finishedAt: new Date().toISOString(), error
    };
    fs.closeSync(ledger.fd);
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  }
  if (error) throw new Error(error);
  return { status, reconciled: relative(reconciliationPath), continuationLedger: relative(summaryPath), runs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(await continueAiCommonFailuresB9(args), null, 2));
  } catch (error) {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  }
}
