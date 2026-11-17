import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { assertNoSymlinkPath, readFrozenCases, readRuntimeProfiles, sha256, verifyCandidate, verifyModelFiles } from "./scoped-followup-fixtures.mjs";
import {
  buildScopedFollowupCases,
  scoreScopedFollowupCase,
  summarizeScopedFollowup
} from "./scoped-followup-cases.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PATHS = {
  candidateSnapshots: ".cache/acceptance/ai-scenarios/v2-r4/snapshots",
  baseCases: ".cache/acceptance/ai-common-failures/v1/run-inputs/case-manifest.json",
  derivedManifest: ".cache/acceptance/ai-common-failures/v1/run-inputs/derived-manifest.json",
  nativeFixture: ".cache/acceptance/ai-common-failures/v1/native-host-20261023/executed-native-fixture.md",
  runtimePreparation: ".cache/acceptance/ai-model-comparison/v1/runtime-preparation.json",
  runtimeRoot: ".cache/acceptance/ai-model-comparison/v1/runtime",
  output: ".cache/acceptance/ai-common-failures/scoped-followup-v1"
};
const ROUNDS = [
  { roundId: "balanced-r1", profileId: "balanced", repetition: 1 },
  { roundId: "light-r1", profileId: "light", repetition: 1 },
  { roundId: "light-r2", profileId: "light", repetition: 2 },
  { roundId: "balanced-r2", profileId: "balanced", repetition: 2 }
];
const TOOL_SOURCE_FILES = [
  "scripts/ai-scenario-eval/run-scoped-followup.mjs",
  "scripts/ai-scenario-eval/scoped-followup-cases.mjs",
  "scripts/ai-scenario-eval/scoped-followup-fixtures.mjs"
];
const LIMITS = { plannerMs: 15_000, productionMs: 300_000, independentCaseMs: 90_000, maxCallsPerCase: 64 };
const isoNow = () => new Date().toISOString();

function writeJsonExclusive(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

function serializableResult(result) {
  if (!result || typeof result !== "object") return result ?? null;
  const { proposal, ...rest } = result;
  return {
    ...rest,
    proposal: proposal ? {
      text: proposal.text, mode: proposal.mode, dependency: proposal.dependency,
      patch: proposal.patch ?? null, summary: proposal.summary ?? null
    } : null
  };
}

function snapshotFor(item) {
  const snapshot = {
    documentId: `scoped-${item.id}`, revision: 1, content: item.source,
    selection: item.selection ?? null, cursor: item.cursor ?? null, readOnly: false
  };
  if (Object.hasOwn(item, "selectionValid")) snapshot.selectionValid = item.selectionValid;
  return snapshot;
}

function buildRequest(item, builder) {
  const selected = item.selectionValid !== false && Boolean(item.selection && item.selection.to > item.selection.from);
  const request = builder({
    source: item.source, selected, action: "custom", userPrompt: item.instruction,
    config: { provider: "local", activeRoleId: "general", customSystemPrompt: "" }
  });
  if (request.source !== item.source || request.userPrompt !== item.instruction || request.scope !== (selected ? "selection" : "document")) {
    throw new Error(`${item.id}: shared request builder changed the frozen input.`);
  }
  return request;
}

function scopedError(error) {
  return { name: error?.name ?? "Error", code: error?.code ?? null, message: String(error?.message ?? error) };
}

function captureToolSourceBundle() {
  return TOOL_SOURCE_FILES.map((relative) => {
    const filePath = assertNoSymlinkPath(ROOT, path.join(ROOT, relative));
    const bytes = fs.readFileSync(filePath);
    return { path: relative, bytes, sha256: sha256(bytes), byteLength: bytes.byteLength };
  });
}

function writeToolSourceSnapshot(outputDir, bundle) {
  for (const file of bundle) {
    const destination = path.join(outputDir, "tool-source", file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, file.bytes, { flag: "wx", mode: 0o600 });
  }
  return bundle.map(({ path: filePath, sha256: digest, byteLength }) => ({ path: filePath, sha256: digest, bytes: byteLength }));
}

function verifyToolSourceSnapshot(outputDir, bundle) {
  for (const file of bundle) {
    const original = fs.readFileSync(path.join(ROOT, file.path));
    const copy = fs.readFileSync(path.join(outputDir, "tool-source", file.path));
    if (sha256(original) !== file.sha256 || sha256(copy) !== file.sha256 || !copy.equals(file.bytes)) {
      throw new Error(`Scoped evaluation tool source changed during run: ${file.path}`);
    }
  }
}

function isKnownProductStop(error) {
  return ["PlanValidationError", "IntentProtocolError"].includes(error?.name) ||
    ["invalid_evidence", "selection_required", "ambiguous_instruction", "ambiguous_anchor", "missing_target", "missing_operation"].includes(error?.code) ||
    /尚未修改|未修改文档|原文未修改|未生成可应用的修改|未能形成明确编辑计划|无法安全规划|请先选择要处理的内容|请明确|找到多个可能|指令范围不明确|没有可用的有效选区|请说明修改位置|请说明要对文档执行什么操作/u.test(error?.message ?? "");
}

function hasStructuredTerminalCall(record) {
  return record.calls.some(({ raw }) => {
    if (typeof raw !== "string") return false;
    try {
      const value = JSON.parse(raw);
      return ["clarify", "unsupported"].includes(value?.kind) || ["clarify", "unsupported"].includes(value?.intent?.kind);
    } catch { return false; }
  });
}

export function scopedExecutionStatus(record) {
  if (record.harnessTimedOut || record.runnerDeadlineExceeded || ["independent_case_timeout", "timeout"].includes(record.error?.code)) return "incomplete";
  if (record.calls.some(({ error }) => error)) return "incomplete";
  if (record.calls.some(({ raw }) => raw === null || raw === undefined)) return "incomplete";
  if (record.error && !isKnownProductStop(record.error) && !hasStructuredTerminalCall(record)) return "incomplete";
  if (record.result != null || isKnownProductStop(record.error) || hasStructuredTerminalCall(record)) return "completed";
  return "incomplete";
}

async function boundedCancel(service, requestId) {
  if (!requestId) return { status: "not-needed" };
  let timer;
  const operation = Promise.resolve().then(() => service.cancelGeneration(requestId)).then(
    () => ({ status: "completed" }), (error) => ({ status: "failed", error: scopedError(error) })
  );
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve({ status: "timed-out" }), 5_500); });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
}

