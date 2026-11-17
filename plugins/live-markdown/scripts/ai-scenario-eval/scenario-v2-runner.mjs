import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import { evaluateItem } from "./scenario-inference.mjs";
import { auditModuleGraph } from "./module-graph-audit.mjs";
import { evaluateScenarioV2 } from "./scenario-v2-oracles.mjs";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function errorValue(error) {
  return { name: error?.name ?? "Error", code: error?.code ?? null, message: String(error?.message ?? error) };
}

function isoNow() { return new Date().toISOString(); }

function within(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertRegularSnapshotFile(root, relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes("..")) throw new Error(`Unsafe snapshot manifest path: ${relative}`);
  const absolute = path.resolve(root, relative);
  if (!within(root, absolute) || !fs.existsSync(absolute)) throw new Error(`Snapshot manifest file is missing or escaped: ${relative}`);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Snapshot manifest entry is not a regular file: ${relative}`);
  return absolute;
}

function walkFiles(root, current = root, result = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Frozen snapshot contains a symlink: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) walkFiles(root, absolute, result);
    else if (entry.isFile()) result.push(path.relative(root, absolute).split(path.sep).join("/"));
    else throw new Error(`Frozen snapshot contains a non-regular file: ${path.relative(root, absolute)}`);
  }
  return result.sort();
}

function verifySnapshotOnly(root, manifest) {
  if (!manifest || !Array.isArray(manifest.paths) || typeof manifest.files !== "object") throw new Error("Invalid source snapshot manifest.");
  const actualPaths = walkFiles(root);
  const expectedPaths = [...manifest.paths].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw new Error("Frozen source snapshot file set differs from its manifest.");
  const hashes = {};
  for (const relative of expectedPaths) {
    const filePath = assertRegularSnapshotFile(root, relative);
    const bytes = fs.readFileSync(filePath);
    hashes[relative] = { sha256: sha256(bytes), bytes: bytes.byteLength };
    if (hashes[relative].sha256 !== manifest.files[relative]?.sha256) throw new Error(`Frozen source snapshot hash mismatch: ${relative}`);
  }
  return hashes;
}

function verifyToolSnapshot(pluginRoot, toolRoot, config, toolManifest) {
  if (toolManifest.schemaVersion !== 2 || toolManifest.configSha256 !== sha256(fs.readFileSync(path.join(toolRoot, "config.json")))) throw new Error("Frozen v2 tool configuration hash mismatch.");
  const actualPaths = walkFiles(toolRoot);
  if (JSON.stringify(actualPaths) !== JSON.stringify([...toolManifest.paths].sort())) throw new Error("Frozen v2 tool file set differs from its manifest.");
  for (const relative of actualPaths) {
    const filePath = assertRegularSnapshotFile(toolRoot, relative);
    if (sha256(fs.readFileSync(filePath)) !== toolManifest.files[relative]?.sha256) throw new Error(`Frozen v2 tool hash mismatch: ${relative}`);
  }
  for (const [relative, expected] of Object.entries(toolManifest.bootstrap ?? {})) {
    const bootstrapPath = path.resolve(pluginRoot, relative);
    if (!within(pluginRoot, bootstrapPath) || !fs.existsSync(bootstrapPath) || sha256(fs.readFileSync(bootstrapPath)) !== expected.sha256) throw new Error(`v2 bootstrap changed after freeze: ${relative}`);
  }
  const casePath = path.resolve(toolRoot, config.caseSets[toolManifest.caseSetId]);
  if (!within(toolRoot, casePath) || sha256(fs.readFileSync(casePath)) !== toolManifest.caseManifestSha256) throw new Error("Frozen v2 case-set hash mismatch.");
  return actualPaths;
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "w" });
  fs.renameSync(temporary, filePath);
}

function writeRecord(directory, record) {
  fs.writeFileSync(path.join(directory, "records", `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
}

async function boundedCleanupStep(operation, waitMs) {
  let timer;
  const settled = Promise.resolve().then(operation).then(
    (value) => ({ status: "completed", value }),
    (error) => ({ status: "failed", error: errorValue(error) })
  );
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ status: "timed_out" }), waitMs);
  });
  return Promise.race([settled, deadline]).finally(() => clearTimeout(timer));
}

