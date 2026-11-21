import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { contentExecutorCases, contentExecutorCaseMatrix, contentExecutorMatrixSummary } from "./content-executor-cases.mjs";
import { contentQualityCases, contentQualityMatrixSummary } from "./content-quality-cases.mjs";
import { refinementCases, refinementMatrixSummary } from "./quality-refinement-cases.mjs";
import { completionCases, completionMatrixSummary } from "./quality-completion-cases.mjs";
import { assessThinExecutionCase } from "./thin-execution-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const profile = process.argv[2] ?? "light";
const label = process.argv[3] ?? "b31-final";
const ids = process.argv.find(arg => arg.startsWith("--ids="))?.slice(6).split(",");
if (!["light", "balanced"].includes(profile) || !/^[a-z0-9-]{1,40}$/u.test(label)) throw new Error("Invalid profile/label");
const suite = process.argv.includes("--quality-b36") ? "quality-b36" : process.argv.includes("--quality-b35") ? "quality-b35" : process.argv.includes("--quality-b34") ? "quality-b34" : process.argv.includes("--quality-b33") ? "quality-b33" : process.argv.includes("--quality") ? "quality" : "content-executors";
const policies = process.argv.find(arg => arg.startsWith("--policies="))?.slice(11).split(",") ?? ["direct", "thin", "full"];
if (!policies.length || new Set(policies).size !== policies.length || policies.some(policy => !["direct", "thin", "full"].includes(policy))) throw new Error("Invalid policies");
const casePool = suite === "quality-b36" ? completionCases : ["quality-b33", "quality-b34", "quality-b35"].includes(suite) ? refinementCases : suite === "quality" ? contentQualityCases : contentExecutorCases;
const matrixSummary = suite === "quality-b36" ? completionMatrixSummary : ["quality-b33", "quality-b34", "quality-b35"].includes(suite) ? refinementMatrixSummary : suite === "quality" ? contentQualityMatrixSummary : contentExecutorMatrixSummary;
const scenarios = casePool.filter(item => item.live && (!ids || ids.includes(item.id)))
  .sort((a, b) => a.livePriority - b.livePriority);
if (!scenarios.length) throw new Error("No live cases selected");
const outputDir = path.join(root, suite === "quality-b36" ? ".cache/acceptance/content-quality-b36-20261028" : suite === "quality-b35" ? ".cache/acceptance/content-quality-b35-20261028" : suite === "quality-b34" ? ".cache/acceptance/content-quality-b34-20261028" : suite === "quality-b33" ? ".cache/acceptance/content-quality-b33-20261028" : suite === "quality" ? ".cache/acceptance/content-quality-b32-20261027" : ".cache/acceptance/content-executors-b31-20261027", `${label}-${profile}`);
if (fs.existsSync(outputDir)) throw new Error("Refuse to overwrite previous evidence");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const evaluatorPaths = [
  "scripts/ai-scenario-eval/quality-completion-cases.mjs",
  "scripts/ai-scenario-eval/quality-completion-cases.test.mjs",
  "scripts/ai-scenario-eval/run-content-executor-comparison.mjs",
  "scripts/ai-scenario-eval/content-executor-cases.mjs",
  "scripts/ai-scenario-eval/content-quality-cases.mjs",
  "scripts/ai-scenario-eval/content-quality-cases.test.mjs",
  "scripts/ai-scenario-eval/quality-refinement-cases.mjs",
  "scripts/ai-scenario-eval/quality-refinement-cases.test.mjs",
  "scripts/ai-scenario-eval/content-executor-cases.test.mjs",
  "scripts/ai-scenario-eval/thin-execution-cases.mjs",
  "scripts/ai-scenario-eval/thin-execution-assessment.mjs",
  "scripts/ai-scenario-eval/thin-execution-artifact-oracles.mjs",
  "scripts/vite/blobOnlyEnglishWorker.ts", "vite.config.ts", "package.json", "package-lock.json"
];
function collectTreeFiles(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error(`Refuse symlink source: ${path.join(directory, entry.name)}`);
    const relative = path.join(directory, entry.name).split(path.sep).join("/");
    if (entry.isDirectory()) return collectTreeFiles(relative);
    if (entry.isFile()) return [relative];
    throw new Error(`Refuse non-file source: ${relative}`);
  });
}
const sourcePaths = () => [...new Set([...collectTreeFiles("src"), ...collectTreeFiles("preload"), ...evaluatorPaths])].sort();
const fingerprint = () => Object.fromEntries(sourcePaths().map(name => {
  const bytes = fs.readFileSync(path.join(root, name));
  return [name, { sha256: sha(bytes), bytes: bytes.byteLength }];
}));
const identity = fingerprint();
const verifyFrozen = () => { if (JSON.stringify(identity) !== JSON.stringify(fingerprint())) throw new Error("Source/fixtures changed during run"); };