async function loadFrozenProduct(server) {
  const [planned, edit, requests] = await Promise.all([
    server.ssrLoadModule("/src/core/ai/plannedTaskRunner.ts"),
    server.ssrLoadModule("/src/core/ai/editProposal.ts"),
    server.ssrLoadModule("/src/core/ai/aiTaskRequest.ts")
  ]);
  if (typeof planned.runPlannedAiTask !== "function" || typeof edit.resolveAiEdit !== "function" || typeof requests.buildAiTaskRequest !== "function") {
    throw new Error("Frozen candidate does not export the planned-task, edit-resolution, and shared request APIs.");
  }
  return { ...planned, ...edit, ...requests };
}

async function captureOneCase({ item, modules, service, transport, profile, roundId }) {
  const snapshot = snapshotFor(item);
  const request = buildRequest(item, modules.buildAiTaskRequest);
  const record = {
    caseId: item.id, roundId, profileId: profile.profileId, modelId: profile.modelId,
    input: { source: item.source, sourceSha256: sha256(item.source), selection: snapshot.selection, selectionValid: snapshot.selectionValid ?? null, cursor: snapshot.cursor, instruction: item.instruction },
    request, snapshot, calls: [], progress: [], result: null, resolvedEdit: null, error: null,
    resolutionError: null, planningMode: "unclassified", elapsedMs: null, harnessTimedOut: false,
    runnerDeadlineExceeded: false, editorWriteback: false, retries: 0
  };
  const controller = new AbortController();
  let activeRequestId = null;
  let invocationCount = 0;
  const invoke = async (prompt, systemPrompt, maxTokens, onChunk, outputSchema) => {
    if (invocationCount >= LIMITS.maxCallsPerCase) throw new Error(`Call limit ${LIMITS.maxCallsPerCase} exceeded.`);
    invocationCount += 1;
    const index = invocationCount;
    const requestId = `sff-${roundId}-${item.id}-${index}-${Date.now()}`.slice(0, 100);
    const built = transport.buildChatRequest({
      source: "managed", model: profile.modelId, prompt, systemPrompt, maxTokens,
      contextTokens: 4096, ...(outputSchema === undefined ? {} : { outputSchema })
    });
    const call = {
      index, classification: "unclassified", requestId, prompt, systemPrompt, maxTokens,
      outputSchema: outputSchema ?? null, outputSchemaSha256: outputSchema === undefined ? null : sha256(JSON.stringify(outputSchema)),
      request: { pathname: built.pathname, body: built.body }, chunks: [], raw: null, error: null,
      startedAt: isoNow(), elapsedMs: null
    };
    record.calls.push(call);
    activeRequestId = requestId;
    const startedAt = Date.now();
    try {
      const raw = await service.generate({
        requestId, source: "managed", profileId: profile.profileId, modelId: profile.modelId,
        prompt, systemPrompt, maxTokens, contextTokens: 4096,
        ...(outputSchema === undefined ? {} : { outputSchema })
      }, (chunk) => {
        call.chunks.push(chunk);
        onChunk?.(chunk);
      });
      call.raw = raw;
      return raw;
    } catch (error) {
      call.error = scopedError(error);
      throw error;
    } finally {
      call.elapsedMs = Date.now() - startedAt;
      call.finishedAt = isoNow();
      if (activeRequestId === requestId) activeRequestId = null;
    }
  };
  const started = Date.now();
  const runner = Promise.resolve().then(() => modules.runPlannedAiTask(request, snapshot, {
    invoke, signal: controller.signal, isCurrent: () => !controller.signal.aborted,
    abortCurrent: () => { if (activeRequestId) void service.cancelGeneration(activeRequestId).catch(() => {}); },
    maxCalls: LIMITS.maxCallsPerCase, maxDurationMs: LIMITS.productionMs,
    onProgress: (message) => record.progress.push({ at: Date.now(), message }),
    onChunk: (chunk) => record.progress.push({ at: Date.now(), chunk })
  }));
  runner.catch(() => {});
  let timer;
  const timedOut = Symbol("independent-case-timeout");
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(timedOut), LIMITS.independentCaseMs);
  });
  try {
    const result = await Promise.race([runner, deadline]);
    if (result === timedOut) {
      record.harnessTimedOut = true;
      record.error = { name: "HarnessTimeoutError", code: "independent_case_timeout", message: `Case exceeded ${LIMITS.independentCaseMs} ms.` };
      controller.abort();
      record.cancel = await boundedCancel(service, activeRequestId);
    } else {
      record.result = serializableResult(result);
      record.planningMode = result?.planningMode ?? "unclassified";
      if (result?.proposal) {
        try {
          const resolved = modules.resolveAiEdit(result.proposal);
          if (resolved) record.resolvedEdit = { ...resolved, contentSha256: sha256(resolved.content) };
          else record.resolutionError = { name: "ProposalResolutionError", code: "proposal_unresolvable", message: "resolveAiEdit returned no applicable patch." };
        } catch (error) { record.resolutionError = scopedError(error); }
      }
    }
  } catch (error) {
    record.error = scopedError(error);
    if (error?.name === "AiTaskDeadlineError") record.runnerDeadlineExceeded = true;
  } finally {
    clearTimeout(timer);
  }
  record.elapsedMs = Date.now() - started;
  record.inputSnapshotUnchanged = snapshot.content === item.source && record.input.sourceSha256 === sha256(item.source);
  const scoringRecord = { ...record, result: record.result, resolvedEdit: record.resolvedEdit };
  if (record.resolvedEdit) scoringRecord.resolvedEdit.content = snapshot.content.slice(0, record.resolvedEdit.from) + record.resolvedEdit.insertText + snapshot.content.slice(record.resolvedEdit.to);
  record.evaluation = scoreScopedFollowupCase(item, scoringRecord);
  record.executionStatus = scopedExecutionStatus(record);
  if (record.resolvedEdit) delete record.resolvedEdit.content;
  return record;
}

