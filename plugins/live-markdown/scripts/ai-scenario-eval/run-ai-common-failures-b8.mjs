// Runs the already-frozen B8 candidate in four sequential, no-retry groups.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnLogged, waitForChild, sampleManagedServerRss } from "./scenario-runner-process.mjs";
import { assessExecutionCompletion, probeLoopbackListen } from "./scenario-attempt-control.mjs";
import { buildControlledSourceAlias, serializeControlledSourceAlias, verifyControlledSourceAlias } from "./b8-controlled-source-alias.mjs";
import { buildCandidateSourceAlias, serializeCandidateSourceAlias, verifyCandidateSourceAlias } from "./candidate-source-alias.mjs";
import { assessControlledB8Report, assessControlledCandidate, controlledCandidateRecord } from "./b8-controlled-assessment.mjs";
import { verifyRun03ParentLineage } from "./b8-run03-lineage.mjs";
import { B8_SCHEDULE } from "./prepare-ai-common-failures-b8.mjs";
import { B9_SCHEDULE } from "./prepare-ai-common-failures-b9.mjs";
import { assertFreshOutputPath, assertNoSymlinkPath, pluginRoot, resolvePluginPath } from "./scenario-v2-paths.mjs";
import { verifyV2ToolSnapshot } from "./scenario-v2-snapshot.mjs";
import { hasExactCaseOrder, hasExactRecordIdSet } from "./scenario-record-validation.mjs";

const root = pluginRoot;
const evaluationRoot = path.join(root, ".cache/acceptance/ai-common-failures/v1");
let attemptId = "authorized-run-02";
let candidateId = "B8";
let attemptRoot = path.join(evaluationRoot, attemptId);
let attemptManifestPath = path.join(attemptRoot, "attempt-manifest.json");
let ledgerEventsPath = path.join(attemptRoot, "execution-ledger.jsonl");
let ledgerSummaryPath = path.join(attemptRoot, "execution-ledger.json");
let measurementsPath = path.join(attemptRoot, "measurements");
let controlledAliasPath = path.join(attemptRoot, "controlled-source-manifest.json");
const expectedControlledIds = Array.from({ length: 16 }, (_, index) => `E${String(index + 1).padStart(2, "0")}`);
const MAX_GROUP_MS = 8 * 60 * 60 * 1000;
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const readJson = filePath => JSON.parse(fs.readFileSync(filePath, "utf8"));
const hashFile = filePath => sha256(fs.readFileSync(filePath));
const relative = filePath => path.relative(root, filePath).split(path.sep).join("/");

export function selectAttempt(id = "authorized-run-02", candidate = "B8") {
  if (!new Set(["authorized-run-02", "authorized-run-03"]).has(id)) throw new Error(`Unsupported B8 attempt: ${id}`);
  const expectedCandidate = id === "authorized-run-02" ? "B8" : "B9";
  if (candidate !== expectedCandidate) throw new Error(`${id} requires explicit candidate ${expectedCandidate}.`);
  attemptId = id;
  candidateId = candidate;
  attemptRoot = path.join(evaluationRoot, attemptId);
  attemptManifestPath = path.join(attemptRoot, "attempt-manifest.json");
  ledgerEventsPath = path.join(attemptRoot, "execution-ledger.jsonl");
  ledgerSummaryPath = path.join(attemptRoot, "execution-ledger.json");
  measurementsPath = path.join(attemptRoot, "measurements");
  controlledAliasPath = path.join(attemptRoot, "controlled-source-manifest.json");
}

function safePluginPath(value, label, base = root) {
  const absolute = path.resolve(base, value);
  const rel = path.relative(path.resolve(base), absolute);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error(`${label} escaped its root: ${value}`);
  assertNoSymlinkPath(absolute);
  return absolute;
}

