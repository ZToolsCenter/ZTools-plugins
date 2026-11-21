import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";
import { evaluateItem } from "./scenario-inference.mjs";
import { auditModuleGraph } from "./module-graph-audit.mjs";
import { readSourceManifest, sha256, verifyFrozenSource } from "./freeze-source.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, "../..");
const acceptanceRoot = path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v1");
const localAiDirectory = path.join(pluginRoot, ".cache/acceptance/local-ai");
const frozenRoot = path.join(acceptanceRoot, "source");
const caseManifestPath = path.join(acceptanceRoot, "case-manifest.json");
const oraclePath = path.join(frozenRoot, "scripts/ai-scenario-eval/scenario-oracles.mjs");
const profileId = "light";
const modelId = "Qwen3-0.6B-Q4_K_M.gguf";
const RUNNER_MAX_DURATION_MS = 90_000;
const HARNESS_WALL_TIMEOUT_MS = 90_000;
const APPLICATION_DEFAULT_MAX_DURATION_MS = 300_000;
const MAX_CALLS = 64;

function assertNoSymlinkPath(target) {
  const absolute = path.resolve(target);
  const relative = path.relative(pluginRoot, absolute);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`Scenario harness path escaped the plugin directory: ${target}`);
  }
  let current = absolute;
  while (current !== pluginRoot) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Scenario harness refuses symlink path components: ${path.relative(pluginRoot, current)}`);
    }
    current = path.dirname(current);
  }
}

function errorValue(error) {
  return { name: error?.name ?? "Error", code: error?.code ?? null, message: String(error?.message ?? error) };
}

function nowIso() {
  return new Date().toISOString();
}

function parseRunId(argv) {
  const argument = argv.find((value) => value.startsWith("--run="));
  const runId = argument?.slice("--run=".length);
  if (!runId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/u.test(runId)) {
    throw new Error("Usage: node scripts/ai-scenario-eval/run-scenarios.mjs --run=001");
  }
  if (argv.some((value) => value !== argument)) throw new Error("Only the --run=<id> argument is supported.");
  return runId;
}

function recordDirectory(runId) {
  return path.join(acceptanceRoot, `run-${runId}`);
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "w" });
  fs.renameSync(temporary, filePath);
}

function writeCaseRecord(directory, record) {
  const recordsDirectory = path.join(directory, "records");
  const filePath = path.join(recordsDirectory, `${record.id}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
}

function summarize(report) {
  const outcomes = { passed: 0, failed: 0, blocked: 0, not_run: 0 };
  for (const item of report.cases) outcomes[item.status] = (outcomes[item.status] ?? 0) + 1;
  return { executed: report.cases.length, outcomes };
}

function refreshCoverage(report, expectedIds) {
  const executedIds = new Set(report.cases.map((item) => item.id));
  report.executedTotal = executedIds.size;
  report.missingCaseIds = expectedIds.filter((id) => !executedIds.has(id));
  report.summary = summarize(report);
}

function normalizeStatus(record, evaluation) {
  if (record.harnessTimedOut || record.runnerDeadlineExceeded || evaluation?.outcome === "blocked") return "blocked";
  if (evaluation?.outcome === "not_run" || evaluation?.outcome === "not-run") return "not_run";
  if (evaluation?.passed === true) return "passed";
  if (evaluation?.passed === false) return "failed";
  if (evaluation?.outcome === "passed" || evaluation?.outcome === "pass") return "passed";
  if (evaluation?.outcome === "failed" || evaluation?.outcome === "fail") return "failed";
  return "not_run";
}

function snapshotFor(item) {
  const snapshot = {
    documentId: `scenario-${item.id}`,
    revision: 1,
    content: item.source,
    selection: item.selection ?? null,
    cursor: item.cursor ?? null,
    readOnly: item.readOnly ?? false
  };
  if (Object.hasOwn(item, "selectionValid")) snapshot.selectionValid = item.selectionValid;
  return snapshot;
}

function observeManagedServer() {
  const file = path.join(localAiDirectory, "managed-server.json");
  if (!fs.existsSync(file)) return { present: false, pid: null, alive: false };
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    const pid = Number.isInteger(state.pid) ? state.pid : null;
    let alive = false;
    if (pid) {
      try { process.kill(pid, 0); alive = true; }
      catch (error) { alive = error?.code === "EPERM"; }
    }
    return { present: true, pid, alive };
  } catch {
    return { present: true, pid: null, alive: false };
  }
}

