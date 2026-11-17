// Executes only the already-frozen interleaved schedule; parent agent owns real runs.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareAiCommonFailuresRuns } from "./prepare-ai-common-failures-runs.mjs";
import { assessExecutionCompletion, createAuthorizedAttempt, prepareAttemptProfile, probeLoopbackListen } from "./scenario-attempt-control.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evaluationRoot = path.join(root, ".cache/acceptance/ai-common-failures/v1");
const attemptId = "authorized-run-01";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hashFile = (filePath) => sha256(fs.readFileSync(filePath));

function safePath(relative) {
  const absolute = path.resolve(root, relative);
  const relativePath = path.relative(root, absolute);
  if (relativePath.startsWith(`..${path.sep}`) || relativePath === ".." || path.isAbsolute(relativePath)) throw new Error(`Evaluation path escaped plugin root: ${relative}`);
  for (let current = absolute; current !== root; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Evaluation refuses symlink paths: ${relative}`);
  }
  return absolute;
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }

function verifyInputs({ requireB7 = true } = {}) {
  const freezePath = path.join(evaluationRoot, "freeze-manifest.json");
  const freeze = readJson(freezePath);
  for (const [relative, expected] of Object.entries(freeze.files)) {
    const actual = safePath(path.relative(root, path.join(evaluationRoot, relative)));
    const bytes = fs.readFileSync(actual);
    if (sha256(bytes) !== expected.sha256 || bytes.byteLength !== expected.bytes) throw new Error(`Frozen input changed before run: ${relative}`);
  }
  const derivedPath = path.join(evaluationRoot, "run-inputs/derived-manifest.json");
  const derived = readJson(derivedPath);
  const casesPath = safePath(derived.casePath);
  if (hashFile(casesPath) !== derived.caseManifestSha256) throw new Error("Derived 80+7 case set hash mismatch.");
  const configPath = path.join(evaluationRoot, "config.json");
  const config = readJson(configPath);
  if (config.runtime.retries !== 0 || config.runtime.downloadsAllowed !== false || config.runtime.deploymentAllowed !== false || config.runtime.editorWriteback !== false) throw new Error("Frozen runtime policy permits an unsafe operation.");
  if (config.schedule?.length !== 2 || config.schedule.some((round) => round.length !== 4)) throw new Error("Expected the exact frozen two-round interleaved schedule.");
  const b7ManifestPath = path.join(evaluationRoot, "snapshots/B7/source-manifest.json");
  if (requireB7 && !fs.existsSync(b7ManifestPath)) throw new Error("Freeze the immutable B7 candidate before continuing the scheduled comparison.");
  if (fs.existsSync(b7ManifestPath)) {
    const b7Manifest = readJson(b7ManifestPath);
    if (b7Manifest.variant !== "B7" || b7Manifest.caseManifestSha256 !== derived.baseCaseManifestSha256) throw new Error("B7 snapshot is not bound to the original frozen 80-case source contract.");
  }
  const b6ManifestPath = path.join(evaluationRoot, "snapshots/B6/source-manifest.json");
  const b6Manifest = readJson(b6ManifestPath);
  if (b6Manifest.variant !== "B6" || b6Manifest.caseManifestSha256 !== derived.baseCaseManifestSha256) throw new Error("B6 snapshot is not bound to the original frozen 80-case source contract.");
  return { config, freeze, derived, b6ManifestPath, b7ManifestPath };
}

function sampleLlamaProcess(profile, localAiDirectory, stats, samples) {
  const statePath = path.join(localAiDirectory, "managed-server.json");
  if (!fs.existsSync(statePath)) return;
  try {
    const state = readJson(statePath);
    if (!Number.isSafeInteger(state.pid) || state.pid <= 0 || state.modelId !== profile.modelId || typeof state.runtimePath !== "string") return;
    const opts = { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] };
    const command = execFileSync("/bin/ps", ["-ww", "-p", String(state.pid), "-o", "comm="], opts).trim();
    if (command !== fs.realpathSync(state.runtimePath)) return;
    const rss = execFileSync("/bin/ps", ["-p", String(state.pid), "-o", "rss="], opts).trim();
    if (!/^\d+$/u.test(rss)) return;
    const rssKiB = Number(rss);
    stats.maxRssKiB = Math.max(stats.maxRssKiB, rssKiB);
    stats.samplesCollected += 1;
    if (samples.length < 6000) samples.push({ at: Date.now(), pid: state.pid, backend: state.backend ?? null, rssKiB });
  } catch { stats.measurementErrors += 1; }
}

function startChild(command, args, options) {
  const child = spawn(command, args, options);
  return { child, exit: new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); }) };
}

function writeLedger(config, derived, runs, attemptRoot) {
  const ledgerPath = path.join(attemptRoot, "execution-ledger.json");
  const temporaryPath = `${ledgerPath}.tmp`;
  const output = { schemaVersion: 1, evaluationId: config.evaluationId, attemptId, attemptManifestSha256: hashFile(path.join(attemptRoot, "attempt-manifest.json")), freezeManifestSha256: hashFile(path.join(evaluationRoot, "freeze-manifest.json")), derivedCaseManifestSha256: derived.caseManifestSha256, schedule: config.schedule, runs };
  fs.writeFileSync(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporaryPath, ledgerPath);
}

function expectedRunId(item, index) {
  const variant = item.variant === "B6" ? "b6" : "b7";
  const round = index < 4 ? "r1" : "r2";
  return `common-${variant}-${item.profile}-${round}`;
}

function loadCompletedPrefix(config, derived, flatSchedule, measurementRoot, attemptRoot) {
  const ledgerPath = path.join(attemptRoot, "execution-ledger.json");
  if (!fs.existsSync(ledgerPath)) {
    if (fs.existsSync(measurementRoot)) throw new Error("Run measurements exist without a ledger; refusing to infer progress or overwrite results.");
    return [];
  }
  const ledger = readJson(ledgerPath);
  if (JSON.stringify(ledger.schedule) !== JSON.stringify(config.schedule) || ledger.derivedCaseManifestSha256 !== derived.caseManifestSha256 || !Array.isArray(ledger.runs) || ledger.runs.length > flatSchedule.length) throw new Error("Existing run ledger is not bound to this frozen schedule.");
  for (let index = 0; index < ledger.runs.length; index += 1) {
    const run = ledger.runs[index];
    const expected = flatSchedule[index];
    if (run.runId !== expectedRunId(expected, index) || run.variant !== expected.variant || run.profile !== expected.profile || run.status !== "execution-complete") throw new Error(`Run ledger is not a fully completed schedule prefix at index ${index}; no retry or later run is allowed.`);
    if (!fs.existsSync(safePath(run.report)) || !fs.existsSync(safePath(run.measurement))) throw new Error(`Completed ledger entry ${run.runId} is missing its immutable evidence.`);
  }
  return ledger.runs;
}

function readRunRecords(runDirectory) {
  const recordsPath = path.join(runDirectory, "records");
  if (!fs.existsSync(recordsPath)) return [];
  return fs.readdirSync(recordsPath).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(recordsPath, name)));
}

async function runOne({ item, profile, profileConfig, b6ManifestPath, b7ManifestPath, measurementRoot, attemptRoot, scheduleIndex }) {
  const variantId = item.variant === "B6" ? "b6" : "b7";
  const roundId = scheduleIndex < 4 ? "r1" : "r2";
  const runId = `common-${variantId}-${profile.id}-${roundId}`;
  const config = readJson(profileConfig);
  const outputRoot = safePath(config.outputRoot);
  const runDirectory = path.join(outputRoot, `B-${runId}`);
  const runReportPath = path.join(runDirectory, "run-report.json");
  const logPath = path.join(measurementRoot, `${runId}.log`);
  const metricPath = path.join(measurementRoot, `${runId}.json`);
  for (const output of [runDirectory, logPath, metricPath]) if (fs.existsSync(output)) throw new Error(`Run output exists; refusing to overwrite: ${path.relative(root, output)}`);
  fs.mkdirSync(measurementRoot, { recursive: true });
  const sourceRoot = item.variant === "B6"
    ? path.join(evaluationRoot, "snapshots/B6/source")
    : path.join(evaluationRoot, "snapshots/B7/source");
  const sourceManifest = item.variant === "B6" ? b6ManifestPath : b7ManifestPath;
  const cli = path.join(root, "scripts/ai-scenario-eval/run-scenarios-v2.mjs");
  const logFd = fs.openSync(logPath, "wx");
  const samples = [];
  const stats = { maxRssKiB: 0, samplesCollected: 0, samplesStored: 0, measurementErrors: 0 };
  const localAiDirectory = safePath(config.localAiDirectory);
  let interval;
  let exit;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const args = [cli, "--variant=B", `--run=${runId}`, `--config=${profileConfig}`, `--source-root=${path.relative(root, sourceRoot)}`, `--source-manifest=${path.relative(root, sourceManifest)}`];
  try {
    const processHandle = startChild(process.execPath, args, { cwd: root, env: process.env, stdio: ["ignore", logFd, logFd] });
    interval = setInterval(() => sampleLlamaProcess(profile, localAiDirectory, stats, samples), 500);
    exit = await processHandle.exit;
  } finally {
    if (interval) clearInterval(interval);
    sampleLlamaProcess(profile, localAiDirectory, stats, samples);
    fs.closeSync(logFd);
    stats.samplesStored = samples.length;
    const metric = {
      schemaVersion: 1, evaluationId: "ai-common-failures-v1", runId, profile: profile.id, modelId: profile.modelId,
      variant: item.variant, scheduleIndex, startedAt, finishedAt: new Date().toISOString(), wallMs: Date.now() - started,
      exitCode: exit?.code ?? null, signal: exit?.signal ?? null, sampler: "separate-comm-and-rss-columns/exact-runtime-path-v1",
      ...stats, maxRssKiB: stats.samplesCollected ? stats.maxRssKiB : null, rssMeasurementAvailable: stats.samplesCollected > 0,
      samples, scope: "Sampled exact llama-server process RSS. Excludes editor, JS/Vite harness, GPU allocation and whole-system peak; zero samples is unavailable, not zero."
    };
    fs.writeFileSync(metricPath, `${JSON.stringify(metric, null, 2)}\n`, { flag: "wx" });
  }
  if (!fs.existsSync(runReportPath)) throw new Error(`Run report missing after runner exit; see ${path.relative(root, logPath)}.`);
  const report = readJson(runReportPath);
  const assessment = assessExecutionCompletion({ report, records: readRunRecords(runDirectory), exitCode: exit?.code, expectedCases: 87 });
  return {
    runId, variant: item.variant, profile: profile.id, status: assessment.status,
    statusReason: assessment.reason, successfulModelResponses: assessment.successfulResponses,
    evaluationStatus: report.status, expectedCases: report.expectedTotal, executedCases: report.executedTotal,
    strictPasses: report.summary?.scores?.strictIntent?.pass ?? null,
    userTaskPasses: report.summary?.scores?.userTask?.pass ?? null,
    report: path.relative(root, runReportPath).split(path.sep).join("/"), log: path.relative(root, logPath).split(path.sep).join("/"),
    measurement: path.relative(root, metricPath).split(path.sep).join("/"), cleanupErrors: report.cleanup?.errors ?? [],
    error: report.error ?? null, exitCode: exit?.code ?? null
  };
}

export async function runAiCommonFailuresV1(mode = "scheduled") {
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error(`Use Node 24; current runtime is ${process.version}`);
  if (mode === "prepare-authorized") {
    const { config, derived } = verifyInputs({ requireB7: false });
    const { attemptRoot, attemptManifestPath, manifest } = createAuthorizedAttempt({ pluginRoot: root, evaluationRoot, attemptId, config, derived });
    const originalProfileRoot = path.join(evaluationRoot, "profiles/b6-light");
    if (!fs.existsSync(originalProfileRoot)) prepareAiCommonFailuresRuns("prepare-b6-light");
    const profile = prepareAttemptProfile({
      pluginRoot: root,
      attemptRoot,
      sourceProfileRoot: originalProfileRoot,
      targetDirectory: "b6-light",
      outputProfileId: "light",
      localRuntimeDirectory: ".cache/acceptance/ai-model-comparison/v1/runtime/light",
      viteCacheDirectory: `.cache/vite-ai-common-failures-v1/${attemptId}/light`
    });
    return {
      status: "authorized-attempt-prepared",
      attemptId,
      attemptManifest: path.relative(root, attemptManifestPath).split(path.sep).join("/"),
      priorAttemptClassification: manifest.priorAttempt.classification,
      b6LightProfileConfig: path.relative(root, profile.configPath).split(path.sep).join("/"),
      nextCommand: "node scripts/ai-scenario-eval/run-ai-common-failures-v1.mjs --first-baseline"
    };
  }
  if (mode === "first-baseline") {
    const { config, derived, b6ManifestPath } = verifyInputs({ requireB7: false });
    const item = config.schedule[0]?.[0];
    if (!item || item.variant !== "B6" || item.profile !== "light") throw new Error("The frozen schedule no longer begins with B6/light.");
    const { attemptRoot } = createAuthorizedAttempt({ pluginRoot: root, evaluationRoot, attemptId, config, derived });
    const originalProfileRoot = path.join(evaluationRoot, "profiles/b6-light");
    if (!fs.existsSync(originalProfileRoot)) prepareAiCommonFailuresRuns("prepare-b6-light");
    prepareAttemptProfile({
      pluginRoot: root,
      attemptRoot,
      sourceProfileRoot: originalProfileRoot,
      targetDirectory: "b6-light",
      outputProfileId: "light",
      localRuntimeDirectory: ".cache/acceptance/ai-model-comparison/v1/runtime/light",
      viteCacheDirectory: `.cache/vite-ai-common-failures-v1/${attemptId}/light`
    });
    const profileConfigPath = path.join(attemptRoot, "profiles/b6-light/tool-source/config.json");
    const profileToolRoot = path.dirname(profileConfigPath);
    const profileConfigBytes = fs.readFileSync(profileConfigPath);
    const profileConfig = JSON.parse(profileConfigBytes.toString("utf8"));
    const profileManifest = readJson(path.join(path.dirname(profileToolRoot), "tool-manifest.json"));
    if (profileConfig.model.profileId !== "light" || profileConfig.model.modelId !== "Qwen3-0.6B-Q4_K_M.gguf" || profileConfig.model.retries !== 0 || profileConfig.model.deploymentAllowed !== false || profileManifest.configSha256 !== sha256(profileConfigBytes) || profileManifest.caseManifestSha256 !== derived.caseManifestSha256 || profileConfig.sourceVariants.B?.sourceManifest !== path.relative(root, b6ManifestPath).split(path.sep).join("/")) throw new Error("Existing B6/light run tool differs from its immutable frozen profile contract.");
    const measurementRoot = path.join(attemptRoot, "measurements");
    if (fs.existsSync(path.join(attemptRoot, "execution-ledger.json")) || fs.existsSync(measurementRoot)) throw new Error("This authorized attempt already contains run evidence; refusing to repeat or overwrite it.");
    const readiness = await probeLoopbackListen();
    if (!readiness.ok) {
      const run = { runId: expectedRunId(item, 0), variant: item.variant, profile: item.profile, status: "infrastructure-invalid", statusReason: `loopback-listen-${readiness.code ?? "failed"}`, successfulModelResponses: 0, preflight: readiness };
      writeLedger(config, derived, [run], attemptRoot);
      throw new Error(`Infrastructure preflight failed before model inference (${readiness.code ?? "listen failure"}): ${readiness.message}`);
    }
    const run = await runOne({ item, profile: config.profiles.find(({ id }) => id === item.profile), profileConfig: path.relative(root, profileConfigPath).split(path.sep).join("/"), b6ManifestPath, b7ManifestPath: null, measurementRoot, attemptRoot, scheduleIndex: 0 });
    writeLedger(config, derived, [run], attemptRoot);
    if (run.status !== "execution-complete") throw new Error(`First baseline ${run.runId} is ${run.status} (${run.statusReason}); schedule is stopped and will not retry it.`);
    return { status: "first-baseline-executed", runs: [run] };
  }
  if (mode !== "scheduled") throw new Error("Usage: run-ai-common-failures-v1.mjs [--prepare-authorized|--first-baseline]");
  const { config, derived, b6ManifestPath, b7ManifestPath } = verifyInputs();
  const { attemptRoot } = createAuthorizedAttempt({ pluginRoot: root, evaluationRoot, attemptId, config, derived });
  for (const id of ["light", "balanced"]) {
    const sourceProfileRoot = path.join(evaluationRoot, `profiles/${id}`);
    if (!fs.existsSync(sourceProfileRoot)) throw new Error(`Prepare the frozen B7/${id} profile before scheduling the authorized attempt.`);
    prepareAttemptProfile({
      pluginRoot: root, attemptRoot, sourceProfileRoot, targetDirectory: id, outputProfileId: id,
      localRuntimeDirectory: `.cache/acceptance/ai-model-comparison/v1/runtime/${id}`,
      viteCacheDirectory: `.cache/vite-ai-common-failures-v1/${attemptId}/${id}`
    });
  }
  const profileConfigs = Object.fromEntries(["light", "balanced"].map((id) => {
    const profile = readJson(path.join(attemptRoot, `profiles/${id}/tool-source/config.json`));
    const relative = path.relative(root, path.join(attemptRoot, `profiles/${id}/tool-source/config.json`)).split(path.sep).join("/");
    if (profile.model.profileId !== id || profile.model.retries !== 0 || profile.model.deploymentAllowed !== false) throw new Error(`Invalid frozen ${id} run config.`);
    return [id, relative];
  }));
  if (hashFile(path.join(evaluationRoot, "run-inputs/case-manifest.json")) !== derived.caseManifestSha256) throw new Error("Frozen derived case set changed.");
  const measurementRoot = path.join(attemptRoot, "measurements");
  const flatSchedule = config.schedule.flat();
  const runs = loadCompletedPrefix(config, derived, flatSchedule, measurementRoot, attemptRoot);
  for (let index = runs.length; index < flatSchedule.length; index += 1) {
    const item = flatSchedule[index];
    const profile = config.profiles.find(({ id }) => id === item.profile);
    if (!profile || !profileConfigs[item.profile]) throw new Error(`Schedule contains unknown profile: ${item.profile}`);
    const running = { runId: expectedRunId(item, index), variant: item.variant, profile: item.profile, status: "running" };
    writeLedger(config, derived, [...runs, running], attemptRoot);
    const readiness = await probeLoopbackListen();
    if (!readiness.ok) {
      const failed = { ...running, status: "infrastructure-invalid", statusReason: `loopback-listen-${readiness.code ?? "failed"}`, successfulModelResponses: 0, preflight: readiness };
      runs.push(failed);
      writeLedger(config, derived, runs, attemptRoot);
      throw new Error(`Infrastructure preflight failed before ${failed.runId} inference (${readiness.code ?? "listen failure"}): ${readiness.message}`);
    }
    const result = await runOne({ item, profile, profileConfig: profileConfigs[item.profile], b6ManifestPath, b7ManifestPath, measurementRoot, attemptRoot, scheduleIndex: index });
    runs.push(result);
    const reportPath = safePath(result.report);
    const report = readJson(reportPath);
    writeLedger(config, derived, runs, attemptRoot);
    if (result.status !== "execution-complete" || report.executedTotal !== 87) throw new Error(`Stopped after incomplete ${result.runId}; no later profile may overlap it.`);
  }
  return { status: "all-scheduled-runs-executed", runs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.length === 3 && process.argv[2] === "--first-baseline" ? "first-baseline" : process.argv.length === 3 && process.argv[2] === "--prepare-authorized" ? "prepare-authorized" : process.argv.length === 2 ? "scheduled" : "invalid";
  runAiCommonFailuresV1(mode).then((value) => console.log(JSON.stringify(value, null, 2))).catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