export async function cleanupRunnerResources({
  report, service, requestServer, server, auditModuleGraph, waitMs = 10_000
}) {
  const cleanup = report.cleanup ??= {
    policy: "release-only",
    modelResourcesRemoved: false,
    modelResourcesRetained: true,
    note: "Cleanup releases the managed service and closes harness servers; downloaded model files are retained.",
    steps: [], errors: []
  };
  const stages = [
    ["module_graph_audit", auditModuleGraph, "moduleGraphAuditError", (value) => { report.moduleGraphAfter = value; }],
    ["service_release", service ? () => service.release() : null, "releaseError"],
    ["request_server_close", requestServer ? () => requestServer.close() : null, "requestServerCloseError"],
    ["vite_server_close", server ? () => server.close() : null, "serverCloseError"]
  ];
  let firstError = null;
  for (const [name, operation, errorField, onSuccess] of stages) {
    if (!operation) continue;
    const result = await boundedCleanupStep(operation, waitMs);
    if (result.status === "completed") {
      onSuccess?.(result.value);
      cleanup.steps.push({ name, status: result.status });
      continue;
    }
    const error = result.status === "timed_out"
      ? { name: "CleanupTimeoutError", code: "cleanup_timeout", message: `${name} did not finish within ${waitMs} ms.` }
      : result.error;
    report[errorField] = error;
    const failure = { name, status: result.status, error };
    cleanup.steps.push(failure);
    cleanup.errors.push(failure);
    firstError ??= error;
  }
  return firstError;
}

function snapshotFor(item) {
  const snapshot = {
    documentId: `scenario-${item.id}`, revision: 1, content: item.source,
    selection: item.selection ?? null, cursor: item.cursor ?? null, readOnly: item.readOnly ?? false
  };
  if (Object.hasOwn(item, "selectionValid")) snapshot.selectionValid = item.selectionValid;
  return snapshot;
}

function assertCaseManifest(manifest, caseSetId) {
  if (manifest.schemaVersion !== 1 || manifest.caseSetId !== caseSetId || !Array.isArray(manifest.realCases) || !Array.isArray(manifest.controlledCases)) {
    throw new Error("Frozen case manifest does not match the selected case set.");
  }
  const ids = new Set();
  for (const item of manifest.realCases) {
    if (!item || typeof item.id !== "string" || ids.has(item.id) || typeof item.source !== "string" || typeof item.instruction !== "string") throw new Error("Case set contains a missing or duplicate real case.");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u.test(item.id)) throw new Error(`Unsafe case id: ${item.id}`);
    ids.add(item.id);
  }
  if (ids.size !== 80 || manifest.controlledCases.length !== 16) throw new Error("The frozen comparison case set must retain the original 80 real and 16 controlled cases.");
}

function observeManagedServer(localAiDirectory) {
  const statePath = path.join(localAiDirectory, "managed-server.json");
  if (!fs.existsSync(statePath)) return { present: false, pid: null, alive: false };
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const pid = Number.isInteger(state.pid) ? state.pid : null;
    let alive = false;
    if (pid) { try { process.kill(pid, 0); alive = true; } catch (error) { alive = error?.code === "EPERM"; } }
    return { present: true, pid, alive };
  } catch { return { present: true, pid: null, alive: false }; }
}

async function loadProductModules(server) {
  const planned = await server.ssrLoadModule("/src/core/ai/plannedTaskRunner.ts");
  const edit = await server.ssrLoadModule("/src/core/ai/editProposal.ts");
  const integrity = await server.ssrLoadModule("/src/core/ai/markdownAstIntegrity.ts");
  const schema = await server.ssrLoadModule("/src/core/ai/intentSchema.ts");
  const planner = await server.ssrLoadModule("/src/core/ai/intentPlanner.ts");
  const context = await server.ssrLoadModule("/src/core/ai/intentContext.ts");
  const modules = { ...planned, ...edit, ...integrity, ...schema, ...planner, ...context };
  const required = ["runPlannedAiTask", "resolveAiEdit", "isAiProposalCurrent", "validateMarkdownAstIntegrity", "validateMarkdownFragmentCompleteness", "validateMarkdownAppendIntegrity", "parseIntentOutput", "planAiIntent", "buildAiIntentCandidates"];
  const missing = required.filter((name) => typeof modules[name] !== "function");
  if (missing.length) throw new Error(`Frozen product snapshot is missing required exports: ${missing.join(", ")}`);
  return modules;
}