function buildRequest(item) {
  return {
    source: item.source,
    action: "custom",
    userPrompt: item.instruction,
    baseSystemPrompt: "你是中文 Markdown 助手。按用户的编辑意图和指定范围处理；没有编辑计划时不要修改文档。只输出计划所需内容。",
    actionDefinition: { id: "custom", label: "场景验证", prompt: item.instruction },
    ...(item.granularity ? { granularity: item.granularity } : {})
  };
}

async function loadRunModules(server) {
  const planned = await server.ssrLoadModule("/src/core/ai/plannedTaskRunner.ts");
  const edit = await server.ssrLoadModule("/src/core/ai/editProposal.ts");
  const integrity = await server.ssrLoadModule("/src/core/ai/markdownAstIntegrity.ts");
  const schema = await server.ssrLoadModule("/src/core/ai/intentSchema.ts");
  const planner = await server.ssrLoadModule("/src/core/ai/intentPlanner.ts");
  const context = await server.ssrLoadModule("/src/core/ai/intentContext.ts");
  const modules = {
    ...planned, ...edit, ...integrity, ...schema, ...planner, ...context,
    plannedTaskRunner: planned, editProposal: edit, markdownAstIntegrity: integrity,
    intentSchema: schema, intentPlanner: planner, intentContext: context
  };
  const required = [
    "runPlannedAiTask", "resolveAiEdit", "isAiProposalCurrent", "validateMarkdownAstIntegrity",
    "validateMarkdownFragmentCompleteness", "parseIntentOutput", "planAiIntent", "buildAiIntentCandidates"
  ];
  const missing = required.filter((name) => typeof modules[name] !== "function");
  if (missing.length) throw new Error(`Frozen production source is missing required exports: ${missing.join(", ")}`);
  return modules;
}