function walkFiles(directory, current = directory, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Snapshot contains a symlink: ${relative(absolute)}`);
    if (entry.isDirectory()) walkFiles(directory, absolute, files);
    else if (entry.isFile()) files.push(path.relative(directory, absolute).split(path.sep).join("/"));
    else throw new Error(`Snapshot contains a non-regular entry: ${relative(absolute)}`);
  }
  return files.sort();
}

function verifyFileTree(directory, manifest, label) {
  const actualPaths = walkFiles(directory);
  if (JSON.stringify(actualPaths) !== JSON.stringify([...manifest.paths].sort())) throw new Error(`${label} path set changed.`);
  for (const file of actualPaths) {
    const bytes = fs.readFileSync(path.join(directory, file));
    const expected = manifest.files[file];
    if (!expected || sha256(bytes) !== expected.sha256 || bytes.byteLength !== expected.bytes) throw new Error(`${label} hash changed: ${file}`);
  }
}

function verifyAttemptSchedule(schedule) {
  if (attemptId === "authorized-run-02") return JSON.stringify(schedule) === JSON.stringify(B8_SCHEDULE);
  return JSON.stringify(schedule) === JSON.stringify(B9_SCHEDULE);
}

export function verifyFreezeAndAttempt(expectedManifestSha256) {
  if (!/^[a-f0-9]{64}$/u.test(expectedManifestSha256 ?? "")) throw new Error("Supply the exact frozen attempt manifest SHA-256 before execution.");
  const attemptBytes = fs.readFileSync(attemptManifestPath);
  if (sha256(attemptBytes) !== expectedManifestSha256) throw new Error("B8 attempt manifest SHA-256 mismatch; refusing execution.");
  const attempt = JSON.parse(attemptBytes.toString("utf8"));
  const recordedCandidate = attempt.candidateId ?? (attemptId === "authorized-run-02" ? "B8" : null);
  const expectedEvaluationId = `ai-common-failures-${candidateId.toLowerCase()}-v1`;
  if (attempt.evaluationId !== expectedEvaluationId || attempt.attemptId !== attemptId || recordedCandidate !== candidateId || attempt.policy?.realCases !== 87 ||
      attempt.policy?.controlledCases !== 16 || attempt.policy?.retries !== 0 || attempt.policy?.downloadsAllowed !== false ||
      attempt.policy?.deploymentAllowed !== false || attempt.policy?.editorWriteback !== false || attempt.policy?.sequential !== true) {
    throw new Error("B8 frozen policy is incomplete or unsafe.");
  }
  if (!verifyAttemptSchedule(attempt.schedule) || (attemptId === "authorized-run-03" && candidateId !== "B9") || (attemptId === "authorized-run-03" &&
      attempt.policy?.controlledAssessment !== "strict-plus-cursor-precondition-safety-v1")) {
    throw new Error("B8 schedule or controlled assessment policy differs from the frozen attempt.");
  }

  const freezePath = path.join(evaluationRoot, "freeze-manifest.json");
  const freeze = readJson(freezePath);
  for (const [file, expected] of Object.entries(freeze.files ?? {})) {
    const absolute = safePluginPath(file, "frozen input", evaluationRoot);
    const bytes = fs.readFileSync(absolute);
    if (sha256(bytes) !== expected.sha256 || bytes.byteLength !== expected.bytes) throw new Error(`Frozen B7 input changed: ${file}`);
  }
  const derived = readJson(path.join(evaluationRoot, "run-inputs/derived-manifest.json"));
  const casePath = safePluginPath(derived.casePath, "derived case manifest");
  const caseBytes = fs.readFileSync(casePath);
  const caseManifestSha256 = sha256(caseBytes);
  const caseManifest = JSON.parse(caseBytes.toString("utf8"));
  if (caseManifestSha256 !== derived.caseManifestSha256 || caseManifestSha256 !== attempt.inputs?.caseManifestSha256 ||
      caseManifest.realCases?.length !== 87 || caseManifest.controlledCases?.length !== 16 ||
      JSON.stringify(caseManifest.controlledCases.map(({ id }) => id)) !== JSON.stringify(expectedControlledIds)) {
    throw new Error("Frozen case set must remain exactly 87 real tasks and E01-E16 controlled cases.");
  }
  if (attemptId === "authorized-run-03") verifyRun03ParentLineage(evaluationRoot, attempt);
  const b7LedgerPath = path.join(evaluationRoot, "authorized-run-01/execution-ledger.json");
  if (hashFile(b7LedgerPath) !== attempt.inputs?.b7RunLedgerSha256) throw new Error("Original B7 ledger changed since B8 freeze.");
  const b7Ledger = readJson(b7LedgerPath);
  if (b7Ledger.runs?.length !== 8 || b7Ledger.runs.some(run => run.status !== "execution-complete" || run.cleanupErrors?.length)) {
    throw new Error("B8 requires all eight original B7/B6 runs to remain complete and cleanup-clean.");
  }
  const b7ToolHash = hashFile(path.join(evaluationRoot, "profiles/light/tool-manifest.json"));
  if (b7ToolHash !== attempt.inputs?.b7ToolManifestSha256) throw new Error("Original B7 tool manifest changed since B8 freeze.");
  const b7SourceManifestPath = path.join(evaluationRoot, "snapshots/B7/source-manifest.json");
  const b7SourceBytes = fs.readFileSync(b7SourceManifestPath);
  if (sha256(b7SourceBytes) !== attempt.inputs?.b7SourceManifestSha256) throw new Error("Original B7 source manifest changed since B8 freeze.");
  const runtimePath = path.join(root, ".cache/acceptance/ai-model-comparison/v1/runtime-preparation.json");
  if (hashFile(runtimePath) !== attempt.inputs?.runtimePreparationSha256) throw new Error("Verified model cache manifest changed since B8 freeze.");
  const runtime = readJson(runtimePath);
  if (runtime.status !== "configured-from-verified-cache" || runtime.deploymentPerformed !== false || runtime.downloadBytes !== 0) {
    throw new Error("B8 execution may use only the previously verified cached models; no download or deployment is permitted.");
  }

  const sourceManifestPath = safePluginPath(attempt.sourceSnapshot?.manifest, "B8 source manifest");
  const sourceRoot = safePluginPath(attempt.sourceSnapshot?.root, "B8 source snapshot");
  const sourceBytes = fs.readFileSync(sourceManifestPath);
  if (sha256(sourceBytes) !== attempt.sourceSnapshot?.manifestSha256) throw new Error("B8 source manifest hash differs from attempt manifest.");
  const sourceManifest = JSON.parse(sourceBytes.toString("utf8"));
  const expectedParentHash = candidateId === "B8" ? attempt.inputs.b7SourceManifestSha256 : attempt.inputs.b8SourceManifestSha256;
  const actualParentHash = candidateId === "B8" ? sourceManifest.parentB7SourceManifestSha256 : sourceManifest.parentB8SourceManifestSha256;
  if (sourceManifest.variant !== candidateId || sourceManifest.caseManifestSha256 !== derived.baseCaseManifestSha256 ||
      actualParentHash !== expectedParentHash) throw new Error(`${candidateId} source snapshot lost its canonical-case or parent-candidate lineage.`);
  verifyFileTree(sourceRoot, sourceManifest, "B8 source snapshot");

  const profiles = {};
  for (const profileId of ["balanced", "light"]) {
    const profileManifest = attempt.profiles?.find(profile => profile.id === profileId);
    if (!profileManifest) throw new Error(`Missing frozen B8 profile: ${profileId}`);
    const configPath = safePluginPath(profileManifest.config, `${profileId} profile config`);
    const toolManifestPath = safePluginPath(profileManifest.toolManifest, `${profileId} profile tool manifest`);
    if (hashFile(configPath) !== profileManifest.configSha256 || hashFile(toolManifestPath) !== profileManifest.toolManifestSha256) {
      throw new Error(`Frozen B8 ${profileId} profile binding changed.`);
    }
    const verified = verifyV2ToolSnapshot({ configPath, toolManifestPath });
    const config = verified.config;
    if (config.evaluationId !== attempt.evaluationId || config.model?.profileId !== profileId || config.model?.retries !== 0 ||
        config.model?.deploymentAllowed !== false || config.sourceVariants?.B?.sourceManifest !== relative(sourceManifestPath) ||
        config.sourceVariants?.B?.sourceRoot !== relative(sourceRoot) || config.limits?.maxCallsPerCase !== attempt.policy.maxCallsPerCase ||
        config.limits?.runnerDeadlineMs !== attempt.policy.runnerDeadlineMs || config.limits?.independentHarnessDeadlineMs !== attempt.policy.harnessDeadlineMs ||
        config.limits?.productionDeadlineMs !== attempt.policy.taskDeadlineMs) {
      throw new Error(`B8 ${profileId} run configuration differs from its frozen policy.`);
    }
    const toolCasePath = path.resolve(path.dirname(configPath), config.caseSets[config.defaultCaseSetId]);
    if (sha256(fs.readFileSync(toolCasePath)) !== caseManifestSha256) throw new Error(`B8 ${profileId} profile is bound to another case set.`);
    if (verified.manifest.caseManifestSha256 !== caseManifestSha256) throw new Error(`B8 ${profileId} tool manifest case hash mismatch.`);
    const expectedOutput = `.cache/acceptance/ai-common-failures/v1/${attemptId}/runs/${profileId}`;
    if (config.outputRoot !== expectedOutput) throw new Error(`B8 ${profileId} output root escaped the isolated attempt.`);
    profiles[profileId] = {
      configPath, config, outputRoot: safePluginPath(config.outputRoot, `${profileId} output root`),
      localAiDirectory: safePluginPath(config.localAiDirectory, `${profileId} local model state`),
      profileManifest, toolManifest: verified.manifest
    };
  }
  return { attempt, attemptManifestSha256: expectedManifestSha256, caseManifest, caseManifestSha256, sourceManifest, sourceRoot, sourceManifestPath, profiles };
}

export { assessControlledB8Report };

export function parseB8RunArgs(args) {
  let execute = false;
  let verifyOnly = false;
  let manifestSha256;
  let selectedAttemptId = "authorized-run-02";
  let attemptWasSet = false;
  let selectedCandidate = "B8";
  let candidateWasSet = false;
  for (const arg of args) {
    if (arg === "--execute" && !execute) execute = true;
    else if (arg === "--verify-only" && !verifyOnly) verifyOnly = true;
    else if (arg.startsWith("--manifest-sha256=") && !manifestSha256) manifestSha256 = arg.slice("--manifest-sha256=".length);
    else if (arg.startsWith("--attempt=") && !attemptWasSet) { selectedAttemptId = arg.slice("--attempt=".length); attemptWasSet = true; }
    else if (arg.startsWith("--candidate=") && !candidateWasSet) { selectedCandidate = arg.slice("--candidate=".length); candidateWasSet = true; }
    else throw new Error(`Unexpected or duplicate argument: ${arg}`);
  }
  if (selectedAttemptId === "authorized-run-03" && !candidateWasSet) throw new Error("authorized-run-03 requires explicit --candidate=B9.");
  if (!manifestSha256 || !/^[a-f0-9]{64}$/u.test(manifestSha256) || execute === verifyOnly ||
      !new Set(["authorized-run-02", "authorized-run-03"]).has(selectedAttemptId) ||
      selectedCandidate !== (selectedAttemptId === "authorized-run-02" ? "B8" : "B9") ||
      (selectedAttemptId === "authorized-run-02" && candidateWasSet && selectedCandidate !== "B8")) {
    throw new Error("Usage: run-ai-common-failures-b8.mjs [--attempt=authorized-run-02|authorized-run-03] [--candidate=B8|B9] --manifest-sha256=<sha256> (--verify-only|--execute)");
  }
  return { execute, verifyOnly, manifestSha256, attemptId: selectedAttemptId, candidateId: selectedCandidate };
}

export function readRecords(runDirectory) {
  const recordsPath = path.join(runDirectory, "records");
  if (!fs.existsSync(recordsPath)) return [];
  return fs.readdirSync(recordsPath).filter(name => name.endsWith(".json")).sort().map(name => readJson(path.join(recordsPath, name)));
}

export function controlledReportPath(profile, runId) {
  return path.join(profile.outputRoot, `B-controlled-${runId}`, "controlled-report.json");
}

export function realReportPath(profile, runId) {
  return path.join(profile.outputRoot, `B-${runId}`, "run-report.json");
}

function assertFreshB8Outputs(profiles, schedule) {
  if (fs.existsSync(ledgerEventsPath) || fs.existsSync(ledgerSummaryPath) || fs.existsSync(measurementsPath) || fs.existsSync(controlledAliasPath)) {
    throw new Error("B8 attempt already contains execution evidence; this runner never resumes or retries.");
  }
  for (const item of schedule) {
    const profile = profiles[item.profile];
    for (const output of [
      path.dirname(controlledReportPath(profile, item.runId)),
      path.dirname(realReportPath(profile, item.runId)),
      path.join(measurementsPath, `${item.runId}.controlled.log`),
      path.join(measurementsPath, `${item.runId}.real.log`),
      path.join(measurementsPath, `${item.runId}.rss.json`)
    ]) assertFreshOutputPath(output, "B8 run output");
  }
}

function openLedger(manifestSha256) {
  const fd = fs.openSync(ledgerEventsPath, "wx");
  let sequence = 0;
  let previousHash = "0".repeat(64);
  const append = (type, data = {}) => {
    const body = { sequence: ++sequence, at: new Date().toISOString(), type, data, previousHash };
    const eventHash = sha256(JSON.stringify(body));
    const line = `${JSON.stringify({ ...body, eventHash })}\n`;
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
    previousHash = eventHash;
  };
  append("attempt-started", { attemptId, manifestSha256, runnerSha256: hashFile(fileURLToPath(import.meta.url)) });
  return { fd, append, finalHash: () => previousHash, count: () => sequence };
}

function writeSummary(summary) {
  fs.writeFileSync(ledgerSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
}

export async function runControlled({ item, profile, measurementRoot, ledger, caseManifestSha256, sourceManifestSha256, canonicalSourceManifestSha256, sourceRoot, aliasPath }) {
  const logPath = path.join(measurementRoot, `${item.runId}.controlled.log`);
  const reportPath = controlledReportPath(profile, item.runId);
  const runDirectory = path.dirname(reportPath);
  const runner = path.join(root, "scripts/ai-scenario-eval/run-scenarios-v2.mjs");
  const args = [runner, `--config=${relative(profile.configPath)}`, "--variant=B", `--run=${item.runId}`, "--mode=controlled",
    `--source-root=${relative(sourceRoot)}`, `--source-manifest=${relative(aliasPath)}`];
  const logFd = fs.openSync(logPath, "wx");
  const startedAt = new Date().toISOString();
  let processResult;
  try {
    const spawned = spawnLogged(args, root, logFd);
    processResult = await waitForChild(spawned.child, spawned.exit);
  } finally { fs.closeSync(logFd); }
  if (!fs.existsSync(reportPath)) {
    const result = { status: "controlled-incomplete", expectedCases: 16, actualCases: 0, error: "controlled-report-missing" };
    ledger.append("controlled-finished", { runId: item.runId, profile: item.profile, startedAt, exitCode: processResult?.code ?? null, signal: processResult?.signal ?? null, report: null, log: relative(logPath), assessment: result });
    return { result, report: null, reportPath: null, logPath };
  }
  const report = readJson(reportPath);
  const bindings = { caseManifestSha256, sourceManifestSha256 };
  const strictAssessment = assessControlledB8Report(report, bindings);
  let assessment = attemptId === "authorized-run-03"
    ? assessControlledCandidate(report, bindings)
    : strictAssessment;
  if (processResult?.timedOut) assessment = { ...assessment, status: "controlled-incomplete" };
  let safetyAssessmentPath = null;
  if (attemptId === "authorized-run-03") {
    safetyAssessmentPath = path.join(runDirectory, "controlled-candidate-assessment.json");
    const record = controlledCandidateRecord(assessment, {
      sourceManifestSha256, canonicalSourceManifestSha256, caseManifestSha256
    });
    fs.writeFileSync(safetyAssessmentPath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  }
  ledger.append("controlled-finished", {
    runId: item.runId, profile: item.profile, startedAt, finishedAt: report.finishedAt ?? new Date().toISOString(),
    exitCode: processResult?.code ?? null, signal: processResult?.signal ?? null,
    report: relative(reportPath), reportSha256: hashFile(reportPath), log: relative(logPath), assessment,
    strictAssessment: attemptId === "authorized-run-03" ? strictAssessment : undefined,
    supplementalAssessment: safetyAssessmentPath ? relative(safetyAssessmentPath) : null,
    controlledSourceAlias: relative(aliasPath), controlledSourceManifestSha256: sourceManifestSha256,
    canonicalCandidateSourceManifestSha256: canonicalSourceManifestSha256
  });
  return { result: assessment, strictAssessment, report, reportPath, runDirectory, safetyAssessmentPath, logPath, processResult };
}

export async function runReal({ item, profile, scheduleIndex, measurementRoot, ledger, readinessProbe, expectedCaseIds, caseManifestSha256, sourceManifestSha256 }) {
  const readiness = await readinessProbe();
  ledger.append("loopback-preflight", { runId: item.runId, profile: item.profile, ...readiness });
  if (!readiness.ok) return { status: "infrastructure-invalid", reason: `loopback-listen-${readiness.code ?? "failed"}`, preflight: readiness };
  ledger.append("real-started", { runId: item.runId, profile: item.profile, scheduleIndex, caseCount: 87, retries: 0 });
  const outputReport = realReportPath(profile, item.runId);
  const runDirectory = path.dirname(outputReport);
  const logPath = path.join(measurementRoot, `${item.runId}.real.log`);
  const metricPath = path.join(measurementRoot, `${item.runId}.rss.json`);
  const runner = path.join(root, "scripts/ai-scenario-eval/run-scenarios-v2.mjs");
  const args = [runner, `--config=${relative(profile.configPath)}`, "--variant=B", `--run=${item.runId}`, "--mode=real"];
  const logFd = fs.openSync(logPath, "wx");
  const samples = [];
  const stats = { maxRssKiB: 0, samplesCollected: 0, measurementErrors: 0 };
  const localAiDirectory = profile.localAiDirectory;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let processResult;
  let interval;
  try {
    const spawned = spawnLogged(args, root, logFd);
    interval = setInterval(() => sampleManagedServerRss(profile, localAiDirectory, stats, samples), 500);
    processResult = await waitForChild(spawned.child, spawned.exit);
  } finally {
    if (interval) clearInterval(interval);
    sampleManagedServerRss(profile, localAiDirectory, stats, samples);
    fs.closeSync(logFd);
  }
  const metric = {
    schemaVersion: 1, runId: item.runId, profile: item.profile, modelId: profile.config.model.modelId,
    startedAt, finishedAt: new Date().toISOString(), wallMs: Date.now() - started,
    exitCode: processResult?.code ?? null, signal: processResult?.signal ?? null,
    sampler: "ps-ww-comm-exact-realpath-plus-separate-rss-v1", samplerSha256: hashFile(fileURLToPath(import.meta.url)),
    ...stats, maxRssKiB: stats.samplesCollected ? stats.maxRssKiB : null,
    rssMeasurementAvailable: stats.samplesCollected > 0, samples,
    scope: "Sampled exact llama-server process RSS; excludes editor, JS/Vite harness, GPU allocation and whole-system peak. Zero samples means unavailable, not zero."
  };
  fs.writeFileSync(metricPath, `${JSON.stringify(metric, null, 2)}\n`, { flag: "wx" });
  if (!fs.existsSync(outputReport)) {
    const result = { status: "infrastructure-invalid", reason: processResult?.timedOut ? "runner-group-timeout" : "real-report-missing", successfulResponses: 0 };
    ledger.append("real-finished", { runId: item.runId, profile: item.profile, scheduleIndex, ...result, log: relative(logPath), measurement: relative(metricPath), exitCode: processResult?.code ?? null, signal: processResult?.signal ?? null });
    return result;
  }
  const report = readJson(outputReport);
  const records = readRecords(runDirectory);
  const recordIds = records.map(({ id }) => id);
  const reportedIds = (report.cases ?? []).map(({ id }) => id);
  let assessment = assessExecutionCompletion({ report, records, exitCode: processResult?.code, expectedCases: 87 });
  if (report.caseManifestSha256 !== caseManifestSha256 || report.source?.sourceManifestSha256 !== sourceManifestSha256) {
    assessment = { ...assessment, status: "incomplete", reason: "run-report-frozen-input-mismatch" };
  }
  if (!hasExactRecordIdSet(recordIds, expectedCaseIds) || !hasExactCaseOrder(reportedIds, expectedCaseIds)) {
    assessment = { ...assessment, status: "incomplete", reason: "case-record-set-mismatch" };
  }
  if (processResult?.timedOut) assessment = { ...assessment, status: "incomplete", reason: "runner-group-timeout" };
  const result = {
    runId: item.runId, variant: item.variant, profile: item.profile, scheduleIndex, status: assessment.status,
    statusReason: assessment.reason, successfulModelResponses: assessment.successfulResponses,
    evaluationStatus: report.status, expectedCases: report.expectedTotal, executedCases: report.executedTotal,
    strictPasses: report.summary?.scores?.strictIntent?.pass ?? null,
    userTaskPasses: report.summary?.scores?.userTask?.pass ?? null,
    report: relative(outputReport), reportSha256: hashFile(outputReport), log: relative(logPath), measurement: relative(metricPath),
    cleanupErrors: report.cleanup?.errors ?? [], error: report.error ?? null, exitCode: processResult?.code ?? null,
    rssMeasurementAvailable: metric.rssMeasurementAvailable, maxRssKiB: metric.maxRssKiB
  };
  ledger.append("real-finished", result);
  return result;
}

export async function runAiCommonFailuresB8({ manifestSha256, attemptId: selectedAttemptId = "authorized-run-02", candidateId: selectedCandidate = "B8", execute = false, readinessProbe = probeLoopbackListen } = {}) {
  selectAttempt(selectedAttemptId, selectedCandidate);
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error(`Use Node 24; current runtime is ${process.version}`);
  if (execute !== true) throw new Error(`${candidateId} inference is disabled unless --execute is explicitly supplied.`);
  const verified = verifyFreezeAndAttempt(manifestSha256);
  assertFreshB8Outputs(verified.profiles, verified.attempt.schedule);
  const aliasBinding = {
    canonicalSha256: verified.attempt.sourceSnapshot.manifestSha256,
    baseCaseManifestSha256: verified.sourceManifest.caseManifestSha256,
    derivedCaseManifestSha256: verified.caseManifestSha256
  };
  const controlledAlias = candidateId === "B8"
    ? buildControlledSourceAlias(verified.sourceManifest, aliasBinding)
    : buildCandidateSourceAlias(verified.sourceManifest, { ...aliasBinding, candidateId });
  if (candidateId === "B8") verifyControlledSourceAlias(verified.sourceManifest, controlledAlias, aliasBinding);
  else verifyCandidateSourceAlias(verified.sourceManifest, controlledAlias, { ...aliasBinding, candidateId });
  const controlledAliasBytes = candidateId === "B8"
    ? serializeControlledSourceAlias(controlledAlias)
    : serializeCandidateSourceAlias(controlledAlias);
  const controlledAliasSha256 = sha256(controlledAliasBytes);
  const ledgerMapping = {
    path: relative(controlledAliasPath), controlledSourceManifestSha256: controlledAliasSha256,
    candidateId, canonicalCandidateSourceManifest: relative(verified.sourceManifestPath),
    canonicalCandidateSourceManifestSha256: verified.attempt.sourceSnapshot.manifestSha256,
    parentB8SourceManifestSha256: candidateId === "B9" ? verified.sourceManifest.parentB8SourceManifestSha256 : null,
    baseCaseManifestSha256: verified.sourceManifest.caseManifestSha256, derivedCaseManifestSha256: verified.caseManifestSha256,
    productFileManifestUnchanged: JSON.stringify(controlledAlias.paths) === JSON.stringify(verified.sourceManifest.paths) &&
      JSON.stringify(controlledAlias.files) === JSON.stringify(verified.sourceManifest.files)
  };
  fs.mkdirSync(measurementsPath, { recursive: false });
  const ledger = openLedger(verified.attemptManifestSha256);
  const runs = [];
  let finalStatus = "incomplete";
  let error = null;
  try {
    fs.writeFileSync(controlledAliasPath, controlledAliasBytes, { flag: "wx" });
    ledger.append("controlled-source-alias-created", ledgerMapping);
    for (let index = 0; index < verified.attempt.schedule.length; index += 1) {
      const item = verified.attempt.schedule[index];
      const profile = verified.profiles[item.profile];
      ledger.append("group-started", { runId: item.runId, profile: item.profile, round: item.round, realDenominator: 87, controlledDenominator: 16 });
      const sourceManifestSha256 = verified.attempt.sourceSnapshot.manifestSha256;
      const controlled = await runControlled({
        item, profile, measurementRoot: measurementsPath, ledger,
        caseManifestSha256: verified.caseManifestSha256, sourceManifestSha256: controlledAliasSha256,
        canonicalSourceManifestSha256: verified.attempt.sourceSnapshot.manifestSha256,
        sourceRoot: verified.sourceRoot, aliasPath: controlledAliasPath
      });
      runs.push({ runId: item.runId, profile: item.profile, controlled: controlled.result });
      if (!new Set(["controlled-passed", "controlled-safety-passed"]).has(controlled.result.status)) {
        finalStatus = controlled.result.status;
        throw new Error(`${item.runId} controlled E01-E16 safety gate did not pass; no real model calls were started for this group or later groups.`);
      }
      const real = await runReal({
        item, profile, scheduleIndex: index, measurementRoot: measurementsPath, ledger,
        readinessProbe, expectedCaseIds: verified.caseManifest.realCases.map(({ id }) => id),
        caseManifestSha256: verified.caseManifestSha256, sourceManifestSha256
      });
      runs[runs.length - 1].real = real;
      if (real.status !== "execution-complete") {
        finalStatus = real.status;
        throw new Error(`Stopped after ${item.runId} (${real.status}); ${candidateId} is no-retry and later groups were not run.`);
      }
    }
    finalStatus = "all-scheduled-runs-executed";
  } catch (caught) {
    error = String(caught?.message ?? caught);
    ledger.append("attempt-stopped", { status: finalStatus, error });
  } finally {
    const summary = {
      schemaVersion: 1, evaluationId: verified.attempt.evaluationId, attemptId, candidateId, status: finalStatus,
      attemptManifestSha256: verified.attemptManifestSha256, caseManifestSha256: verified.caseManifestSha256,
      realCaseDenominatorPerRun: 87, controlledCaseDenominatorPerRun: 16,
      controlledIds: expectedControlledIds, modelCallsExpectedForControlled: 0,
      controlledSourceAlias: {
        ...ledgerMapping, sha256: controlledAliasSha256
      },
      controlledGate: candidateId === "B9" ? "strict-plus-cursor-precondition-safety-v1" : "strict-16-of-16",
      schedule: verified.attempt.schedule, completedGroups: runs, error,
      eventLedger: relative(ledgerEventsPath), eventCount: ledger.count(), eventHeadSha256: ledger.finalHash(),
      runnerSha256: hashFile(fileURLToPath(import.meta.url)), finishedAt: new Date().toISOString()
    };
    fs.closeSync(ledger.fd);
    writeSummary(summary);
  }
  if (error) throw new Error(error);
  return { status: finalStatus, attemptManifestSha256: verified.attemptManifestSha256, runs, ledger: relative(ledgerSummaryPath), events: relative(ledgerEventsPath) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseB8RunArgs(process.argv.slice(2));
    selectAttempt(args.attemptId, args.candidateId);
    if (args.verifyOnly) {
      const verified = verifyFreezeAndAttempt(args.manifestSha256);
      const binding = {
        canonicalSha256: verified.attempt.sourceSnapshot.manifestSha256,
        baseCaseManifestSha256: verified.sourceManifest.caseManifestSha256,
        derivedCaseManifestSha256: verified.caseManifestSha256
      };
      const alias = candidateId === "B8"
        ? buildControlledSourceAlias(verified.sourceManifest, binding)
        : buildCandidateSourceAlias(verified.sourceManifest, { ...binding, candidateId });
      const aliasBytes = candidateId === "B8" ? serializeControlledSourceAlias(alias) : serializeCandidateSourceAlias(alias);
      console.log(JSON.stringify({
        status: "candidate-run-inputs-verified", attemptId, candidateId, attemptManifestSha256: verified.attemptManifestSha256,
        caseManifestSha256: verified.caseManifestSha256, realCaseCount: verified.caseManifest.realCases.length,
        controlledCaseCount: verified.caseManifest.controlledCases.length, schedule: verified.attempt.schedule,
        controlledSourceAlias: {
          path: relative(controlledAliasPath), sha256: sha256(aliasBytes),
          canonicalCandidateSourceManifestSha256: verified.attempt.sourceSnapshot.manifestSha256,
          baseCaseManifestSha256: verified.sourceManifest.caseManifestSha256,
          derivedCaseManifestSha256: verified.caseManifestSha256
        },
        nextCommand: `node scripts/ai-scenario-eval/run-ai-common-failures-b8.mjs --attempt=${attemptId} --candidate=${candidateId} --manifest-sha256=${verified.attemptManifestSha256} --execute`
      }, null, 2));
    } else {
      const result = await runAiCommonFailuresB8(args);
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  }
}