export async function replayPlanner(item, record, modules) {
  const planning = record.calls.find(({ phase, raw }) => phase === "planning" && typeof raw === "string");
  if (!planning) { record.plannerError = { name: "ReplayUnavailable", code: null, message: "No captured planner response." }; return; }
  const candidates = modules.buildAiIntentCandidates(item.instruction, item.source);
  record.candidates = candidates;
  try { record.rawParsedIntent = modules.parseIntentOutput(planning.raw, item.instruction, candidates); }
  catch (error) { record.rawParsedError = errorValue(error); }
  let callsMade = 0;
  const invoke = Object.assign(async () => {
    callsMade += 1;
    if (callsMade !== 1) throw new Error("Frozen planner replay may consume only the captured first response.");
    return planning.raw;
  }, { abort() {} });
  try { record.plannerIntent = await modules.planAiIntent(item.instruction, Boolean(record.snapshot.selection && record.snapshot.selection.to > record.snapshot.selection.from), candidates, invoke); }
  catch (error) { record.plannerError = errorValue(error); }
  record.plannerReplayCalls = callsMade;
}

function summarize(report) {
  const status = { passed: 0, failed: 0, blocked: 0, not_run: 0 };
  const layers = ["strictIntent", "userTask", "quality", "range", "safety", "callBudget", "userTaskQualityRangeScore"];
  const scores = Object.fromEntries(layers.map((name) => [name, { pass: 0, fail: 0, notApplicable: 0 }]));
  for (const item of report.cases) {
    status[item.status] = (status[item.status] ?? 0) + 1;
    for (const name of layers) {
      const value = name === "userTaskQualityRangeScore" ? item.evaluation?.userTaskQualityRangeScore : item.evaluation?.[name];
      if (!value || value.pass === null) scores[name].notApplicable += 1;
      else if (value.pass) scores[name].pass += 1;
      else scores[name].fail += 1;
    }
  }
  return { executed: report.cases.length, status, scores };
}

function requestFor(item, buildAiTaskRequest, config) {
  const selected = Boolean(item.selection && item.selection.to > item.selection.from);
  const request = buildAiTaskRequest({
    source: item.source,
    selected,
    action: "custom",
    userPrompt: item.instruction,
    config: { provider: config.model.provider, activeRoleId: config.model.activeRoleId, customSystemPrompt: config.model.customSystemPrompt }
  });
  if (item.granularity !== undefined) request.granularity = item.granularity;
  if (request.source !== item.source || request.scope !== (selected ? "selection" : "document") || request.userPrompt !== item.instruction) {
    throw new Error(`${item.id}: shared request builder did not preserve source, selection, and instruction inputs.`);
  }
  if (item.granularity !== undefined && request.granularity !== item.granularity) throw new Error(`${item.id}: explicit fixture granularity override was not preserved.`);
  return request;
}

function dependencyMetadata(moduleGraph, sourceManifest, sourceRoot, pluginRoot) {
  const lock = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package-lock.json"), "utf8"));
  const fromLock = (name) => {
    const entry = lock.packages?.[`node_modules/${name}`];
    return entry ? { version: entry.version ?? null, resolved: entry.resolved ?? null, integrity: entry.integrity ?? null } : null;
  };
  const dependencies = moduleGraph?.dependencies ?? {};
  return {
    dependencyRoot: path.join(pluginRoot, "node_modules"),
    packageJsonSha256: sourceManifest.files["package.json"]?.sha256 ?? null,
    packageLockSha256: sourceManifest.files["package-lock.json"]?.sha256 ?? null,
    vite: { runtime: dependencies.vite ?? null, lock: fromLock("vite") },
    markdownParser: { runtime: dependencies["@lezer/markdown"] ?? null, lock: fromLock("@lezer/markdown") }
  };
}

