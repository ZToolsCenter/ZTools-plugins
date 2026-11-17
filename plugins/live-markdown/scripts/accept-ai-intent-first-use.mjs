// Replays real local-model intent planning across fresh service lifecycles.
// Cached resources only; this script never deploys/downloads a model or edits a document.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsRoot = path.join(pluginRoot, ".cache/acceptance/ai-intent-first-use");
const dataDirectory = path.join(pluginRoot, ".cache/acceptance/local-ai");
const sourceNames = [
  "intentPlanner.ts", "intentPrompts.ts", "intentSchema.ts", "intentTypes.ts",
  "requestBudget.ts", "intentBinder.ts", "intentTargets.ts", "intentConstraints.ts",
  "intentHeadingConstraint.ts", "markdownChunker.ts"
];
const cases = [
  { id: "fullwidth-comma-tight", instruction: "底部加个hello，world", expectedLiteral: "hello，world" },
  { id: "fullwidth-comma-spaced", instruction: "底部加个hello， world", expectedLiteral: "hello， world" },
  { id: "control-simple", instruction: "底部加hello", expectedLiteral: "hello" }
];
const label = argument("--label", "baseline");
const rounds = Math.max(1, Math.min(3, Number(argument("--rounds", "3")) || 3));
const profileId = "light";
const modelId = "Qwen3-0.6B-Q4_K_M.gguf";
const expectedCalls = cases.length * rounds * 3;
const outputDirectory = path.join(artifactsRoot, label);
const outputPath = path.join(outputDirectory, rounds === 1 ? "first-round.json" : "full-report.json");
const promptPath = path.join(outputDirectory, rounds === 1 ? "first-round-prompts.json" : "full-report-prompts.json");
const createLocalAiService = require(path.join(pluginRoot, "preload/local-ai/service.cjs")).createLocalAiService;
const quickstartFixture = require(path.join(pluginRoot, "tests/e2e/fixtures/cm6-rich-navigation.cjs"));
const quickstart = quickstartFixture.quickstart;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const briefStatus = (status) => ({ phase: status?.phase ?? "unknown", modelId: status?.modelId ?? null, error: status?.error ?? null, message: status?.message ?? null });
const report = {
  label,
  status: "running",
  startedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  rounds,
  expectedCalls,
  selected: false,
  profileId,
  expectedModelId: modelId,
  cases: [],
  notes: [
    "A cold request means the first planner request after this script releases the prior managed service and creates a new service instance.",
    "The OS page cache is not flushed; this does not represent a machine reboot or prove first-launch behavior on every host.",
    "No model deployment, download, proposal application, automatic retry, or editor write is performed."
  ]
};

function argument(prefix, fallback) {
  const found = process.argv.find((item) => item.startsWith(`${prefix}=`));
  return found ? found.slice(prefix.length + 1) : fallback;
}