async function runActualRound({ root, candidate, snapshot, profile, round, items, outputDir }) {
  const before = verifyCandidate(root, candidate, PATHS.candidateSnapshots);
  const viteCacheDir = assertNoSymlinkPath(root, path.join(outputDir, ".vite", round.roundId), { allowMissingLeaf: true });
  fs.mkdirSync(viteCacheDir, { recursive: true, mode: 0o700 });
  let server;
  let service;
  let firstError = null;
  const records = [];
  let notRunCaseIds = [];
  let caseStopReason = null;
  try {
    server = await createServer({ root: snapshot.sourceRoot, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, cacheDir: viteCacheDir });
    const frozenRequire = createRequire(path.join(snapshot.sourceRoot, "preload/local-ai/service.cjs"));
    const serviceModule = frozenRequire("./service.cjs");
    const transport = frozenRequire("./http-transport.cjs");
    if (typeof serviceModule.createLocalAiService !== "function" || typeof transport.buildChatRequest !== "function") throw new Error("Frozen candidate local AI service or transport is unavailable.");
    service = serviceModule.createLocalAiService({ dataDirectory: profile.runtimeDirectory });
    const active = JSON.parse(fs.readFileSync(path.join(profile.runtimeDirectory, "active-model.json"), "utf8"));
    if (active.profileId !== profile.profileId || active.modelId !== profile.modelId) throw new Error(`Isolated runtime selected a different model than ${profile.profileId}.`);
    const modules = await loadFrozenProduct(server);
    for (const item of items) {
      const record = await captureOneCase({ item, modules, service, transport, profile, roundId: round.roundId });
      const recordDirectory = path.join(outputDir, "records", round.roundId);
      fs.mkdirSync(recordDirectory, { recursive: true, mode: 0o700 });
      writeJsonExclusive(path.join(recordDirectory, `${item.id}.json`), record);
      records.push({ caseId: item.id, executionStatus: record.executionStatus, status: record.evaluation.status, outcome: record.evaluation.outcome, calls: record.calls.length, planningMode: record.planningMode, elapsedMs: record.elapsedMs });
      if (record.harnessTimedOut || record.runnerDeadlineExceeded) {
        notRunCaseIds = items.slice(items.indexOf(item) + 1).map(({ id }) => id);
        caseStopReason = record.runnerDeadlineExceeded ? "runner_production_deadline" : "independent_case_wall_cap";
        break;
      }
    }
  } catch (error) {
    firstError = scopedError(error);
  } finally {
    if (service) {
      try { await service.release(); }
      catch (error) { firstError ??= scopedError(error); }
    }
    if (server) {
      try { await server.close(); }
      catch (error) { firstError ??= scopedError(error); }
    }
  }
  const after = verifyCandidate(root, candidate, PATHS.candidateSnapshots);
  if (JSON.stringify(before.verified) !== JSON.stringify(after.verified)) throw new Error(`Frozen candidate changed during ${round.roundId}.`);
  const summary = summarizeScopedFollowup(records.map((record) => ({ evaluation: { status: record.status, outcome: record.outcome } })));
  summary.notRun = notRunCaseIds.length;
  summary.expected = items.length;
  if (firstError) notRunCaseIds = items.filter(({ id }) => !records.some((record) => record.caseId === id)).map(({ id }) => id);
  return { roundId: round.roundId, profileId: profile.profileId, sourceTreeVerifiedBeforeAfter: true, records, summary, notRunCaseIds, stopReason: firstError ? "infrastructure_error" : caseStopReason, error: firstError };
}