function safeManagedPath(base, relative) {
  const target = path.resolve(base, relative);
  if (!target.startsWith(`${path.resolve(base)}${path.sep}`)) throw new Error("Managed resource escaped the cached runtime directory");
  let current = path.resolve(base);
  for (const part of path.relative(current, target).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Cached runtime contains a symlink");
  }
  return target;
}
function hashTree(directory) {
  const members = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Cached runtime tree contains a symlink");
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const content = fs.readFileSync(absolute);
        members.push({ path: path.relative(directory, absolute).split(path.sep).join("/"), bytes: content.byteLength, sha256: sha(content) });
      } else throw new Error("Cached runtime tree contains a non-regular entry");
    }
  };
  walk(directory);
  members.sort((a, b) => a.path.localeCompare(b.path));
  return { sha256: sha(JSON.stringify(members)), files: members.length };
}

const runtime = path.join(root, ".cache/acceptance/ai-model-comparison/v1/runtime", profile);
const active = JSON.parse(fs.readFileSync(path.join(runtime, "active-model.json"), "utf8"));
const require = createRequire(import.meta.url);
const { createLocalAiService } = require(path.join(root, "preload/local-ai/service.cjs"));
const service = createLocalAiService({ dataDirectory: runtime, generationTimeoutMs: 120000 });
const vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), appType: "custom", logLevel: "error", server: { middlewareMode: true, ws: false } });
const report = {
  label, suite, policies, profile, modelId: active.modelId, modelVersion: active.modelVersion,
  runtimeId: active.runtimeId, runtimeVersion: active.runtimeVersion, nodeVersion: process.version,
  cachedOnly: true, downloadBytes: 0, startedAt: new Date().toISOString(),
  sourceTreeSha256: sha(JSON.stringify(Object.fromEntries(Object.entries(identity).filter(([name]) => /^(src|preload)\//u.test(name))))),
  evaluatorTreeSha256: sha(JSON.stringify(Object.fromEntries(Object.entries(identity).filter(([name]) => name.startsWith("scripts/ai-scenario-eval/"))))),
  matrix: matrixSummary,
  caseMatrix: suite.startsWith("quality") ? scenarios.map(({id,instruction,source,expected}) => ({id,instruction,source,expected})) : contentExecutorCaseMatrix,
  methodology: {
    direct: "Same scoped request and minimal generation prompt as thin; deterministic content compiler disabled. Known operations have one body call; genuinely unknown operations use one operation+body schema response. Common scope/Diff safety retained.",
    thin: "Production default uses semantic executors: literal artifacts and Markdown knowledge answers take 0 model calls; generated artifacts request schema-bound data payloads while the program renders declared Markdown structure; prose edits use owned text slots in preplanned batches; source answers bind fields/evidence and summaries select source IDs. Unknown intent still uses one combined operation+text call. Free-form fallback or long-source batching is chosen before inference from route and budget. Provider failures do not retry, and candidates are never auto-applied.",
    full: "Explicit legacy full workflow in the current source tree; planner, compiler, source ledger and validation preserved. Shared parser fixes apply, so this is not an immutable B29 binary.",
    controls: "Same exact instruction, authorized source/selection, explicit config.model and cached model across direct/thin/full. Per-task ceiling is 16 calls and 300 seconds. Policy order rotates. No provider failure retries. Every real model response/error is retained.",
    sampling: "Routes receive the same source and instruction. Requests with outputSchema use the local service schema sampling path (temperature 0); raw requests use the backend default. This is an end-to-end route comparison, not a pure prompt-only causal experiment.",
    caveats: "Seed is not exposed. Cold start may affect latency. A reviewable candidate is not proof of semantic quality. Open factual, relation, and code-behavior quality remains human review.",
    boundaries: "Synthetic fixtures only. No native document writes, model downloads, deployment, installed plugin changes, Gemini or Windows/Linux native acceptance."
  }, cases: []
};
let outputCreated = false;
const persist = () => { if (outputCreated) fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2) + "\n"); };
const errorRecord = error => ({ name: error.name, code: error.code, message: error.message, evidence: error.evidence });
let sequence = 0;
try {
  const plan = (await service.inspect()).plans.find(item => item.id === profile);
  if (active.profileId !== profile || !plan?.cached || plan.downloadBytes !== 0 || plan.modelId !== active.modelId) throw new Error("Refuse downloads or cached identity mismatch");
  const metadataPath = safeManagedPath(runtime, "managed-resources.json");
  const managed = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const runtimeEntry = managed.resources?.find(item => item?.id === active.runtimeId && item?.version === active.runtimeVersion);
  if (!runtimeEntry) throw new Error("Cached runtime metadata does not match the active runtime identity");
  const runtimeDirectory = safeManagedPath(runtime, runtimeEntry.relativePath);
  if (!fs.lstatSync(runtimeDirectory).isDirectory()) throw new Error("Cached runtime resource is not a directory");
  const runtimeDigest = hashTree(runtimeDirectory);
  report.runtimeSha256 = runtimeDigest.sha256;
  report.runtimeResourceSha256 = runtimeDigest.sha256;
  report.runtimeResourceFileCount = runtimeDigest.files;
  const digest = crypto.createHash("sha256");
  const modelPath = safeManagedPath(runtime, active.modelPath);
  if (!fs.lstatSync(modelPath).isFile()) throw new Error("Cached model entry is not a regular file");
  const fd = fs.openSync(modelPath, "r");
  const bytes = Buffer.alloc(8 * 1024 * 1024);
  try { for (let n; (n = fs.readSync(fd, bytes, 0, bytes.length, null)) > 0;) digest.update(bytes.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  report.modelSha256 = digest.digest("hex");
  verifyFrozen();
  if (fs.existsSync(outputDir)) throw new Error("Refuse to overwrite previous evidence");
  fs.mkdirSync(outputDir, { recursive: true });
  outputCreated = true;
  fs.writeFileSync(path.join(outputDir, "frozen.json"), JSON.stringify(identity, null, 2) + "\n", { flag: "wx" });
  const runner = await vite.ssrLoadModule("/src/core/ai/plannedTaskRunnerCore.ts");
  const requests = await vite.ssrLoadModule("/src/core/ai/aiTaskRequest.ts");
  const budgets = await vite.ssrLoadModule("/src/core/ai/requestBudget.ts");
  const tokens = await vite.ssrLoadModule("/src/core/ai/markdownChunker.ts");
  const targets = await vite.ssrLoadModule("/src/core/ai/intentTargets.ts");
  const edits = await vite.ssrLoadModule("/src/core/ai/editProposal.ts");

  function normalizedTarget(intent, source) {
    if (!intent) return undefined;
    if (intent.target === "heading_end" || intent.target === "section_end") {
      return "heading:" + (targets.getIntentHeadings(source).find(item => item.id === intent.targetId)?.text ?? intent.targetId);
    }
    if (intent.operation === "replace_exact" && intent.occurrence === "last") return "last_match";
    if (intent.operation === "replace_exact" && intent.occurrence === 1) return "first_match";
    return intent.target;
  }

  async function run(scenario, policy) {
    const sourceFingerprint = sha(Buffer.from(scenario.source, "utf8"));
    const record = { calls: [], progress: [], policy, sourceFingerprintBefore: sourceFingerprint };
    const selected = Boolean(scenario.selection && scenario.preconditions?.selectionMappingValid !== false);
    const snapshot = { documentId: `b31-${scenario.id}.md`, revision: 1, content: scenario.source,
      selection: scenario.selection, cursor: scenario.cursor, selectionValid: scenario.preconditions?.selectionMappingValid !== false,
      readOnly: scenario.preconditions?.readOnly === true };
    const request = requests.buildAiTaskRequest({ source: selected ? scenario.source.slice(scenario.selection.from, scenario.selection.to) : scenario.source,
      selected, action: ["polish", "proofread", "summarize", "continue", "diagram"].includes(scenario.entryAction) ? scenario.entryAction : "custom", userPrompt: scenario.instruction,
      config: { provider: "local", activeRoleId: "general", executionPolicy: policy, model: active.modelId } });
    const start = Date.now();
    let currentRequest;
    try {
      record.result = await runner.runPlannedAiTaskCore(request, snapshot, {
        invoke: async (prompt, systemPrompt, maxTokens, emit, outputSchema) => {
          verifyFrozen();
          const sourceFingerprintBefore = sha(Buffer.from(snapshot.content, "utf8"));
          const budget = budgets.calculateLocalAiBudget(prompt, systemPrompt, maxTokens);
          const call = { sequence: ++sequence, prompt, systemPrompt, maxTokens, budget, outputSchema,
            stage: prompt.includes("本次用户指令：") ? "intent" : outputSchema ? "structured" : "body",
            modelId: active.modelId, sourceFingerprintBefore,
            samplingPath: outputSchema ? "schema-temperature-0" : "backend-default",
            estimatedInputTokens: tokens.estimateAiTokens(prompt) + tokens.estimateAiTokens(systemPrompt), raw: "" };
          record.calls.push(call);
          const callStart = Date.now();
          currentRequest = `thin-eval-${profile}-${Date.now()}-${sequence}`;
          try {
            call.raw = await service.generate({ source: "managed", modelId: active.modelId, requestId: currentRequest,
              prompt, systemPrompt, ...budget, ...(outputSchema ? { outputSchema } : {}) }, chunk => { call.raw += chunk; emit(chunk); });
            call.completed = true;
            return call.raw;
          } catch (error) { call.error = errorRecord(error); call.completed = false; throw error; }
          finally {
            call.elapsedMs = Date.now() - callStart;
            call.estimatedOutputTokens = tokens.estimateAiTokens(call.raw);
            call.sourceFingerprintAfter = sha(Buffer.from(snapshot.content, "utf8"));
            call.sourceUntouched = call.sourceFingerprintBefore === call.sourceFingerprintAfter && snapshot.content === scenario.source;
            currentRequest = undefined;
            verifyFrozen();
          }
        },
        isCurrent: () => true, abortCurrent: () => { if (currentRequest) service.cancel?.(currentRequest); },
        maxCalls: 16, maxDurationMs: 300000, onProgress: text => record.progress.push(text), onExecutionPlan: plan => { record.plan = plan; }
      });
      record.completed = true;
    } catch (error) { record.error = errorRecord(error); record.completed = false; }
    record.elapsedMs = Date.now() - start;
    record.sourceFingerprintAfter = sha(Buffer.from(snapshot.content, "utf8"));
    const result = record.result;
    const patch = result?.proposal?.patch;
    let fullContent;
    if (result?.proposal) {
      try { fullContent = edits.resolveAiEdit(result.proposal)?.content; }
      catch (error) { record.proposalError = errorRecord(error); }
    }
    const effect = result?.proposal ? patch && patch.from === patch.to ? "insert" : "replace"
      : result?.answerOnly && result?.executionPlan?.kind !== "no_op" ? "answer"
      : result ? "no_op"
      : !record.plan && record.calls.every(call => call.completed) && !/预算|安全上限/u.test(record.error?.message ?? "") ? "clarify" : "error";
    record.observation = { effect, text: result?.candidateText ?? result?.text ?? "",
      target: normalizedTarget(result?.resolvedIntent, scenario.source),
      ...(patch ? { patch: { ...patch, content: fullContent } } : {}),
      calls: record.calls.length, program: record.calls.length === 0, completed: record.completed || effect === "clarify",
      actualPolicy: result?.executionPolicy ?? policy, error: record.error, warnings: result?.warnings ?? [],
      reviewable: Boolean(result?.proposal), autoApplied: false, sourceUntouched: snapshot.content === scenario.source && record.sourceFingerprintBefore === record.sourceFingerprintAfter,
      sourceFingerprintBefore: record.sourceFingerprintBefore, sourceFingerprintAfter: record.sourceFingerprintAfter,
      ...(result?.contentExecutor !== undefined ? { contentExecutor: result.contentExecutor } : {}),
      ...(result?.sourceFacts !== undefined ? { sourceFacts: result.sourceFacts } : {}),
      ...(result?.evidenceCoverage !== undefined ? { evidenceCoverage: result.evidenceCoverage } : {}) };
    if (snapshot.content !== scenario.source) throw new Error("Input source mutated");
    verifyFrozen();
    return record;
  }

  for (const [index, scenario] of scenarios.entries()) {
    verifyFrozen();
    const row = { id: scenario.id, family: scenario.family, instruction: scenario.instruction, source: scenario.source,
      selection: scenario.selection, cursor: scenario.cursor, expected: scenario.expected, lanes: {} };
    report.cases.push(row);
    const order = [...policies];
    order.push(...order.splice(0, index % 3));
    for (const policy of order) {
      row.lanes[policy] = await run(scenario, policy);
      persist();
      console.log(JSON.stringify({ model: profile, id: row.id, policy, effect: row.lanes[policy].observation.effect,
        calls: row.lanes[policy].calls.length, error: row.lanes[policy].error?.message }));
    }
    row.assessment = assessThinExecutionCase(scenario, Object.fromEntries(Object.entries(row.lanes).map(([policy, lane]) => [policy, lane.observation])));
    persist();
  }
  report.summary = Object.fromEntries(policies.map(policy => {
    const lanes = report.cases.map(row => row.assessment.lanes[policy]);
    const calls = report.cases.flatMap(row => row.lanes[policy].calls);
    return [policy, { attempts: lanes.length, dispositions: Object.fromEntries([...new Set(lanes.map(lane => lane.disposition))]
      .map(status => [status, lanes.filter(lane => lane.disposition === status).length])),
      modelCalls: calls.length, estimatedInputTokens: calls.reduce((sum, call) => sum + call.estimatedInputTokens, 0),
      estimatedOutputTokens: calls.reduce((sum, call) => sum + (call.estimatedOutputTokens ?? 0), 0),
      unsafeWrites: report.cases.filter(row => row.lanes[policy].observation.autoApplied || !row.lanes[policy].observation.sourceUntouched).length }];
  }));
} finally {
  await service.release();
  await service.dispose();
  await vite.close();
  if (outputCreated) {
    report.finishedAt = new Date().toISOString();
    verifyFrozen();
    persist();
  }
}