function writeReport() {
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

function readActiveProfile() {
  return JSON.parse(fs.readFileSync(path.join(dataDirectory, "active-model.json"), "utf8"));
}

function sourceSnapshot(sourceRoot) {
  const fileHashes = {};
  const names = [...sourceNames];
  if (fs.existsSync(path.join(sourceRoot, "src/core/ai/intentContext.ts"))) names.push("intentContext.ts");
  for (const name of names) {
    const source = fs.readFileSync(path.join(sourceRoot, "src/core/ai", name), "utf8");
    fileHashes[name] = { sha256: hash(source), bytes: Buffer.byteLength(source) };
  }
  return fileHashes;
}

function assertCachedProfile(service, active) {
  if (active.profileId !== profileId || active.modelId !== modelId) {
    throw new Error(`Active model changed; expected ${profileId}/${modelId}, got ${active.profileId}/${active.modelId}`);
  }
  return service.inspect().then((inspection) => {
    const plan = inspection.plans.find((entry) => entry.id === profileId);
    if (!plan?.cached || plan.downloadBytes !== 0 || plan.modelId !== modelId) {
      throw new Error("Cached light model is unavailable; refusing to download or deploy anything");
    }
    return { platform: inspection.platform, arch: inspection.arch, cached: plan.cached, downloadBytes: plan.downloadBytes, installedBytes: plan.installedBytes };
  });
}

function literalFrom(intent, candidates) {
  if (intent?.content?.mode !== "literal") return null;
  if (typeof intent.content.text === "string") return intent.content.text;
  if (typeof intent.content.literalId === "string") return candidates.literals.find((entry) => entry.id === intent.content.literalId)?.text ?? null;
  return null;
}

function isExpectedIntent(intent, expectedLiteral, candidates) {
  return intent?.kind === "edit" && intent.operation === "insert" && intent.target === "document_end" &&
    intent.layout === "block" && intent.content?.mode === "literal" && literalFrom(intent, candidates) === expectedLiteral;
}

async function main() {
  if (!/^(baseline|fixed|fixed-v2)$/.test(label)) throw new Error("Use --label=baseline, --label=fixed, or --label=fixed-v2");
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error(`Run with Node 24; current runtime is ${process.version}`);
  fs.mkdirSync(outputDirectory, { recursive: true });

  const baselineDirectory = path.join(artifactsRoot, "baseline-source");
  const sourceRoot = label === "baseline" ? baselineDirectory : pluginRoot;
  if (label === "baseline") {
    const frozen = JSON.parse(fs.readFileSync(path.join(artifactsRoot, "baseline-source.json"), "utf8"));
    const hashes = sourceSnapshot(sourceRoot);
    for (const name of sourceNames) {
      if (hashes[name]?.sha256 !== frozen.files?.[name]?.sha256) throw new Error(`Frozen baseline source mismatch: ${name}`);
    }
  }

  const serviceOptions = { dataDirectory };
  const cleanupService = createLocalAiService(serviceOptions);
  const initialActive = readActiveProfile();
  const cache = await assertCachedProfile(cleanupService, initialActive);
  await cleanupService.release();

  const server = await createServer({
    root: sourceRoot,
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    cacheDir: path.join(pluginRoot, `.cache/vite-intent-first-use-${label}`)
  });
  let lastService = null;
  try {
    const loaded = {};
    const moduleNames = ["intentPlanner.ts", "intentPrompts.ts", "intentSchema.ts", "intentBinder.ts", "intentTargets.ts"];
    if (label !== "baseline") moduleNames.push("intentContext.ts");
    for (const name of moduleNames) {
      loaded[name] = await server.ssrLoadModule(`/src/core/ai/${name}`);
    }
    const { planAiIntent } = loaded["intentPlanner.ts"];
    const { INTENT_SYSTEM_PROMPT, buildIntentPlanningPrompt, extractIntentLiterals } = loaded["intentPrompts.ts"];
    const { bindAiIntent, buildBoundIntentPatch } = loaded["intentBinder.ts"];
    const { getIntentHeadings } = loaded["intentTargets.ts"];
    const buildAiIntentCandidates = label !== "baseline" ? loaded["intentContext.ts"].buildAiIntentCandidates : null;
    if (label !== "baseline" && typeof buildAiIntentCandidates !== "function") throw new Error("Production buildAiIntentCandidates helper is unavailable");
    const headings = getIntentHeadings(quickstart);
    const candidatesFor = (item) => label === "baseline"
      ? { headings, literals: extractIntentLiterals(item.instruction) }
      : buildAiIntentCandidates(item.instruction, quickstart);
    const sourceHashes = sourceSnapshot(sourceRoot);
    const promptSnapshots = {
      label,
      capturedAt: new Date().toISOString(),
      declaredSystemPrompt: INTENT_SYSTEM_PROMPT,
      declaredSystemPromptSha256: hash(INTENT_SYSTEM_PROMPT),
      effectiveSystemPrompts: {},
      sourceHashes,
      quickstart: {
        titleCandidate: headings.find((heading) => /welcome to live markdown/i.test(heading.text)) ?? null,
        headingCount: headings.length,
        sourceUtf8Bytes: Buffer.byteLength(quickstart),
        sourceSha256: hash(quickstart)
      },
      cases: cases.map((item) => {
        const candidates = candidatesFor(item);
        const prompt = buildIntentPlanningPrompt(item.instruction, false, candidates);
        return { id: item.id, instruction: item.instruction, prompt, promptSha256: hash(prompt), candidates };
      })
    };
    if (label === "baseline") {
      const frozen = JSON.parse(fs.readFileSync(path.join(artifactsRoot, "baseline-source.json"), "utf8"));
      if (promptSnapshots.declaredSystemPromptSha256 !== frozen.systemPromptSha256) throw new Error("Loaded baseline prompt hash differs from the frozen prompt hash");
    }
    fs.writeFileSync(promptPath, `${JSON.stringify(promptSnapshots, null, 2)}\n`);
    report.model = { profileId, modelId, resourceCache: cache, activeProfileSha256: hash(fs.readFileSync(path.join(dataDirectory, "active-model.json"))) };
    report.prompt = { declaredSystemPromptSha256: promptSnapshots.declaredSystemPromptSha256, declaredSystemPromptBytes: Buffer.byteLength(INTENT_SYSTEM_PROMPT), planningPromptHashes: Object.fromEntries(promptSnapshots.cases.map((item) => [item.id, item.promptSha256])) };
    report.sourceHashes = sourceHashes;
    report.quickstart = promptSnapshots.quickstart;
    writeReport();

    let index = 0;
    for (const item of cases) {
      for (let round = 1; round <= rounds; round += 1) {
        if (lastService) await lastService.release();
        const service = createLocalAiService(serviceOptions);
        lastService = service;
        const active = readActiveProfile();
        const roundCache = await assertCachedProfile(service, active);
        const candidates = candidatesFor(item);
        const managedServerPath = path.join(dataDirectory, "managed-server.json");
        const managedServerPresentBefore = fs.existsSync(managedServerPath);
        for (const phase of ["cold-after-release", "hot-1", "hot-2"]) {
          const record = {
            index: ++index,
            caseId: item.id,
            round,
            phase,
            instruction: item.instruction,
            expected: { kind: "edit", operation: "insert", target: "document_end", layout: "block", contentMode: "literal", literal: item.expectedLiteral },
            selected: false,
            callCount: 0,
            elapsedMs: null,
            managedServerPresentBefore,
            coldStartVerified: phase !== "cold-after-release" || !managedServerPresentBefore,
            serviceStatusBefore: briefStatus(await service.getStatus()),
            cache: roundCache,
            rawModelOutput: null,
            intent: null,
            parseError: null,
            binding: null,
            bindingError: null,
            outcome: "pending"
          };
          const prompt = buildIntentPlanningPrompt(item.instruction, false, candidates);
          record.planningPromptSha256 = hash(prompt);
          const requestId = `first-use-${label}-${item.id}-${round}-${phase}`;
          record.requestId = requestId;
          let invokeStartedAt = null;
          let invokePromise = null;
          const invoke = Object.assign(async (planningPrompt, systemPrompt, maxTokens) => {
            record.callCount += 1;
            record.inferencePromptSha256 = hash(planningPrompt);
              record.effectiveSystemPromptSha256 = hash(systemPrompt);
              promptSnapshots.effectiveSystemPrompts[record.effectiveSystemPromptSha256] = systemPrompt;
              fs.writeFileSync(promptPath, `${JSON.stringify(promptSnapshots, null, 2)}\n`);
            invokeStartedAt = Date.now();
            invokePromise = service.generate({
              requestId,
              source: "managed",
              profileId,
              modelId,
              prompt: planningPrompt,
              systemPrompt,
              maxTokens,
              contextTokens: 4096
            });
            try {
              record.rawModelOutput = await invokePromise;
              record.inferenceElapsedMs = Date.now() - invokeStartedAt;
              return record.rawModelOutput;
            } catch (error) {
              record.inferenceElapsedMs = Date.now() - invokeStartedAt;
              record.transportError = { name: error?.name ?? "Error", message: String(error?.message ?? error) };
              throw error;
            }
          }, {
            abort() { void service.cancelGeneration(requestId); }
          });
          const startedAt = Date.now();
          try {
            const intent = await planAiIntent(item.instruction, false, candidates, invoke);
            record.intent = intent;
            record.intentCorrect = isExpectedIntent(intent, item.expectedLiteral, candidates);
            try {
              const bound = bindAiIntent(intent, {
                documentId: `first-use-${round}-${item.id}`,
                revision: 1,
                content: quickstart,
                selection: null,
                selectionValid: false,
                cursor: 0,
                readOnly: false
              }, item.instruction, candidates);
              record.binding = { status: "bound", from: bound.range.from, to: bound.range.to, summary: bound.summary, literalText: bound.literalText ?? null };
              record.bindingCorrect = record.intentCorrect && bound.range.from === quickstart.length && bound.range.to === quickstart.length && bound.literalText === item.expectedLiteral;
              if (record.bindingCorrect) {
                const patch = buildBoundIntentPatch(bound, bound.literalText);
                record.patchPreview = { from: patch.from, to: patch.to, insertText: patch.insertText };
                record.bindingCorrect = patch.insertText.endsWith(item.expectedLiteral);
              }
            } catch (error) {
              record.bindingError = { name: error?.name ?? "Error", message: String(error?.message ?? error) };
            }
            record.outcome = record.intentCorrect && record.bindingCorrect ? "passed" : record.intentCorrect ? "binding-failure" : "model-misinterpretation";
          } catch (error) {
            const detail = { name: error?.name ?? "Error", code: error?.code ?? null, message: String(error?.message ?? error) };
            if (record.rawModelOutput !== null && error?.code === "invalid_output") record.parseError = detail;
            else if (record.rawModelOutput === null && !record.transportError) record.plannerError = detail;
            if (!record.transportError && error?.code !== "invalid_output") record.plannerError = detail;
            record.outcome = record.transportError ? "inference-failure"
              : error?.code === "invalid_output" ? "protocol-output-failure"
              : error?.code === "timeout" ? "planner-timeout"
              : error?.code === "scope_mismatch" ? "scope-mismatch"
              : error?.code === "selection_required" ? "selection-required"
              : "planner-failure";
          } finally {
            record.elapsedMs = Date.now() - startedAt;
            record.serviceStatusAfter = briefStatus(await service.getStatus().catch(() => null));
            record.modelServerRegisteredAfter = fs.existsSync(path.join(dataDirectory, "managed-server.json"));
            report.cases.push(record);
            report.callCountTotal = report.cases.reduce((total, entry) => total + entry.callCount, 0);
            report.completedCalls = report.cases.length;
            report.summary = summarize(report.cases);
            writeReport();
            console.log(JSON.stringify({ label, index, expectedCalls, caseId: item.id, round, phase, callCount: record.callCount, elapsedMs: record.elapsedMs, outcome: record.outcome, intent: record.intent, parseError: record.parseError, bindingError: record.bindingError }));
          }
        }
      }
    }
    report.status = report.cases.length === expectedCalls ? "complete" : "incomplete";
    report.finishedAt = new Date().toISOString();
    report.summary = summarize(report.cases);
    writeReport();
  } finally {
    if (lastService) await lastService.release();
    await server.close();
  }
}

function summarize(records) {
  const outcomes = Object.fromEntries(["passed", "model-misinterpretation", "binding-failure", "protocol-output-failure", "planner-timeout", "inference-failure", "planner-failure", "scope-mismatch", "selection-required"].map((outcome) => [outcome, records.filter((record) => record.outcome === outcome).length]));
  const cold = records.filter((record) => record.phase === "cold-after-release");
  const hot = records.filter((record) => record.phase.startsWith("hot-"));
  return {
    total: records.length,
    outcomes,
    coldPassed: cold.filter((record) => record.outcome === "passed").length,
    coldFailures: cold.filter((record) => record.outcome !== "passed").length,
    hotPassed: hot.filter((record) => record.outcome === "passed").length,
    hotFailures: hot.filter((record) => record.outcome !== "passed").length,
    firstColdTransportFailures: cold.filter((record) => record.rawModelOutput === null && record.callCount === 1).length
  };
}

try {
  await main();
} catch (error) {
  report.status = "failed";
  report.error = { name: error?.name ?? "Error", message: String(error?.message ?? error), stack: error?.stack ?? null };
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(outputDirectory, { recursive: true });
  writeReport();
  console.error(JSON.stringify({ label, status: report.status, error: report.error.message }));
  process.exitCode = 1;
}
