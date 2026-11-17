// One-shot planner boundary checks against the frozen fixed-v4 production graph.
// This script never imports the document task runner and never generates body text.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { assertCachedLightProfile } from "./ai-replace-intent-local-runtime.mjs";
import { sourceHashMap, collectAiSourceModules } from "./ai-replace-intent-source-freeze.mjs";

const require = createRequire(import.meta.url);
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const acceptanceRoot = path.join(pluginRoot, ".cache/acceptance/ai-replace-intent");
const outputDirectory = path.join(acceptanceRoot, "fixed-v4-guard");
const outputPath = path.join(outputDirectory, "guard-report.json");
const v4ReportPath = path.join(acceptanceRoot, "fixed-v4/all-report.json");
const sourceFreezePath = path.join(acceptanceRoot, "fixed-v4-source-freeze.json");
const frozenRoot = path.join(acceptanceRoot, "source-freeze/fixed-v4");
const localAiDirectory = path.join(pluginRoot, ".cache/acceptance/local-ai");
const profileId = "light";
const modelId = "Qwen3-0.6B-Q4_K_M.gguf";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const errorValue = (error) => ({ name: error?.name ?? "Error", code: error?.code ?? null, message: String(error?.message ?? error) });
const cases = [
  { id: "quoted-command-explanation", instruction: "解释‘底部加hello’是什么意思", expectedLiteralCandidateCount: 1, expected: { kind: "answer", target: "document", content: { mode: "generate", task: "custom" } } },
  { id: "negated-append", instruction: "不要在底部加hello", expectedLiteralCandidateCount: 1, expected: { kind: "clarify", reason: "missing_operation" } },
  { id: "compound-append-and-polish", instruction: "底部加hello，再润色第一段", expectedLiteralCandidateCount: 0, expected: { kind: "clarify", reason: "compound" } }
];
const report = {
  label: "fixed-v4-guard",
  status: "running",
  startedAt: new Date().toISOString(),
  node: process.version,
  suite: "planner-only-boundary",
  expectedActualModelCalls: 3,
  automaticRetries: false,
  plannerOnly: true,
  bodyGenerationCalls: 0,
  documentRunnerCalls: 0,
  cases: [],
  notes: [
    "Each case uses one production planAiIntent call and one managed-model inference; no retry or body generation occurs.",
    "The source and AI modules are loaded from the fixed-v4 frozen snapshot; no user document is read or edited.",
    "The quoted-question and negation cases each carry one literal candidate; the compound command retains its production-extracted zero-candidate shape."
  ]
};