export function parseScopedFollowupArgs(argv) {
  const values = new Map();
  for (const argument of argv) {
    if (argument === "--execute") {
      if (values.has("execute")) throw new Error("Duplicate --execute flag.");
      values.set("execute", true);
      continue;
    }
    const match = /^--([a-z-]+)=(.*)$/u.exec(argument);
    if (!match || match[1] !== "candidate") throw new Error(`Unknown scoped follow-up argument: ${argument}`);
    if (values.has(match[1])) throw new Error("Duplicate --candidate argument.");
    values.set(match[1], match[2]);
  }
  const candidate = values.get("candidate");
  if (candidate && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u.test(candidate)) {
    throw new Error("--candidate must be a safe frozen snapshot id.");
  }
  if (!candidate) {
    throw new Error("Usage: node scripts/ai-scenario-eval/run-scoped-followup.mjs --candidate=B10 [--execute]");
  }
  return { candidate, execute: values.get("execute") === true };
}

export async function runScopedFollowup({
  root = ROOT, candidate, execute = false, dependencies = {}, paths = PATHS
} = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u.test(candidate ?? "")) throw new Error("Candidate must be a safe frozen snapshot id.");
  const resolvedRoot = path.resolve(root);
  const resolvedPaths = { ...PATHS, ...paths };
  const toolSourceBundle = captureToolSourceBundle();
  const candidateSnapshot = verifyCandidate(resolvedRoot, candidate, resolvedPaths.candidateSnapshots);
  const sourceManifestSha256 = sha256(candidateSnapshot.manifestBytes);
  const frozen = readFrozenCases(resolvedRoot, resolvedPaths.baseCases, resolvedPaths.derivedManifest);
  const runtime = readRuntimeProfiles(resolvedRoot, resolvedPaths.runtimePreparation, resolvedPaths.runtimeRoot);
  const fixturePath = assertNoSymlinkPath(resolvedRoot, path.join(resolvedRoot, resolvedPaths.nativeFixture));
  const fixtureBytes = fs.readFileSync(fixturePath);
  const nativeSource = fixtureBytes.toString("utf8");
  const sampleDocsRelative = "src/core/sampleDocs.ts";
  const sampleDocsPath = assertNoSymlinkPath(candidateSnapshot.sourceRoot, path.join(candidateSnapshot.sourceRoot, sampleDocsRelative));
  if (!candidateSnapshot.manifest.paths.includes(sampleDocsRelative)) throw new Error("Frozen candidate manifest does not contain built-in Welcome source.");
  const sampleDocsBytes = fs.readFileSync(sampleDocsPath);
  const welcomeSource = (dependencies.extractWelcome ?? (await import("./scoped-followup-cases.mjs")).extractQuickstartTemplate)(sampleDocsBytes.toString("utf8"));
  const cases = buildScopedFollowupCases({
    frozenManifest: frozen.manifest, nativeSource, welcomeSource,
    nativeSourceProvenance: {
      path: path.relative(resolvedRoot, fixturePath).split(path.sep).join("/"), sha256: sha256(fixtureBytes), bytes: fixtureBytes.byteLength,
      description: "Captured original native-host fixture; evaluator checks lexical structure only and never executes generated code."
    }
  });
  const caseManifest = {
    schemaVersion: 1, candidate, createdAt: isoNow(),
    frozenInputs: {
      candidateSourceManifest: path.relative(resolvedRoot, candidateSnapshot.manifestPath).split(path.sep).join("/"),
      candidateSourceManifestSha256: sourceManifestSha256,
      caseManifest: path.relative(resolvedRoot, frozen.casePath).split(path.sep).join("/"), caseManifestSha256: frozen.caseHash,
      derivedManifest: path.relative(resolvedRoot, frozen.derivedPath).split(path.sep).join("/"), derivedManifestSha256: frozen.derivedHash,
      nativeFixture: path.relative(resolvedRoot, fixturePath).split(path.sep).join("/"), nativeFixtureSha256: sha256(fixtureBytes),
      welcomeTemplate: `${sampleDocsRelative}#TYPORA_QUICKSTART_MARKDOWN`, welcomeTemplateSha256: sha256(welcomeSource)
    },
    cases
  };
  const caseManifestBytes = Buffer.from(`${JSON.stringify(caseManifest, null, 2)}\n`);
  const caseManifestSha256 = sha256(caseManifestBytes);
  const plan = {
    candidate, execute, caseCount: cases.length, caseManifestSha256,
    profiles: ["balanced", "light"].map((profileId) => ({
      profileId, modelId: runtime.profiles[profileId].modelId, modelSha256: runtime.profiles[profileId].modelSha256,
      isolatedRuntimePath: path.relative(resolvedRoot, runtime.profiles[profileId].runtimeDirectory).split(path.sep).join("/"),
      cachedIntegrityVerified: true
    })),
    rounds: ROUNDS, limits: LIMITS,
    toolSources: toolSourceBundle.map(({ path: filePath, sha256: digest, byteLength }) => ({ path: filePath, sha256: digest, bytes: byteLength })),
    policy: { retries: 0, deployment: false, downloads: false, editorWriteback: false, generatedCodeExecution: false }
  };
  if (!execute) return { status: "prepared-no-execution", plan };
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error(`Use Node 24 for real execution; current version is ${process.version}.`);
  await verifyModelFiles(runtime.profiles);
  for (const profileId of ["balanced", "light"]) plan.profiles.find((profile) => profile.profileId === profileId).verifiedModelSha256 = runtime.profiles[profileId].verifiedModelSha256;
  const outputDirectory = assertNoSymlinkPath(resolvedRoot, path.join(resolvedRoot, resolvedPaths.output, candidate), { allowMissingLeaf: true });
  const outputParent = path.dirname(outputDirectory);
  assertNoSymlinkPath(resolvedRoot, outputParent, { allowMissingLeaf: true });
  fs.mkdirSync(outputParent, { recursive: true, mode: 0o700 });
  if (fs.existsSync(outputDirectory)) throw new Error(`Scoped follow-up output exists; refusing to overwrite: ${path.relative(resolvedRoot, outputDirectory)}`);
  fs.mkdirSync(outputDirectory, { recursive: false, mode: 0o700 });
  fs.mkdirSync(path.join(outputDirectory, "records"), { recursive: false, mode: 0o700 });
  writeJsonExclusive(path.join(outputDirectory, "case-manifest.json"), caseManifest);
  const toolSources = writeToolSourceSnapshot(outputDirectory, toolSourceBundle);
  const runManifest = {
    schemaVersion: 1, candidate, startedAt: isoNow(), caseManifestSha256,
    sourceManifestSha256, runtimePreparationSha256: sha256(runtime.prepBytes), runtimePreparationPath: path.relative(resolvedRoot, runtime.prepPath).split(path.sep).join("/"),
    profiles: plan.profiles, rounds: ROUNDS, limits: LIMITS, toolSources,
    execution: { sequential: true, retries: 0, deployment: false, downloadBytes: 0, editorWriteback: false, generatedCodeExecution: false }
  };
  writeJsonExclusive(path.join(outputDirectory, "run-manifest.json"), runManifest);
  verifyToolSourceSnapshot(outputDirectory, toolSourceBundle);
  const roundResults = [];
  const runRound = dependencies.runRound ?? runActualRound;
  for (const round of ROUNDS) {
    const before = verifyCandidate(resolvedRoot, candidate, resolvedPaths.candidateSnapshots);
    const result = await runRound({ root: resolvedRoot, candidate, snapshot: candidateSnapshot, profile: runtime.profiles[round.profileId], round, items: cases, outputDir: outputDirectory });
    const after = verifyCandidate(resolvedRoot, candidate, resolvedPaths.candidateSnapshots);
    if (JSON.stringify(before.verified) !== JSON.stringify(after.verified)) throw new Error(`Frozen candidate tree changed during ${round.roundId}.`);
    roundResults.push({ ...result, toolSourcesVerifiedBeforeAfter: true });
    verifyToolSourceSnapshot(outputDirectory, toolSourceBundle);
  }
  const report = {
    schemaVersion: 1,
    status: roundResults.some((round) => round.stopReason || round.records?.some((record) => record.executionStatus === "incomplete") || (round.summary?.expected ?? 0) !== cases.length) ? "incomplete" : "execution-complete",
    executionStatus: roundResults.some((round) => round.stopReason || round.records?.some((record) => record.executionStatus === "incomplete") || (round.summary?.expected ?? 0) !== cases.length) ? "incomplete" : "complete",
    contentSummary: summarizeScopedFollowup(roundResults.flatMap((round) => [
      ...(round.records ?? []).map((record) => ({ evaluation: { status: record.status, outcome: record.outcome } })),
      ...Array.from({ length: round.notRunCaseIds?.length ?? 0 }, () => ({ evaluation: { status: "incomplete", outcome: "not-run" } }))
    ])),
    candidate,
    caseManifestSha256, sourceManifestSha256, runtimePreparationSha256: sha256(runtime.prepBytes),
    rounds: roundResults, roundOrder: ROUNDS.map(({ roundId, profileId }) => ({ roundId, profileId })),
    policy: runManifest.execution, stopReason: roundResults.find((round) => round.stopReason)?.stopReason ?? null, generatedCodeExecuted: false, editorWritebackPerformed: false,
    completedAt: isoNow(), statusMeaning: "status and executionStatus describe run coverage only; inspect contentSummary and per-case evaluations for quality.",
    limitations: ["Static lexical code checks do not prove generated code execution or arbitrary semantic correctness.", "Model output quality is evaluated only against the frozen cases and recorded patch evidence."]
  };
  writeJsonExclusive(path.join(outputDirectory, "run-report.json"), report);
  return { status: report.status, outputDirectory: path.relative(resolvedRoot, outputDirectory).split(path.sep).join("/"), caseManifestSha256, report };
}

async function main() {
  const options = parseScopedFollowupArgs(process.argv.slice(2));
  const result = await runScopedFollowup(options);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "failed", error: scopedError(error) }, null, 2));
    process.exitCode = 1;
  });
}