export async function runRealScenariosV2({ pluginRoot, options, resolved }) {
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error(`Use Node 24; current runtime is ${process.version}`);
  const limits = resolved.config.limits;
  for (const [name, value] of Object.entries({
    maxCallsPerCase: limits?.maxCallsPerCase,
    runnerDeadlineMs: limits?.runnerDeadlineMs,
    independentHarnessDeadlineMs: limits?.independentHarnessDeadlineMs
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Frozen config limit ${name} must be a positive integer.`);
  }
  if (resolved.config.model?.provider !== "local" || resolved.config.model?.retries !== 0 || resolved.config.model?.deploymentAllowed !== false) {
    throw new Error("Frozen config must use the local provider with retries disabled and deployment prohibited.");
  }
  const toolRoot = resolved.toolRoot;
  const toolManifestBytes = fs.readFileSync(resolved.toolManifestPath);
  const toolManifest = JSON.parse(toolManifestBytes.toString("utf8"));
  const toolPaths = verifyToolSnapshot(pluginRoot, toolRoot, resolved.config, toolManifest);
  const caseBytes = fs.readFileSync(resolved.caseManifestPath);
  const caseManifest = JSON.parse(caseBytes.toString("utf8"));
  assertCaseManifest(caseManifest, resolved.caseSetId);
  const sourceManifestBytes = fs.readFileSync(resolved.sourceManifestPath);
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  if (sourceManifest.caseManifestSha256 !== sha256(caseBytes)) throw new Error("Selected source snapshot is not bound to the frozen v2 case set.");
  const verifiedBefore = verifySnapshotOnly(resolved.sourceRoot, sourceManifest);
  if (fs.existsSync(resolved.runDirectory)) throw new Error(`Run already exists; refusing to overwrite: ${path.relative(pluginRoot, resolved.runDirectory)}`);
  fs.mkdirSync(resolved.outputRoot, { recursive: true });
  fs.mkdirSync(resolved.runDirectory, { recursive: false });
  fs.mkdirSync(path.join(resolved.runDirectory, "records"), { recursive: false });

  const report = {
    schemaVersion: 2, evaluationId: resolved.config.evaluationId, runId: options.runId, variant: options.variant,
    caseSetId: resolved.caseSetId, status: "running", startedAt: isoNow(), runtime: { node: process.version, platform: process.platform, arch: process.arch },
    source: {
      label: resolved.config.sourceVariants[options.variant].label,
      provenance: resolved.config.sourceVariants[options.variant].provenance,
      verificationMode: "snapshot-only",
      sourceRoot: path.relative(pluginRoot, resolved.sourceRoot),
      sourceManifest: path.relative(pluginRoot, resolved.sourceManifestPath),
      sourceManifestSha256: sha256(sourceManifestBytes), sourceFileCount: sourceManifest.paths.length,
      sourceManifestFiles: sourceManifest.files,
      originalCaseManifest: resolved.config.sourceVariants.A.originalCaseManifest ?? null
    },
    toolSnapshot: {
      root: path.relative(pluginRoot, toolRoot), manifest: path.relative(pluginRoot, resolved.toolManifestPath),
      manifestSha256: sha256(toolManifestBytes), configSha256: toolManifest.configSha256,
      caseManifest: path.relative(pluginRoot, resolved.caseManifestPath), caseManifestSha256: sha256(caseBytes),
      requestBuilderSha256: toolManifest.requestBuilderSha256, fileCount: toolPaths.length
    },
    caseManifestSha256: sha256(caseBytes), expectedTotal: caseManifest.realCases.length, executedTotal: 0,
    dependencyPathsAndHashes: null, request: { provider: resolved.config.model.provider, activeRoleId: resolved.config.model.activeRoleId, retries: 0, itemGranularityOverrides: true },
    model: null, execution: { mode: "sequential-real-managed-inference", retries: 0, maxCallsPerCase: limits.maxCallsPerCase, runnerDeadlineMs: limits.runnerDeadlineMs, harnessWallTimeoutMs: limits.independentHarnessDeadlineMs, productionDefaultDeadlineMs: limits.productionDeadlineMs },
    editorWriteback: { performed: false }, cases: [], notRunIds: [], summary: null
  };
  const reportPath = path.join(resolved.runDirectory, "run-report.json");
  atomicJson(reportPath, report);

  let server; let requestServer; let service; let frozenRequire; let finalError = null;
  const serviceRunState = { inferenceSeen: false, lastPid: null };
  const localAiDirectory = path.resolve(pluginRoot, resolved.config.localAiDirectory);
  const viteCacheRoot = path.resolve(pluginRoot, resolved.config.viteCacheRoot, options.variant);
  if (!within(pluginRoot, localAiDirectory) || !within(pluginRoot, viteCacheRoot)) throw new Error("Runtime cache path escaped the plugin directory.");
  try {
    server = await createServer({ root: resolved.sourceRoot, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, cacheDir: viteCacheRoot });
    frozenRequire = createRequire(path.join(resolved.sourceRoot, "preload/local-ai/service.cjs"));
    const serviceModule = frozenRequire("./service.cjs");
    if (typeof serviceModule?.createLocalAiService !== "function") throw new Error("Frozen source snapshot local AI service cannot be loaded.");
    service = serviceModule.createLocalAiService({ dataDirectory: localAiDirectory });
    const transport = frozenRequire("./http-transport.cjs");
    const profileHelperPath = path.join(toolRoot, "scripts/ai-replace-intent-local-runtime.mjs");
    const { assertCachedLightProfile } = await import(pathToFileURL(profileHelperPath).href);
    if (typeof assertCachedLightProfile !== "function") throw new Error("Frozen v2 tool snapshot is missing the cached-model guard.");
    const product = await loadProductModules(server);
    let requestBuilder;
    if (options.variant === "A") {
      requestServer = await createServer({ root: path.join(toolRoot, "request-recipe"), configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, cacheDir: path.join(pluginRoot, resolved.config.viteCacheRoot, options.variant, "request-recipe") });
      requestBuilder = (await requestServer.ssrLoadModule("/src/core/ai/aiTaskRequest.ts")).buildAiTaskRequest;
    } else {
      requestBuilder = (await server.ssrLoadModule("/src/core/ai/aiTaskRequest.ts")).buildAiTaskRequest;
    }
    if (typeof requestBuilder !== "function") throw new Error("Selected request recipe does not export buildAiTaskRequest().");
    const model = await assertCachedLightProfile({ service, localAiDirectory, ...resolved.config.model, hash: sha256 });
    report.model = model;
    const graphBefore = auditModuleGraph({ server, pluginRoot, frozenRoot: resolved.sourceRoot, sourceManifest, viteResolvedPath: import.meta.resolve("vite"), frozenRequire });
    report.loadedModules = graphBefore.loadedSourceModules;
    report.dependencyPathsAndHashes = dependencyMetadata(graphBefore, sourceManifest, resolved.sourceRoot, pluginRoot);
    const recipePath = options.variant === "A"
      ? path.join(toolRoot, resolved.config.requestRecipe.relativePath)
      : path.join(resolved.sourceRoot, "src/core/ai/aiTaskRequest.ts");
    const recipeBytes = fs.readFileSync(recipePath);
    report.requestRecipe = {
      variant: options.variant,
      root: path.relative(pluginRoot, options.variant === "A" ? path.dirname(path.dirname(path.dirname(path.dirname(recipePath)))) : resolved.sourceRoot),
      path: path.relative(pluginRoot, recipePath), sha256: sha256(recipeBytes),
      dependencies: options.variant === "A" ? resolved.config.requestRecipe.sharedModules.map((relative) => ({ path: relative, sha256: toolManifest.files[relative]?.sha256 ?? null })) : ["src/core/ai/agentOrchestrator.ts", "src/core/ai/aiTaskPrompts.ts", "src/core/ai/aiChunkingPolicy.ts"].map((relative) => ({ path: relative, sha256: sourceManifest.files[relative]?.sha256 ?? null }))
    };
    const records = [];
    for (let caseIndex = 0; caseIndex < caseManifest.realCases.length; caseIndex += 1) {
      const item = caseManifest.realCases[caseIndex];
      const snapshot = snapshotFor(item);
      const record = {
        id: item.id, family: item.family ?? "unspecified", title: item.title ?? item.id, instruction: item.instruction,
        expected: item.expected, snapshot, sourceSha256: sha256(item.source), calls: [], result: null, resolvedEdit: null,
        error: null, plannerIntent: null, plannerError: null, rawParsedIntent: null, rawParsedError: null,
        progress: [], elapsedMs: null, harnessTimedOut: false, runnerDeadlineExceeded: false, inputSnapshotUnchanged: true,
        managedServerPresentBefore: observeManagedServer(localAiDirectory)
      };
      const caseStarted = Date.now();
      try {
        await evaluateItem({
          request: requestFor(item, requestBuilder, resolved.config), snapshot, modules: product, service, transport, plan: model,
          record, serviceRunState, observeManagedServer: () => observeManagedServer(localAiDirectory), sha256,
          maxCalls: limits.maxCallsPerCase, maxDurationMs: limits.runnerDeadlineMs, harnessTimeoutMs: limits.independentHarnessDeadlineMs
        });
      } catch (error) { record.error = errorValue(error); }
      record.elapsedMs = Date.now() - caseStarted;
      record.inputSnapshotUnchanged = record.snapshot.content === item.source && record.sourceSha256 === sha256(item.source);
      if (!record.harnessTimedOut) await replayPlanner(item, record, product);
      else record.runStopReason = "independent_harness_wall_cap";
      try {
        record.evaluation = evaluateScenarioV2(item, record, product);
        record.status = record.harnessTimedOut || record.runnerDeadlineExceeded ? "blocked" : record.evaluation.passed ? "passed" : "failed";
      } catch (error) {
        record.oracleError = errorValue(error);
        record.status = record.harnessTimedOut || record.runnerDeadlineExceeded ? "blocked" : "not_run";
      }
      report.cases.push({ id: item.id, family: record.family, status: record.status, elapsedMs: record.elapsedMs, actualCalls: record.calls.length, evaluation: record.evaluation });
      writeRecord(resolved.runDirectory, record);
      report.executedTotal = report.cases.length;
      report.summary = summarize(report);
      if (record.harnessTimedOut) {
        report.notRunIds = caseManifest.realCases.slice(caseIndex + 1).map(({ id }) => id);
        report.execution.abortedAtCaseId = item.id;
        report.execution.stopReason = "independent_harness_wall_cap";
      }
      atomicJson(reportPath, report);
      console.log(JSON.stringify({ id: item.id, status: record.status, outcome: record.evaluation?.outcome ?? null, strict: record.evaluation?.strictIntent?.pass ?? null, userTask: record.evaluation?.userTask?.pass ?? null, calls: record.calls.length }));
      if (record.harnessTimedOut) break;
    }
  } catch (error) { finalError = errorValue(error); }
  finally {
    const cleanupError = await cleanupRunnerResources({
      report, service, requestServer, server,
      auditModuleGraph: server && frozenRequire
        ? () => auditModuleGraph({ server, pluginRoot, frozenRoot: resolved.sourceRoot, sourceManifest, viteResolvedPath: import.meta.resolve("vite"), frozenRequire })
        : null
    });
    finalError ??= cleanupError;
  }
  try {
    const afterHashes = verifySnapshotOnly(resolved.sourceRoot, sourceManifest);
    report.source.snapshotStableAfter = JSON.stringify(afterHashes) === JSON.stringify(verifiedBefore);
    if (!report.source.snapshotStableAfter) finalError ??= { name: "SnapshotDrift", code: null, message: "Frozen source snapshot changed during run." };
    const toolAfter = verifyToolSnapshot(pluginRoot, toolRoot, resolved.config, toolManifest);
    report.toolSnapshot.stableAfter = JSON.stringify(toolAfter) === JSON.stringify(toolPaths);
    if (!report.toolSnapshot.stableAfter) finalError ??= { name: "SnapshotDrift", code: null, message: "Frozen v2 tool snapshot changed during run." };
    report.caseManifestStableAfter = sha256(fs.readFileSync(resolved.caseManifestPath)) === report.caseManifestSha256;
    if (!report.caseManifestStableAfter) finalError ??= { name: "ManifestDrift", code: null, message: "Frozen case set changed during run." };
  } catch (error) { finalError ??= errorValue(error); }
  if (finalError) report.error = finalError;
  report.finishedAt = isoNow();
  report.summary = summarize(report);
  report.status = finalError ? "failed" : report.cases.some(({ status }) => status === "blocked") ? "blocked" : report.cases.some(({ status }) => status !== "passed") ? "failed" : "passed";
  atomicJson(reportPath, report);
  return report;
}
