import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { thinExecutionCases, thinExecutionMatrixSummary } from "./thin-execution-cases.mjs";
import { assessThinExecutionCase } from "./thin-execution-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const profile = process.argv[2] ?? "light";
const label = process.argv[3] ?? "b30-final";
const ids = process.argv.find(arg => arg.startsWith("--ids="))?.slice(6).split(",");
if (!["light", "balanced"].includes(profile) || !/^[a-z0-9-]{1,40}$/u.test(label)) throw new Error("Invalid profile/label");
const scenarios = thinExecutionCases.filter(item => item.live && (!ids || ids.includes(item.id)))
  .sort((a, b) => a.livePriority - b.livePriority);
if (!scenarios.length) throw new Error("No live cases selected");
const outputDir = path.join(root, ".cache/acceptance/thin-harness-b30-20261027", `${label}-${profile}`);
if (fs.existsSync(outputDir)) throw new Error("Refuse to overwrite previous evidence");
fs.mkdirSync(outputDir, { recursive: true });
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const sourcePaths = () => ["src", "preload"].flatMap(function walk(name) {
  return fs.readdirSync(path.join(root, name), { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error("Refuse symlink source");
    const relative = `${name}/${entry.name}`;
    return entry.isDirectory() ? walk(relative) : [relative];
  });
}).concat(fs.readdirSync(path.join(root, "scripts/ai-scenario-eval")).filter(name => /thin-execution/u.test(name))
  .map(name => `scripts/ai-scenario-eval/${name}`)).sort();
const fingerprint = () => Object.fromEntries(sourcePaths().map(name => [name, sha(fs.readFileSync(path.join(root, name)))]));
const identity = fingerprint();
const verifyFrozen = () => { if (JSON.stringify(identity) !== JSON.stringify(fingerprint())) throw new Error("Source/fixtures changed during run"); };
fs.writeFileSync(path.join(outputDir, "frozen.json"), JSON.stringify(identity, null, 2) + "\n");

const runtime = path.join(root, ".cache/acceptance/ai-model-comparison/v1/runtime", profile);
const active = JSON.parse(fs.readFileSync(path.join(runtime, "active-model.json"), "utf8"));
const require = createRequire(import.meta.url);
const { createLocalAiService } = require(path.join(root, "preload/local-ai/service.cjs"));
const service = createLocalAiService({ dataDirectory: runtime, generationTimeoutMs: 120000 });
const vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), appType: "custom", logLevel: "error", server: { middlewareMode: true, ws: false } });
const report = {
  label, profile, modelId: active.modelId, runtimeId: active.runtimeId, startedAt: new Date().toISOString(),
  sourceTreeSha256: sha(JSON.stringify(Object.fromEntries(Object.entries(identity).filter(([name]) => /^(src|preload)\//u.test(name))))),
  matrix: thinExecutionMatrixSummary,
  methodology: {
    direct: "Same scoped request and minimal generation prompt as thin; deterministic content compiler disabled. Known operations have one body call; genuinely unknown operations use one operation+body schema response. Common scope/Diff safety retained.",
    thin: "Production default: deterministic literal/artifact fast paths, otherwise one body call or one combined operation+body response. Long source may be batched before inference. Format/parameter warnings remain reviewable.",
    full: "Explicit legacy full workflow in the current source tree; planner, compiler, source ledger and validation preserved. Shared parser fixes apply, so this is not an immutable B29 binary.",
    controls: "Same exact instruction, authorized source/selection, cached model and per-task 16-call/300s ceilings. Policy order rotates. No provider failure retries. All real model responses/errors retained.",
    caveats: "These are end-to-end pipelines, not a pure prompt-only causal experiment. Schema transport sets temperature=0; raw transport uses backend default. Seed is not exposed. Cold start may affect latency. A reviewable candidate is not proof of semantic quality.",
    boundaries: "Synthetic fixtures only. No native document writes, model downloads, deployment, installed plugin changes, Gemini or Windows/Linux native acceptance."
  }, cases: []
};
const persist = () => fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
const errorRecord = error => ({ name: error.name, code: error.code, message: error.message, evidence: error.evidence });
let sequence = 0;
try {
  const plan = (await service.inspect()).plans.find(item => item.id === profile);
  if (active.profileId !== profile || !plan?.cached || plan.downloadBytes !== 0 || plan.modelId !== active.modelId) throw new Error("Refuse downloads or cached identity mismatch");
  const digest = crypto.createHash("sha256");
  const fd = fs.openSync(path.join(runtime, active.modelPath), "r");
  const bytes = Buffer.alloc(8 * 1024 * 1024);
  try { for (let n; (n = fs.readSync(fd, bytes, 0, bytes.length, null)) > 0;) digest.update(bytes.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  report.modelSha256 = digest.digest("hex");
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
    const record = { calls: [], progress: [], policy };
    const selected = Boolean(scenario.selection && scenario.preconditions?.selectionMappingValid !== false);
    const snapshot = { documentId: `b30-${scenario.id}.md`, revision: 1, content: scenario.source,
      selection: scenario.selection, cursor: scenario.cursor, selectionValid: scenario.preconditions?.selectionMappingValid !== false,
      readOnly: scenario.preconditions?.readOnly === true };
    const request = requests.buildAiTaskRequest({ source: selected ? scenario.source.slice(scenario.selection.from, scenario.selection.to) : scenario.source,
      selected, action: ["polish", "proofread", "summarize", "continue", "diagram"].includes(scenario.entryAction) ? scenario.entryAction : "custom", userPrompt: scenario.instruction,
      config: { provider: "local", activeRoleId: "general", executionPolicy: policy } });
    const start = Date.now();
    let currentRequest;
    try {
      record.result = await runner.runPlannedAiTaskCore(request, snapshot, {
        invoke: async (prompt, systemPrompt, maxTokens, emit, outputSchema) => {
          verifyFrozen();
          const budget = budgets.calculateLocalAiBudget(prompt, systemPrompt, maxTokens);
          const call = { sequence: ++sequence, prompt, systemPrompt, maxTokens, budget, outputSchema,
            stage: prompt.includes("本次用户指令：") ? "intent" : outputSchema ? "structured" : "body",
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
          finally { call.elapsedMs = Date.now() - callStart; call.estimatedOutputTokens = tokens.estimateAiTokens(call.raw); currentRequest = undefined; }
        },
        isCurrent: () => true, abortCurrent: () => { if (currentRequest) service.cancel?.(currentRequest); },
        maxCalls: 16, maxDurationMs: 300000, onProgress: text => record.progress.push(text), onExecutionPlan: plan => { record.plan = plan; }
      });
      record.completed = true;
    } catch (error) { record.error = errorRecord(error); record.completed = false; }
    record.elapsedMs = Date.now() - start;
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
      reviewable: Boolean(result?.proposal), autoApplied: false, sourceUntouched: snapshot.content === scenario.source };
    if (snapshot.content !== scenario.source) throw new Error("Input source mutated");
    verifyFrozen();
    return record;
  }

  for (const [index, scenario] of scenarios.entries()) {
    verifyFrozen();
    const row = { id: scenario.id, family: scenario.family, instruction: scenario.instruction, source: scenario.source,
      selection: scenario.selection, cursor: scenario.cursor, expected: scenario.expected, lanes: {} };
    report.cases.push(row);
    const order = ["direct", "thin", "full"];
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
  report.summary = Object.fromEntries(["direct", "thin", "full"].map(policy => {
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
  report.finishedAt = new Date().toISOString();
  verifyFrozen();
  persist();
}
