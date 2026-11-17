// Continue only after the recorded first-real-run loopback preflight stopped with EPERM.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { controlledReportPath, realReportPath, runControlled, runReal, selectAttempt, verifyFreezeAndAttempt } from "./run-ai-common-failures-b8.mjs";
import { buildCandidateSourceAlias, serializeCandidateSourceAlias, verifyCandidateSourceAlias } from "./candidate-source-alias.mjs";
import { assessPreflightStopForResume, attestFirstGroup, openContinuationLedger, verifyLedgerChain } from "./scenario-continuation.mjs";
import { probeLoopbackListen } from "./scenario-attempt-control.mjs";
import { assertFreshOutputPath, assertNoSymlinkPath, pluginRoot, resolvePluginPath } from "./scenario-v2-paths.mjs";

const root = pluginRoot;
const evaluationRoot = path.join(root, ".cache/acceptance/ai-common-failures/v1");
const attemptId = "authorized-run-03";
const attemptRoot = path.join(evaluationRoot, attemptId);
const resumeRoot = path.join(attemptRoot, "continuations/resume-01");
const measurementRoot = path.join(attemptRoot, "measurements");
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const relative = file => path.relative(root, file).split(path.sep).join("/");

function parseArgs(args) {
  const values = new Map();
  for (const arg of args) {
    const match = /^--(attempt|candidate|manifest-sha256|resume-preflight-stop|execute)(?:=(.*))?$/u.exec(arg);
    if (!match || values.has(match[1])) throw new Error(`Unexpected or duplicate argument: ${arg}`);
    values.set(match[1], match[2] ?? true);
  }
  if (values.get("attempt") !== attemptId || values.get("candidate") !== "B9" || values.get("resume-preflight-stop") !== true ||
      values.get("execute") !== true || !/^[a-f0-9]{64}$/u.test(values.get("manifest-sha256") ?? "")) {
    throw new Error("Usage: resume-ai-common-failures-b9.mjs --attempt=authorized-run-03 --candidate=B9 --manifest-sha256=<sha256> --resume-preflight-stop --execute");
  }
  return { manifestSha256: values.get("manifest-sha256") };
}

function verifyAlias(verified) {
  const aliasPath = path.join(attemptRoot, "controlled-source-manifest.json");
  const binding = {
    candidateId: "B9", canonicalSha256: verified.attempt.sourceSnapshot.manifestSha256,
    baseCaseManifestSha256: verified.sourceManifest.caseManifestSha256, derivedCaseManifestSha256: verified.caseManifestSha256
  };
  const alias = buildCandidateSourceAlias(verified.sourceManifest, binding);
  verifyCandidateSourceAlias(verified.sourceManifest, alias, binding);
  const bytes = Buffer.from(serializeCandidateSourceAlias(alias));
  const original = readJson(path.join(attemptRoot, "execution-ledger.json"));
  if (sha256(bytes) !== original.controlledSourceAlias?.sha256 || !fs.readFileSync(aliasPath).equals(bytes)) {
    throw new Error("The existing B9 source alias differs from its original execution ledger.");
  }
  return { aliasPath, aliasSha256: sha256(bytes) };
}

function verifyPreviousStop(verified, firstItem) {
  const oldSummaryPath = path.join(attemptRoot, "continuation-ledger.json");
  const oldEventsPath = path.join(attemptRoot, "continuation-ledger.jsonl");
  const summaryBytes = fs.readFileSync(oldSummaryPath);
  const eventsBytes = fs.readFileSync(oldEventsPath);
  const summary = JSON.parse(summaryBytes.toString("utf8"));
  const chain = verifyLedgerChain({ eventsBytes, summary, initialPreviousHash: summary.parentStopHeadSha256 });
  const controlled = summary.completedGroups?.[0]?.controlled;
  const controlledReportPathname = controlledReportPath(verified.profiles[firstItem.profile], firstItem.runId);
  const assessmentPathname = resolvePluginPath(chain.events[3]?.data?.supplementalAssessment, "completed controlled assessment", { mustExist: true });
  const report = readJson(controlledReportPathname);
  const assessment = readJson(assessmentPathname);
  const gate = assessPreflightStopForResume({
    eventsBytes, summary, expectedAttemptManifestSha256: verified.attemptManifestSha256, expectedRunId: firstItem.runId,
    controlledReport: report, controlledAssessment: assessment
  });
  if (!gate.resumable || sha256(fs.readFileSync(controlledReportPathname)) !== chain.events[3].data.reportSha256 ||
      path.relative(root, controlledReportPathname).split(path.sep).join("/") !== chain.events[3].data.report) {
    throw new Error(`Previous run is not a verified preflight-only stop: ${gate.reason ?? "controlled report binding mismatch"}`);
  }
  const firstReport = realReportPath(verified.profiles[verified.attempt.schedule[0].profile], verified.attempt.schedule[0].runId);
  if (!fs.existsSync(firstReport) || !summary.reconciledFirstGroup?.reconciliationSha256 ||
      !summary.parentStopHeadSha256 || summary.attemptManifestSha256 !== verified.attemptManifestSha256) {
    throw new Error("The completed balanced-r1 evidence or stop lineage is missing.");
  }
  const sidecarPath = resolvePluginPath(summary.reconciledFirstGroup.reconciliation, "first-group reconciliation", { mustExist: true });
  if (sha256(fs.readFileSync(sidecarPath)) !== summary.reconciledFirstGroup.reconciliationSha256) throw new Error("Original balanced-r1 reconciliation changed.");
  const firstEvidence = attestFirstGroup({
    pluginRoot: root, evaluationRoot, attempt: verified.attempt, attemptManifestSha256: verified.attemptManifestSha256,
    expectedCaseIds: verified.caseManifest.realCases.map(({ id }) => id), reportPath: firstReport,
    metricPath: path.join(measurementRoot, `${verified.attempt.schedule[0].runId}.rss.json`),
    logPath: path.join(measurementRoot, `${verified.attempt.schedule[0].runId}.real.log`),
    recordsPath: path.join(path.dirname(firstReport), "records")
  });
  if (firstEvidence.parentHeadSha256 !== summary.parentStopHeadSha256) throw new Error("Original balanced-r1 stop head no longer matches the continuation.");
  return { summary, summaryBytes, eventsBytes, chain, controlledReportPath: controlledReportPathname,
    controlledAssessmentPath: assessmentPathname, firstEvidence, sidecarPath };
}