function writeReport() {
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

function checkHashManifest(root, manifest) {
  for (const relativePath of manifest.loadedSourceModules) {
    const content = fs.readFileSync(path.join(root, relativePath));
    if (sha256(content) !== manifest.files[relativePath]?.sha256) throw new Error(`Frozen source snapshot hash mismatch: ${relativePath}`);
  }
}

function matchesExpected(intent, expected) {
  if (!intent || intent.kind !== expected.kind) return false;
  if (expected.kind === "answer") {
    return intent.target === expected.target && intent.content?.mode === expected.content.mode && intent.content?.task === expected.content.task;
  }
  return intent.reason === expected.reason;
}

function bodyProjection(request, outputSchema) {
  const body = request.body;
  return {
    source: request.isOllama ? "ollama" : "managed",
    pathname: request.pathname,
    model: body.model,
    stream: body.stream,
    bodyKeys: Object.keys(body).sort(),
    temperature: Object.hasOwn(body, "temperature") ? body.temperature : null,
    responseFormatType: body.response_format?.type ?? null,
    schemaSha256: body.response_format?.schema ? sha256(JSON.stringify(body.response_format.schema)) : null,
    expectedSchemaSha256: outputSchema ? sha256(JSON.stringify(outputSchema)) : null
  };
}

async function main() {
  fs.mkdirSync(outputDirectory, { recursive: true });
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error(`Run with Node 24; current runtime is ${process.version}`);
  if (!fs.existsSync(v4ReportPath) || !fs.existsSync(sourceFreezePath)) throw new Error("fixed-v4 acceptance report/source freeze is missing");

  const frozen = JSON.parse(fs.readFileSync(sourceFreezePath, "utf8"));
  const v4Report = JSON.parse(fs.readFileSync(v4ReportPath, "utf8"));
  if (v4Report.status !== "complete" || v4Report.summary?.outcomes?.passed !== 33) throw new Error("fixed-v4 is not the accepted 33/33 source baseline");
  checkHashManifest(frozenRoot, frozen);
  const transportPaths = ["preload/local-ai/service.cjs", "preload/local-ai/http-transport.cjs", "preload/local-ai/output-constraint.cjs"];
  const transportHashes = sourceHashMap(pluginRoot, transportPaths, sha256);
  for (const relativePath of transportPaths) {
    if (transportHashes[relativePath]?.sha256 !== v4Report.transportSources?.[relativePath]?.sha256) {
      throw new Error(`Transport source changed after fixed-v4: ${relativePath}`);
    }
  }
  report.baseline = {
    sourceFreezeCapturedAt: frozen.capturedAt,
    sourceRoot: path.relative(pluginRoot, frozenRoot),
    loadedSourceModules: frozen.loadedSourceModules,
    sourceHashes: frozen.files,
    transportHashes
  };

  const frozenQuickstartPath = path.join(frozenRoot, "quickstart.md");
  const quickstart = fs.readFileSync(frozenQuickstartPath, "utf8");
  report.source = { path: path.relative(pluginRoot, frozenQuickstartPath), sha256: sha256(quickstart), utf8Bytes: Buffer.byteLength(quickstart) };
  const server = await createServer({
    root: frozenRoot,
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    cacheDir: path.join(pluginRoot, ".cache/vite-ai-intent-guard-v4")
  });
  let service = null;
  try {
    const modules = {};
    for (const name of ["intentPlanner.ts", "intentPrompts.ts", "intentContext.ts", "intentSchema.ts", "intentOutputSchema.ts", "requestBudget.ts"]) {
      modules[name] = await server.ssrLoadModule(`/src/core/ai/${name}`);
    }
    const loadedModules = collectAiSourceModules(server, frozenRoot);
    report.loadedModules = loadedModules;
    for (const relativePath of loadedModules) {
      if (frozen.files[relativePath]?.sha256 !== sha256(fs.readFileSync(path.join(frozenRoot, relativePath)))) {
        throw new Error(`Loaded production module differs from fixed-v4 freeze: ${relativePath}`);
      }
    }
    const { planAiIntent } = modules["intentPlanner.ts"];
    const { buildIntentSystemPrompt, buildIntentPlanningPrompt } = modules["intentPrompts.ts"];
    const { buildAiIntentCandidates } = modules["intentContext.ts"];
    const { parseIntentOutput } = modules["intentSchema.ts"];
    const { buildIntentOutputSchema } = modules["intentOutputSchema.ts"];
    const { calculateLocalAiBudget } = modules["requestBudget.ts"];
    if ([planAiIntent, buildIntentSystemPrompt, buildIntentPlanningPrompt, buildAiIntentCandidates, parseIntentOutput, buildIntentOutputSchema, calculateLocalAiBudget].some((fn) => typeof fn !== "function")) {
      throw new Error("Frozen planner graph is missing a required production intent export");
    }

    const runtime = require(path.join(pluginRoot, "preload/local-ai/service.cjs"));
    const httpTransport = require(path.join(pluginRoot, "preload/local-ai/http-transport.cjs"));
    service = runtime.createLocalAiService({ dataDirectory: localAiDirectory });
    report.model = await assertCachedLightProfile({ service, localAiDirectory, profileId, modelId, hash: sha256 });
    report.transportSampling = {
      managedStructuredTemperature: 0,
      managedUnstructuredTemperature: null,
      ollamaTemperature: null,
      sourceSha256: transportHashes["preload/local-ai/http-transport.cjs"].sha256
    };

    for (const item of cases) {
      const source = `${quickstart}\n\nhello`;
      const candidates = buildAiIntentCandidates(item.instruction, source);
      const record = {
        id: item.id,
        instruction: item.instruction,
        expected: item.expected,
        expectedLiteralCandidateCount: item.expectedLiteralCandidateCount,
        sourceSha256: sha256(source),
        candidates,
        literalCandidateCount: candidates.literals.length,
        systemPrompt: buildIntentSystemPrompt(false, candidates),
        prompt: buildIntentPlanningPrompt(item.instruction, false, candidates),
        outputSchema: buildIntentOutputSchema(item.instruction, false, candidates),
        modelCalls: 0,
        serviceGenerateCalls: 0,
        rawModelOutput: null,
        parsedIntent: null,
        plannerIntent: null,
        outcome: "pending"
      };
      record.systemPromptSha256 = sha256(record.systemPrompt);
      record.promptSha256 = sha256(record.prompt);
      record.outputSchemaSha256 = sha256(JSON.stringify(record.outputSchema));
      record.systemPromptUsesSingleLiteralBranch = candidates.literals.length === 1 && !record.systemPrompt.includes("候选literal-1=orange、literal-2=apple");
      record.candidateShapeMatchesExpectation = candidates.literals.length === item.expectedLiteralCandidateCount;
      const promptBranchMatchesExpected = item.expectedLiteralCandidateCount !== 1 || record.systemPromptUsesSingleLiteralBranch;
      if (!record.candidateShapeMatchesExpectation || !promptBranchMatchesExpected) {
        record.outcome = "preflight-failure";
        record.error = { message: "Guard case literal candidate shape differs from frozen production expectation" };
        report.cases.push(record);
        writeReport();
        throw new Error(`Candidate-shape preflight failed for ${item.id}`);
      }

      const requestId = `intent-guard-${item.id}-${Date.now()}`;
      const invoke = async (prompt, systemPrompt, maxTokens, outputSchema) => {
        record.modelCalls += 1;
        record.serviceGenerateCalls += 1;
        if (record.modelCalls !== 1) throw new Error("Unexpected planner retry; guard harness permits one call per case");
        record.inferencePrompt = prompt;
        record.inferenceSystemPrompt = systemPrompt;
        record.inferencePromptSha256 = sha256(prompt);
        record.inferenceSystemPromptSha256 = sha256(systemPrompt);
        record.maxTokens = maxTokens;
        record.actualOutputSchemaSha256 = sha256(JSON.stringify(outputSchema));
        record.schemaMatchesExpected = JSON.stringify(outputSchema) === JSON.stringify(record.outputSchema);
        const request = httpTransport.buildChatRequest({
          source: "managed", model: modelId, prompt, systemPrompt, maxTokens, contextTokens: 4096, outputSchema
        });
        record.transportBody = bodyProjection(request, outputSchema);
        if (!record.schemaMatchesExpected || record.transportBody.temperature !== 0 ||
            record.transportBody.schemaSha256 !== record.outputSchemaSha256) {
          throw new Error("Actual managed intent request did not preserve schema and temperature=0");
        }
        record.inferenceStartedAt = new Date().toISOString();
        const started = Date.now();
        try {
          record.rawModelOutput = await service.generate({
            requestId,
            source: "managed",
            profileId,
            modelId,
            prompt,
            systemPrompt,
            maxTokens,
            contextTokens: 4096,
            outputSchema
          });
          record.inferenceElapsedMs = Date.now() - started;
          return record.rawModelOutput;
        } catch (error) {
          record.inferenceElapsedMs = Date.now() - started;
          record.transportError = errorValue(error);
          throw error;
        }
      };
      const started = Date.now();
      try {
        record.plannerIntent = await planAiIntent(item.instruction, false, candidates, invoke);
        record.plannerElapsedMs = Date.now() - started;
        record.parsedIntent = parseIntentOutput(record.rawModelOutput, item.instruction, candidates);
        record.intentMatchesExpected = matchesExpected(record.plannerIntent, item.expected);
        record.isNonEditIntent = record.plannerIntent.kind !== "edit";
        record.outcome = record.modelCalls === 1 && record.serviceGenerateCalls === 1 && record.schemaMatchesExpected &&
          record.intentMatchesExpected && record.isNonEditIntent ? "passed" : "mismatch";
      } catch (error) {
        record.plannerElapsedMs = Date.now() - started;
        record.error = errorValue(error);
        record.outcome = record.modelCalls === 1 ? "planner-failure" : "inference-failure";
      }
      report.cases.push(record);
      report.summary = {
        actualModelCalls: report.cases.reduce((sum, entry) => sum + entry.modelCalls, 0),
        serviceGenerateCalls: report.cases.reduce((sum, entry) => sum + entry.serviceGenerateCalls, 0),
        passedCases: report.cases.filter((entry) => entry.outcome === "passed").length,
        totalCases: cases.length
      };
      writeReport();
      console.log(JSON.stringify({ id: record.id, outcome: record.outcome, modelCalls: record.modelCalls, literalCandidateCount: record.literalCandidateCount, plannerIntent: record.plannerIntent, rawModelOutput: record.rawModelOutput }));
    }
    report.status = report.summary?.passedCases === cases.length && report.summary?.actualModelCalls === cases.length ? "passed" : "failed";
  } finally {
    if (service) {
      await service.release().catch(() => {});
      report.managedServerPresentAfterRelease = fs.existsSync(path.join(localAiDirectory, "managed-server.json"));
    }
    await server.close();
    report.finishedAt = new Date().toISOString();
    writeReport();
  }
}

main().catch((error) => {
  report.status = "blocked";
  report.error = errorValue(error);
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(outputDirectory, { recursive: true });
  writeReport();
  console.error(JSON.stringify({ status: report.status, error: report.error, report: outputPath }));
  process.exitCode = 1;
});