async function replayPlanner(item, record, modules) {
  const planningCall = record.calls.find((call) => call.phase === "planning" && typeof call.raw === "string");
  if (!planningCall) {
    record.plannerError = { name: "ReplayUnavailable", code: null, message: "No actual planning response was captured." };
    return;
  }
  const selected = Boolean(record.snapshot.selection && record.snapshot.selection.to > record.snapshot.selection.from);
  const candidates = modules.buildAiIntentCandidates(item.instruction, item.source);
  record.candidates = candidates;
  try {
    record.rawParsedIntent = modules.parseIntentOutput(planningCall.raw, item.instruction, candidates);
  } catch (error) {
    record.rawParsedError = errorValue(error);
  }
  let replayCalls = 0;
  const invoke = Object.assign(async () => {
    replayCalls += 1;
    if (replayCalls !== 1) throw new Error("Planner replay attempted to consume more than the captured first response.");
    return planningCall.raw;
  }, { abort() {} });
  try {
    record.plannerIntent = await modules.planAiIntent(item.instruction, selected, candidates, invoke);
    record.plannerReplayCalls = replayCalls;
  } catch (error) {
    record.plannerError = errorValue(error);
    record.plannerReplayCalls = replayCalls;
  }
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error(`Use Node 24; current runtime is ${process.version}`);
  const runId = parseRunId(process.argv.slice(2));
  const outputDirectory = recordDirectory(runId);
  assertNoSymlinkPath(outputDirectory);
  assertNoSymlinkPath(localAiDirectory);
  assertNoSymlinkPath(path.join(pluginRoot, ".cache/vite-ai-scenario-eval-v1"));
  if (fs.existsSync(outputDirectory)) throw new Error(`Run directory already exists; refusing to overwrite: ${path.relative(pluginRoot, outputDirectory)}`);

  const caseManifest = JSON.parse(fs.readFileSync(caseManifestPath, "utf8"));
  if (!Array.isArray(caseManifest.realCases) || !caseManifest.realCases.length) {
    throw new Error("Case manifest must contain at least one real model scenario.");
  }
  const expectedCaseIds = caseManifest.realCases.map((item, index) =>
    typeof item?.id === "string" ? item.id : `invalid-case-${index + 1}`
  );

  fs.mkdirSync(outputDirectory, { recursive: false });
  fs.mkdirSync(path.join(outputDirectory, "records"), { recursive: false });
  const report = {
    schemaVersion: 1,
    runId,
    caseSetId: caseManifest.caseSetId ?? "v1",
    status: "running",
    startedAt: nowIso(),
    node: process.version,
    model: null,
    expectedTotal: caseManifest.realCases.length,
    executedTotal: 0,
    missingCaseIds: expectedCaseIds,
    sourceFreeze: null,
    caseManifestSha256: sha256(fs.readFileSync(caseManifestPath)),
    execution: {
      mode: "sequential-real-managed-inference",
      retries: 0,
      maxCallsPerCase: MAX_CALLS,
      runnerMaxDurationMs: RUNNER_MAX_DURATION_MS,
      harnessWallTimeoutMs: HARNESS_WALL_TIMEOUT_MS,
      applicationDefaultMaxDurationMs: APPLICATION_DEFAULT_MAX_DURATION_MS,
      timeoutClassification: "runner deadline and independent harness timeout are blocked, never semantic failures"
    },
    editorWriteback: { performed: false, note: "Proposals are evaluated in memory; no harness proposal is applied to the host editor." },
    cases: [],
    summary: null
  };
  const reportPath = path.join(outputDirectory, "run-report.json");
  refreshCoverage(report, expectedCaseIds);
  atomicJson(reportPath, report);

  let sourceManifest = null;
  let server = null;
  let service = null;
  let frozenRequire = null;
  const serviceRunState = { inferenceSeen: false, lastPid: null };
  let finalError = null;
  try {
    if (caseManifest.schemaVersion !== 1) throw new Error("Unsupported case manifest schema version.");
    const caseIds = new Set();
    for (const item of caseManifest.realCases) {
      if (!item || typeof item.id !== "string" || caseIds.has(item.id) || typeof item.instruction !== "string" || typeof item.source !== "string") {
        throw new Error("Each real case must have a unique id, instruction, and source string.");
      }
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u.test(item.id)) throw new Error(`Unsafe case id: ${item.id}`);
      caseIds.add(item.id);
    }
    sourceManifest = readSourceManifest();
    verifyFrozenSource({ manifest: sourceManifest });
    report.inputCodeStableBeforeRun = true;
    if (!fs.existsSync(oraclePath)) throw new Error("Frozen scenario-oracles.mjs is missing.");
    report.sourceFreeze = {
      manifestSha256: sha256(fs.readFileSync(path.join(acceptanceRoot, "source-manifest.json"))),
      fileCount: sourceManifest.paths.length,
      harnessPaths: sourceManifest.paths.filter((item) => item.startsWith("scripts/ai-scenario-eval/") || item === "scripts/ai-replace-intent-local-runtime.mjs")
    };
    const helperPath = path.join(frozenRoot, "scripts/ai-replace-intent-local-runtime.mjs");
    const { assertCachedLightProfile } = await import(pathToFileURL(helperPath));
    if (typeof assertCachedLightProfile !== "function") throw new Error("Frozen light-profile cache guard is missing.");

    server = await createServer({
      root: frozenRoot,
      configFile: false,
      server: { middlewareMode: true, hmr: false, ws: false },
      cacheDir: path.join(pluginRoot, ".cache/vite-ai-scenario-eval-v1")
    });
    frozenRequire = createRequire(path.join(frozenRoot, "preload/local-ai/service.cjs"));
    const serviceModule = frozenRequire("./service.cjs");
    if (typeof serviceModule?.createLocalAiService !== "function") throw new Error("Frozen local AI service could not be loaded.");
    service = serviceModule.createLocalAiService({ dataDirectory: localAiDirectory });
    const transport = frozenRequire("./http-transport.cjs");
    const { evaluateScenario } = await import(pathToFileURL(oraclePath));
    if (typeof evaluateScenario !== "function") throw new Error("Frozen scenario-oracles.mjs must export evaluateScenario(item, record, modules).");
    report.model = await assertCachedLightProfile({ service, localAiDirectory, profileId, modelId, hash: sha256 });
    const modules = await loadRunModules(server);
    const graphOptions = {
      server,
      pluginRoot,
      frozenRoot,
      sourceManifest,
      viteResolvedPath: import.meta.resolve("vite"),
      frozenRequire
    };
    report.moduleGraphBefore = auditModuleGraph(graphOptions);
    report.loadedModules = report.moduleGraphBefore.loadedSourceModules;

    for (const item of caseManifest.realCases) {
      const snapshot = snapshotFor(item);
      const record = {
        id: item.id,
        family: item.family ?? "unspecified",
        title: item.title ?? item.id,
        instruction: item.instruction,
        expected: item.expected,
        snapshot,
        sourceSha256: sha256(item.source),
        calls: [],
        result: null,
        resolvedEdit: null,
        error: null,
        plannerIntent: null,
        plannerError: null,
        rawParsedIntent: null,
        rawParsedError: null,
        progress: [],
        elapsedMs: null,
        harnessTimedOut: false,
        runnerDeadlineExceeded: false,
        inputSnapshotUnchanged: true,
        managedServerPresentBefore: observeManagedServer()
      };
      const caseStarted = Date.now();
      try {
        await evaluateItem({
          request: buildRequest(item), snapshot, modules, service, transport, plan: report.model,
          record, serviceRunState, observeManagedServer, sha256, maxCalls: MAX_CALLS,
          maxDurationMs: RUNNER_MAX_DURATION_MS, harnessTimeoutMs: HARNESS_WALL_TIMEOUT_MS
        });
      } catch (error) {
        record.error = errorValue(error);
        if (error?.name === "AiTaskDeadlineError") {
          record.runnerDeadlineExceeded = true;
          record.timeoutKind = "runner_max_duration_budget";
        }
      }
      record.elapsedMs = Date.now() - caseStarted;
      record.serviceSequence = record.calls[0]?.startupClass ?? (report.cases.length === 0 ? "no-inference" : "subsequent-no-inference");
      record.inputSnapshotUnchanged = record.snapshot.content === item.source && record.sourceSha256 === sha256(item.source);
      if (record.calls.some((call) => call.phase === "planning" && typeof call.raw === "string")) {
        await replayPlanner(item, record, modules);
      } else {
        record.plannerError = { name: "ReplayUnavailable", code: null, message: "No completed planner output was captured; replay skipped." };
      }
      try {
        record.evaluation = await evaluateScenario(item, record, modules);
        record.status = normalizeStatus(record, record.evaluation);
      } catch (error) {
        record.oracleError = errorValue(error);
        record.status = record.harnessTimedOut || record.runnerDeadlineExceeded ? "blocked" : "not_run";
      }
      report.cases.push({ id: item.id, family: record.family, status: record.status, elapsedMs: record.elapsedMs, actualCalls: record.calls.length });
      writeCaseRecord(outputDirectory, record);
      refreshCoverage(report, expectedCaseIds);
      atomicJson(reportPath, report);
      console.log(JSON.stringify({ id: item.id, status: record.status, calls: record.calls.length, elapsedMs: record.elapsedMs, outcome: record.evaluation?.outcome ?? null }));
    }
  } catch (error) {
    finalError = errorValue(error);
  } finally {
    if (server && frozenRequire && sourceManifest) {
      try {
        report.moduleGraphAfter = auditModuleGraph({
          server,
          pluginRoot,
          frozenRoot,
          sourceManifest,
          viteResolvedPath: import.meta.resolve("vite"),
          frozenRequire
        });
        const beforePaths = new Set(report.moduleGraphBefore?.modulePaths ?? []);
        const beforeRequirePaths = new Set(report.moduleGraphBefore?.nodeRequireCachePaths ?? []);
        report.moduleGraphChanges = {
          addedViteModules: report.moduleGraphAfter.modulePaths.filter((item) => !beforePaths.has(item)),
          addedNodeRequireModules: report.moduleGraphAfter.nodeRequireCachePaths.filter((item) => !beforeRequirePaths.has(item))
        };
      } catch (error) {
        report.moduleGraphAuditError = errorValue(error);
        finalError ??= report.moduleGraphAuditError;
      }
    }
    if (service) {
      try { await service.release(); }
      catch (error) { report.releaseError = errorValue(error); finalError ??= report.releaseError; }
    }
    if (server) await server.close();
  }

  if (sourceManifest) {
    try {
      verifyFrozenSource({ manifest: sourceManifest });
      report.inputCodeStableAfterRun = true;
    } catch (error) {
      report.inputCodeStableAfterRun = false;
      report.sourceDrift = errorValue(error);
      finalError ??= report.sourceDrift;
    }
  } else {
    report.inputCodeStableAfterRun = false;
  }
  try {
    report.caseManifestStableAfterRun = sha256(fs.readFileSync(caseManifestPath)) === report.caseManifestSha256;
    if (!report.caseManifestStableAfterRun) finalError ??= { name: "SourceDrift", code: null, message: "Scenario case manifest changed while the evaluation was running." };
  } catch (error) {
    report.caseManifestStableAfterRun = false;
    finalError ??= errorValue(error);
  }
  if (finalError) report.error = finalError;
  refreshCoverage(report, expectedCaseIds);
  report.finishedAt = nowIso();
  report.status = finalError ? "failed" : report.summary.outcomes.blocked ? "blocked" : report.summary.outcomes.failed ? "failed" : report.missingCaseIds.length || report.summary.outcomes.not_run ? "incomplete" : "passed";
  atomicJson(reportPath, report);
  console.log(JSON.stringify({ status: report.status, expectedTotal: report.expectedTotal, executedTotal: report.executedTotal, missingCaseIds: report.missingCaseIds, summary: report.summary }));
  if (report.status !== "passed") process.exitCode = 1;
}
main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