function assertFreshResumeOutputs(profiles, schedule) {
  assertFreshOutputPath(resumeRoot, "B9 continuation resume evidence");
  for (let index = 1; index < schedule.length; index += 1) {
    const item = schedule[index];
    const profile = profiles[item.profile];
    const realOnly = index === 1;
    const outputs = realOnly ? [
      path.dirname(realReportPath(profile, item.runId)), path.join(measurementRoot, `${item.runId}.real.log`), path.join(measurementRoot, `${item.runId}.rss.json`)
    ] : [
      path.dirname(controlledReportPath(profile, item.runId)), path.dirname(realReportPath(profile, item.runId)),
      path.join(measurementRoot, `${item.runId}.controlled.log`), path.join(measurementRoot, `${item.runId}.real.log`),
      path.join(measurementRoot, `${item.runId}.rss.json`)
    ];
    for (const output of outputs) assertFreshOutputPath(output, `Untouched B9 output (${item.runId})`);
  }
}

export async function resumeAiCommonFailuresB9({ manifestSha256, readinessProbe } = {}) {
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error(`Use Node 24; current runtime is ${process.version}`);
  selectAttempt(attemptId, "B9");
  const verified = verifyFreezeAndAttempt(manifestSha256);
  const schedule = verified.attempt.schedule;
  const first = verifyPreviousStop(verified, schedule[1]);
  const alias = verifyAlias(verified);
  assertFreshResumeOutputs(verified.profiles, schedule);
  const continuationRoot = path.dirname(resumeRoot);
  assertNoSymlinkPath(continuationRoot);
  if (fs.existsSync(continuationRoot)) {
    if (!fs.statSync(continuationRoot).isDirectory()) throw new Error("Continuation parent path is not a directory.");
  } else {
    fs.mkdirSync(continuationRoot, { recursive: false });
  }
  fs.mkdirSync(resumeRoot, { recursive: false });
  const lineage = {
    schemaVersion: 1, type: "preflight-stop-resumption", status: "prepared", attemptId, candidateId: "B9",
    attemptManifestSha256: verified.attemptManifestSha256, canonicalSourceManifestSha256: verified.attempt.sourceSnapshot.manifestSha256,
    parentContinuationSummary: relative(path.join(attemptRoot, "continuation-ledger.json")),
    parentContinuationSummarySha256: sha256(first.summaryBytes), parentContinuationEvents: relative(path.join(attemptRoot, "continuation-ledger.jsonl")),
    parentContinuationEventsSha256: sha256(first.eventsBytes), parentContinuationHeadSha256: first.chain.headSha256,
    originalStopHeadSha256: first.summary.parentStopHeadSha256,
    reconciledBalancedR1: { runId: schedule[0].runId, reconciliation: relative(first.sidecarPath), reconciliationSha256: first.summary.reconciledFirstGroup.reconciliationSha256 },
    reusedControlledEvidence: { runId: schedule[1].runId, report: relative(first.controlledReportPath), reportSha256: sha256(fs.readFileSync(first.controlledReportPath)),
      assessment: relative(first.controlledAssessmentPath), assessmentSha256: sha256(fs.readFileSync(first.controlledAssessmentPath)) },
    plan: [schedule[1].runId, schedule[2].runId, schedule[3].runId],
    policy: "Do not rerun balanced-r1. Reuse light-r1 controlled evidence after its EPERM-only preflight stop; execute its first real run once, then controlled+real for light-r2 and balanced-r2. No retries."
  };
  const lineagePath = path.join(resumeRoot, "resumption-sidecar.json");
  fs.writeFileSync(lineagePath, `${JSON.stringify(lineage, null, 2)}\n`, { flag: "wx" });
  const lineageSha256 = sha256(fs.readFileSync(lineagePath));
  const eventsPath = path.join(resumeRoot, "events.jsonl");
  const summaryPath = path.join(resumeRoot, "summary.json");
  const ledger = openContinuationLedger({ eventsPath, manifestSha256: verified.attemptManifestSha256,
    parentHeadSha256: first.chain.headSha256, parentLedgerSha256: sha256(first.summaryBytes), reconciliationSha256: lineageSha256 });
  const runs = [];
  let status = "incomplete";
  let error = null;
  try {
    ledger.append("preflight-stop-resumed", { sidecar: relative(lineagePath), sidecarSha256: lineageSha256,
      priorRunId: schedule[1].runId, realStartedInPriorLedger: false, controlledEvidenceReused: true });
    const firstRealItem = schedule[1];
    ledger.append("controlled-evidence-reused", { runId: firstRealItem.runId, report: relative(first.controlledReportPath), reportSha256: lineage.reusedControlledEvidence.reportSha256 });
    const firstReal = await runReal({ item: firstRealItem, profile: verified.profiles[firstRealItem.profile], scheduleIndex: 1,
      measurementRoot, ledger, readinessProbe: readinessProbe ?? probeLoopbackListen, expectedCaseIds: verified.caseManifest.realCases.map(({ id }) => id),
      caseManifestSha256: verified.caseManifestSha256, sourceManifestSha256: verified.attempt.sourceSnapshot.manifestSha256 });
    runs.push({ runId: firstRealItem.runId, profile: firstRealItem.profile, controlled: { status: "reused-controlled-safety-passed" }, real: firstReal });
    if (firstReal.status !== "execution-complete") throw new Error(`Stopped after ${firstRealItem.runId} (${firstReal.status}); no real request is retried.`);
    for (let index = 2; index < schedule.length; index += 1) {
      const item = schedule[index];
      const profile = verified.profiles[item.profile];
      ledger.append("group-started", { runId: item.runId, profile: item.profile, round: item.round, realDenominator: 87, controlledDenominator: 16 });
      const controlled = await runControlled({ item, profile, measurementRoot, ledger, caseManifestSha256: verified.caseManifestSha256,
        sourceManifestSha256: alias.aliasSha256, canonicalSourceManifestSha256: verified.attempt.sourceSnapshot.manifestSha256,
        sourceRoot: verified.sourceRoot, aliasPath: alias.aliasPath });
      runs.push({ runId: item.runId, profile: item.profile, controlled: controlled.result });
      if (!new Set(["controlled-passed", "controlled-safety-passed"]).has(controlled.result.status)) throw new Error(`${item.runId} controlled gate failed; no real call started.`);
      const real = await runReal({ item, profile, scheduleIndex: index, measurementRoot, ledger, readinessProbe: readinessProbe ?? probeLoopbackListen,
        expectedCaseIds: verified.caseManifest.realCases.map(({ id }) => id), caseManifestSha256: verified.caseManifestSha256,
        sourceManifestSha256: verified.attempt.sourceSnapshot.manifestSha256 });
      runs[runs.length - 1].real = real;
      if (real.status !== "execution-complete") throw new Error(`Stopped after ${item.runId} (${real.status}); no real request is retried.`);
    }
    status = "remaining-groups-executed";
  } catch (caught) {
    error = String(caught?.message ?? caught);
    status = runs.at(-1)?.real?.status ?? runs.at(-1)?.controlled?.status ?? "incomplete";
    ledger.append("resume-stopped", { status, error });
  } finally {
    fs.closeSync(ledger.fd);
    const summary = { schemaVersion: 1, type: "continuation-resume-ledger", evaluationId: verified.attempt.evaluationId,
      attemptId, candidateId: "B9", status, attemptManifestSha256: verified.attemptManifestSha256,
      parentContinuationHeadSha256: first.chain.headSha256, originalStopHeadSha256: first.summary.parentStopHeadSha256,
      sidecar: relative(lineagePath), sidecarSha256: lineageSha256, historicalBalancedR1: "execution-complete-not-rerun",
      runs, realCaseDenominatorPerRun: 87, controlledCaseDenominatorPerRun: 16, retries: 0,
      eventLedger: relative(eventsPath), eventCount: ledger.count(), eventHeadSha256: ledger.finalHash(),
      runnerSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))), finishedAt: new Date().toISOString(), error };
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  }
  if (error) throw new Error(error);
  return { status, summary: relative(summaryPath), events: relative(eventsPath), sidecar: relative(lineagePath), runs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await resumeAiCommonFailuresB9(parseArgs(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error?.stack ?? String(error)); process.exitCode = 1; }
}
