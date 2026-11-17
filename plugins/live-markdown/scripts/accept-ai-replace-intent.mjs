// Replays real local-model replacement intent planning against rich Markdown.
// Cached resources only; this script never deploys/downloads a model or edits a document.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { allExactMatches, buildIntentOracle, intentMatchesOracle, loadFrozenQuickstart, selectCases, sourceForCase, summarize } from "./ai-replace-intent-fixtures.mjs";
import { assertCachedLightProfile } from "./ai-replace-intent-local-runtime.mjs";
import { buildOutputSchemaAudit, runOutputSchemaProbe } from "./ai-replace-intent-output-schema.mjs";
import { runIntentPreflight } from "./ai-replace-intent-preflight.mjs";
import { runIntentPromptPreview } from "./ai-replace-intent-prompt-preview.mjs";
import { intentSummary, runPatchOracle } from "./ai-replace-intent-result-audit.mjs";
import { replayCapturedPlan } from "./ai-replace-intent-runner-replay.mjs";
import { auditTransportRequestBodies } from "./ai-replace-intent-transport-audit.mjs";
import { assertFrozenSourceStillLoaded, collectAiSourceModules, createOrReadSourceFreeze, frozenSnapshot, sourceHashMap } from "./ai-replace-intent-source-freeze.mjs";

const require = createRequire(import.meta.url);
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const acceptanceRoot = path.join(pluginRoot, ".cache/acceptance/ai-replace-intent");
const localAiDirectory = path.join(pluginRoot, ".cache/acceptance/local-ai");
const label = argument("--label", "baseline");
const suite = argument("--suite", "all");
const rounds = Math.max(1, Math.min(3, Number(argument("--rounds", "1")) || 1));
const isSchemaProbe = label === "schema-probe";
const isFixed = label === "fixed" || label === "fixed-v2" || label === "fixed-v3" || label === "fixed-v4";
const isSchemaRequired = isFixed || label === "prompt-preview-v3";
const profileId = "light";
const modelId = "Qwen3-0.6B-Q4_K_M.gguf";
const outputDirectory = path.join(acceptanceRoot, label);
const outputPath = path.join(outputDirectory, `${suite}-report.json`);
const promptPath = path.join(outputDirectory, `${suite}-prompts.json`);
const sourceFreezePath = path.join(acceptanceRoot, `${label}-source-freeze.json`);
const createLocalAiService = require(path.join(pluginRoot, "preload/local-ai/service.cjs")).createLocalAiService;
const { quickstart: currentQuickstart } = require(path.join(pluginRoot, "tests/e2e/fixtures/cm6-rich-navigation.cjs"));
let quickstart = currentQuickstart;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const jsonSafeError = (error) => ({ name: error?.name ?? "Error", code: error?.code ?? null, message: String(error?.message ?? error) });

const selectedCases = isSchemaProbe ? [] : selectCases(label, suite);
const isPromptPreview = /^prompt-preview(?:-v\d+)?$/.test(label);
const expectedCalls = isSchemaProbe ? 1 : (selectedCases?.length ?? 0) * (isPromptPreview ? 1 : rounds * 3);
const report = {
  label,
  suite,
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
    "Each model attempt makes one inference call; automatic retry is not part of the measurement.",
    "A cold attempt starts after the prior owned service is released; the OS page cache is not flushed.",
    "Source is the rich quickstart fixture plus a case-specific suffix; no user document is read or edited.",
    "Replacement and append oracles compare the complete resulting source, including unrelated content preservation.",
    "Fixed runs replay each captured raw planner response through runPlannedAiTask with no second model invocation.",
    "prompt-preview evaluates only raw JSON completeness and expected fields; it is not final acceptance."
  ]
};

function argument(prefix, fallback) {
  const item = process.argv.find((value) => value.startsWith(`${prefix}=`));
  return item ? item.slice(prefix.length + 1) : fallback;
}

function writeReport() {
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  if (!/^(baseline|fixed(?:-v[234])?|prompt-preview(?:-v\d+)?|schema-probe)$/.test(label)) throw new Error("Use --label=baseline, fixed[-v2|-v3|-v4], prompt-preview[-vN], or schema-probe");
  if (isSchemaProbe ? suite !== "probe" : (!/^(priority|extended|append|all)$/.test(suite) || !selectedCases)) throw new Error("Invalid suite for the selected label");
  if (isPromptPreview && suite !== "priority") throw new Error("Prompt preview is limited to --suite=priority");
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error(`Run with Node 24; current runtime is ${process.version}`);
  fs.mkdirSync(outputDirectory, { recursive: true });

  const snapshotRoot = path.join(acceptanceRoot, "source-freeze", label);
  const sourceRoot = label === "baseline" && fs.existsSync(path.join(snapshotRoot, "src/core/ai/intentPlanner.ts"))
    ? snapshotRoot
    : pluginRoot;
  const frozenFixture = loadFrozenQuickstart({ pluginRoot, acceptanceRoot, label, currentQuickstart, hash });
  quickstart = frozenFixture.fixtureText;

  const server = await createServer({
    root: sourceRoot,
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    cacheDir: path.join(pluginRoot, `.cache/vite-ai-replace-intent-${label}-${suite}`)
  });
  let lastService = null;
  try {
    const modules = {};
    for (const name of ["intentPlanner.ts", "intentPrompts.ts", "intentContext.ts", "intentSchema.ts", "intentBinder.ts"]) {
      modules[name] = await server.ssrLoadModule(`/src/core/ai/${name}`);
    }
    modules["requestBudget.ts"] = await server.ssrLoadModule("/src/core/ai/requestBudget.ts");
    if (isSchemaRequired || isSchemaProbe) modules["intentOutputSchema.ts"] = await server.ssrLoadModule("/src/core/ai/intentOutputSchema.ts");
    if (isFixed) {
      modules["plannedTaskRunner.ts"] = await server.ssrLoadModule("/src/core/ai/plannedTaskRunner.ts");
      modules["editProposal.ts"] = await server.ssrLoadModule("/src/core/ai/editProposal.ts");
    }
    const loadedSourceModules = collectAiSourceModules(server, sourceRoot);
    const { planAiIntent } = modules["intentPlanner.ts"];
    const { buildIntentPlanningPrompt, buildIntentSystemPrompt } = modules["intentPrompts.ts"];
    const { buildAiIntentCandidates } = modules["intentContext.ts"];
    const { parseIntentOutput } = modules["intentSchema.ts"];
    const { bindAiIntent, buildBoundIntentPatch } = modules["intentBinder.ts"];
    const { buildIntentOutputSchema, intentOccurrenceChoices } = modules["intentOutputSchema.ts"] ?? {};
    const { calculateLocalAiBudget } = modules["requestBudget.ts"];
    const { runPlannedAiTask } = modules["plannedTaskRunner.ts"] ?? {};
    const { resolveAiEdit } = modules["editProposal.ts"] ?? {};
    if ([planAiIntent, buildIntentPlanningPrompt, buildIntentSystemPrompt, buildAiIntentCandidates, parseIntentOutput, bindAiIntent, buildBoundIntentPatch, calculateLocalAiBudget].some((value) => typeof value !== "function")) {
      throw new Error("Expected production intent planner, candidate builder, parser, and binder exports were not loaded");
    }
    if (isFixed && (typeof runPlannedAiTask !== "function" || typeof resolveAiEdit !== "function")) {
      throw new Error("Could not load production task-runner replay modules");
    }
    if ((isSchemaRequired || isSchemaProbe) && (typeof buildIntentOutputSchema !== "function" || typeof intentOccurrenceChoices !== "function")) {
      throw new Error("Output schema module was not loaded; refusing unconstrained evaluation");
    }
    if (isSchemaProbe) {
      report.imports = {
        rootMode: "fresh-production-source",
        sourceRoot: path.relative(pluginRoot, sourceRoot),
        observedSourceHashes: sourceHashMap(sourceRoot, loadedSourceModules, hash),
        actualLoadedAiSourceModules: loadedSourceModules
      };
      report.transportSources = sourceHashMap(pluginRoot, [
        "preload/local-ai/service.cjs",
        "preload/local-ai/http-transport.cjs",
        "preload/local-ai/output-constraint.cjs"
      ], hash);
      const service = createLocalAiService({ dataDirectory: localAiDirectory });
      lastService = service;
      report.model = await assertCachedLightProfile({ service, localAiDirectory, profileId, modelId, hash });
      const probe = await runOutputSchemaProbe({ service, profileId, modelId, hash });
      report.cases = [probe];
      await service.release();
      lastService = null;
      probe.serviceReleased = true;
      probe.managedServerPresentAfterRelease = fs.existsSync(path.join(localAiDirectory, "managed-server.json"));
      report.summary = { modelCalls: probe.modelCalls, schemaConstraintHonored: probe.schemaConstraintHonored, passed: probe.passed };
      report.status = probe.passed && !probe.managedServerPresentAfterRelease ? "probe_passed" : "probe_failed";
      report.finishedAt = new Date().toISOString();
      writeReport();
      console.log(JSON.stringify({ label, suite, status: report.status, modelCalls: probe.modelCalls, schemaConstraintHonored: probe.schemaConstraintHonored, managedServerPresentAfterRelease: probe.managedServerPresentAfterRelease }));
      return;
    }
    if (isPromptPreview) {
      report.imports = {
        rootMode: "unfrozen-prompt-preview",
        sourceRoot: path.relative(pluginRoot, sourceRoot),
        observedSourceHashes: sourceHashMap(sourceRoot, loadedSourceModules, hash),
        actualLoadedAiSourceModules: loadedSourceModules
      };
      const service = createLocalAiService({ dataDirectory: localAiDirectory });
      lastService = service;
      report.model = await assertCachedLightProfile({ service, localAiDirectory, profileId, modelId, hash });
      const previewPreflight = isSchemaRequired ? runIntentPreflight({
        cases: selectedCases,
        quickstart,
        buildAiIntentCandidates,
        buildIntentSystemPrompt,
        buildIntentPlanningPrompt,
        buildIntentOutputSchema,
        intentOccurrenceChoices,
        requireOutputSchema: true,
        calculateLocalAiBudget,
        parseIntentOutput,
        bindAiIntent,
        buildBoundIntentPatch,
        sourceForCase,
        buildIntentOracle,
        intentMatchesOracle,
        hash
      }) : null;
      if (previewPreflight && previewPreflight.status !== "passed") throw new Error(`Schema preflight failed: ${previewPreflight.passedCases}/${previewPreflight.totalCases}`);
      if (previewPreflight) report.preflight = previewPreflight;
      const preview = await runIntentPromptPreview({
        cases: selectedCases,
        quickstart,
        service,
        profileId,
        modelId,
        buildAiIntentCandidates,
        buildIntentSystemPrompt,
        buildIntentPlanningPrompt,
        buildIntentOutputSchema,
        intentOccurrenceChoices,
        schemaAware: isSchemaRequired,
        calculateLocalAiBudget,
        hash,
        onRecord: (_record, records) => {
          report.status = "preview_running";
          report.cases = records;
          report.summary = {
            modelCalls: records.reduce((total, item) => total + item.modelCalls, 0),
            rawJsonComplete: records.filter((item) => item.rawJsonComplete).length,
            expectedProtocolShapeComplete: records.filter((item) => item.expectedProtocolShapeComplete).length,
            fieldsMatchExpected: records.filter((item) => item.fieldsMatchExpected).length
          };
          writeReport();
        }
      });
      report.previewScope = preview.scope;
      report.summary = {
        modelCalls: preview.modelCalls,
        rawJsonComplete: preview.rawJsonComplete,
        expectedProtocolShapeComplete: preview.expectedProtocolShapeComplete,
        fieldsMatchExpected: preview.fieldsMatchExpected,
        totalCases: preview.totalCases
      };
      report.cases = preview.records;
      report.status = preview.status;
      report.finishedAt = new Date().toISOString();
      fs.writeFileSync(promptPath, `${JSON.stringify({
        label, suite, capturedAt: report.finishedAt, sourceHashes: report.imports.observedSourceHashes,
        cases: preview.records.map(({ rawModelOutput, parsedObject, ...item }) => item)
      }, null, 2)}\n`);
      writeReport();
      return;
    }
    const snapshot = frozenSnapshot(sourceRoot, loadedSourceModules, hash);
    const sourceFreeze = createOrReadSourceFreeze({ snapshot, sourceRoot, acceptanceRoot, label, sourceFreezePath });
    assertFrozenSourceStillLoaded(sourceFreeze, sourceRoot, hash);
    report.sourceFreeze = sourceFreeze;
    report.imports = {
      planner: "src/core/ai/intentPlanner.ts",
      candidates: "src/core/ai/intentContext.ts",
      prompt: "src/core/ai/intentPrompts.ts",
      parser: "src/core/ai/intentSchema.ts",
      binder: "src/core/ai/intentBinder.ts",
      fullRunner: isFixed ? "src/core/ai/plannedTaskRunner.ts" : null,
      editResolver: isFixed ? "src/core/ai/editProposal.ts" : null,
      rootMode: sourceRoot === pluginRoot ? "fresh-production-source" : "frozen-baseline-snapshot",
      sourceRoot: path.relative(pluginRoot, sourceRoot),
      actualLoadedAiSourceModules: loadedSourceModules
    };
    report.transportSources = sourceHashMap(pluginRoot, ["preload/local-ai/service.cjs", "preload/local-ai/http-transport.cjs", "preload/local-ai/output-constraint.cjs"], hash);
    if (isSchemaRequired) {
      const transportProbeItem = selectedCases[0];
      const transportProbeSource = sourceForCase(quickstart, transportProbeItem);
      const transportProbeCandidates = buildAiIntentCandidates(transportProbeItem.instruction, transportProbeSource);
      const transportProbeSchema = buildIntentOutputSchema(transportProbeItem.instruction, false, transportProbeCandidates);
      report.transportBodyAudit = auditTransportRequestBodies({
        buildChatRequest: require(path.join(pluginRoot, "preload/local-ai/http-transport.cjs")).buildChatRequest,
        modelId,
        outputSchema: transportProbeSchema,
        hash
      });
    }
    const sourceByCase = Object.fromEntries(selectedCases.map((item) => [item.id, sourceForCase(quickstart, item)]));
    const preflight = runIntentPreflight({
      cases: selectedCases,
      quickstart,
      buildAiIntentCandidates,
      buildIntentSystemPrompt,
      buildIntentPlanningPrompt,
      buildIntentOutputSchema,
      intentOccurrenceChoices,
      requireOutputSchema: isSchemaRequired,
      calculateLocalAiBudget,
      parseIntentOutput,
      bindAiIntent,
      buildBoundIntentPatch,
      sourceForCase,
      buildIntentOracle,
      intentMatchesOracle,
      hash
    });
    report.preflight = preflight;
    if (preflight.status !== "passed") throw new Error(`Deterministic prompt/protocol/patch preflight failed: ${preflight.passedCases}/${preflight.totalCases}`);
    const promptSnapshots = {
      label,
      suite,
      capturedAt: new Date().toISOString(),
      sourceFreeze,
      quickstart: { ...frozenFixture.record, exactHelloMatches: allExactMatches(quickstart, "hello") },
      cases: preflight.promptSnapshots.map((item) => ({
        ...item,
        source: {
          sha256: item.sourceSha256,
          utf8Bytes: Buffer.byteLength(sourceByCase[item.id]),
          appendedSource: selectedCases.find((candidate) => candidate.id === item.id)?.appendedSource
        }
      }))
    };
    fs.writeFileSync(promptPath, `${JSON.stringify(promptSnapshots, null, 2)}\n`);
    report.promptSnapshot = {
      path: path.relative(pluginRoot, promptPath),
      cases: Object.fromEntries(promptSnapshots.cases.map((item) => [item.id, { planningPromptSha256: item.planningPromptSha256, systemPromptSha256: item.systemPromptSha256, candidates: item.candidates, outputSchemaSha256: item.outputSchemaSha256, outputSchemaUtf8Bytes: item.outputSchemaUtf8Bytes, expectedOccurrenceProjection: item.expectedOccurrenceProjection }]))
    };
    report.model = null;
    report.sourceHashes = sourceFreeze.files;
    writeReport();

    let index = 0;
    for (const item of selectedCases) {
      if (lastService) await lastService.release();
      const service = createLocalAiService({ dataDirectory: localAiDirectory });
      lastService = service;
      const cache = await assertCachedLightProfile({ service, localAiDirectory, profileId, modelId, hash });
      const source = sourceByCase[item.id];
      const candidates = buildAiIntentCandidates(item.instruction, source);
      const systemPrompt = buildIntentSystemPrompt(false, candidates);
      const planningPrompt = buildIntentPlanningPrompt(item.instruction, false, candidates);
      const schemaAudit = isSchemaRequired ? buildOutputSchemaAudit({ instruction: item.instruction, candidates, buildIntentOutputSchema, intentOccurrenceChoices, hash }) : null;
      const oracle = buildIntentOracle(item, source, hash);
      report.model = { ...cache, callsUseManagedTransport: true };
      for (let round = 1; round <= rounds; round += 1) {
        for (const phase of ["cold-after-release", "hot-1", "hot-2"]) {
          assertFrozenSourceStillLoaded(sourceFreeze, sourceRoot, hash);
          const serverFile = path.join(localAiDirectory, "managed-server.json");
          const record = {
            index: ++index,
            caseId: item.id,
            round,
            phase,
            instruction: item.instruction,
            expected: item.operation === "insert"
              ? { kind: "edit", operation: "insert", target: item.target, layout: item.layout, literal: item.expectedText }
              : { kind: "edit", operation: item.operation, target: "document", find: item.find, occurrence: item.occurrence, replacement: item.replacement },
            selected: false,
            callCount: 0,
            managedServerPresentBefore: fs.existsSync(serverFile),
            cache,
            source: { sha256: hash(source), utf8Bytes: Buffer.byteLength(source) },
            candidates,
            systemPrompt,
            systemPromptSha256: hash(systemPrompt),
            planningPrompt,
            planningPromptSha256: hash(planningPrompt),
            ...(schemaAudit ?? {}),
            serviceOutputSchema: null,
            serviceOutputSchemaSha256: null,
            serviceOutputSchemaUtf8Bytes: null,
            oracle,
            rawModelOutput: null,
            parsedIntent: null,
            plannerIntent: null,
            parseError: null,
            plannerError: null,
            binding: null,
            bindingError: null,
            finalPatch: null,
            fullRunnerReplay: null,
            outcome: "pending"
          };
          const requestId = `replace-intent-${label}-${suite}-${item.id}-${round}-${phase}`;
          record.requestId = requestId;
          const startedAt = Date.now();
          const invoke = Object.assign(async (prompt, actualSystemPrompt, maxTokens, actualOutputSchema) => {
            record.callCount += 1;
            if (record.callCount > 1) throw new Error("Harness blocked an unexpected planner retry");
            record.serviceOutputSchema = actualOutputSchema ?? null;
            record.serviceOutputSchemaSha256 = actualOutputSchema ? hash(JSON.stringify(actualOutputSchema)) : null;
            record.serviceOutputSchemaUtf8Bytes = actualOutputSchema ? Buffer.byteLength(JSON.stringify(actualOutputSchema), "utf8") : 0;
            record.outputSchemaMatchesExpected = Boolean(actualOutputSchema) && JSON.stringify(actualOutputSchema) === JSON.stringify(schemaAudit?.outputSchema);
            if (isSchemaRequired && !record.outputSchemaMatchesExpected) throw new Error("Planner did not pass the exact production output schema to the harness");
            record.inferencePrompt = prompt;
            record.inferenceSystemPrompt = actualSystemPrompt;
            record.maxTokens = maxTokens;
            record.inferencePromptSha256 = hash(prompt);
            record.inferenceSystemPromptSha256 = hash(actualSystemPrompt);
            const inferenceStartedAt = Date.now();
            try {
              record.serviceGenerateCalls = (record.serviceGenerateCalls ?? 0) + 1;
              record.rawModelOutput = await service.generate({
                requestId,
                source: "managed",
                profileId,
                modelId,
                prompt,
                systemPrompt: actualSystemPrompt,
                maxTokens,
                contextTokens: 4096,
                ...(actualOutputSchema ? { outputSchema: actualOutputSchema } : {})
              });
              record.inferenceElapsedMs = Date.now() - inferenceStartedAt;
              return record.rawModelOutput;
            } catch (error) {
              record.inferenceElapsedMs = Date.now() - inferenceStartedAt;
              record.transportError = jsonSafeError(error);
              throw error;
            }
          }, { abort() { void service.cancelGeneration(requestId); } });

          try {
            const intent = await planAiIntent(item.instruction, false, candidates, invoke);
            record.plannerIntent = intentSummary(intent);
          } catch (error) {
            record.plannerError = jsonSafeError(error);
          }
          if (typeof record.rawModelOutput === "string") {
            try { record.parsedIntent = intentSummary(parseIntentOutput(record.rawModelOutput, item.instruction, candidates)); }
            catch (error) { record.parseError = jsonSafeError(error); }
          }
          const intent = record.plannerIntent ?? record.parsedIntent;
          if (intent) {
            try {
              const bound = bindAiIntent(intent, {
                documentId: `replace-intent-${item.id}`,
                revision: 1,
                content: source,
                selection: null,
                selectionValid: false,
                cursor: 0,
                readOnly: false
              }, item.instruction, candidates);
              record.binding = {
                status: "bound",
                from: bound.range.from,
                to: bound.range.to,
                expectedText: bound.range.expectedText,
                summary: bound.summary,
                dependency: bound.dependency,
                literalText: bound.literalText ?? null,
                matches: bound.matches ?? null
              };
              if (bound.intent.kind === "edit" && bound.literalText) {
                const patch = buildBoundIntentPatch(bound, bound.literalText);
                record.finalPatch = runPatchOracle(source, patch, oracle, hash);
                record.finalPatch.targetRanges = oracle.targetMatches ?? oracle.expectedChangedRanges;
                record.finalPatch.bindingMatches = bound.matches ?? [{ from: bound.range.from, to: bound.range.to }];
                record.finalPatch.patchMatchesOracleTarget = record.finalPatch.patchChangesOnlyOracleTarget;
              }
            } catch (error) {
              record.bindingError = jsonSafeError(error);
            }
          }
          record.callCountCorrect = record.callCount === 1;
          record.intentCorrect = intentMatchesOracle(item, intent, candidates);
          record.patchCorrect = record.finalPatch?.patchMatchesOracleTarget === true;
          if (isFixed && typeof record.rawModelOutput === "string") {
            record.fullRunnerReplay = await replayCapturedPlan({
              runPlannedAiTask,
              resolveAiEdit,
              item,
              source,
              rawModelOutput: record.rawModelOutput,
              oracle,
              hashValue: hash,
              expectedOutputSchema: schemaAudit?.outputSchema
            });
          }
          record.fullRunnerOracleCorrect = !isFixed || record.fullRunnerReplay?.fullDocumentExactOracle === true && record.fullRunnerReplay?.plannerOutputSchemaMatchesExpected === true;
          record.outcome = record.callCountCorrect && (!isSchemaRequired || record.outputSchemaMatchesExpected === true && record.serviceGenerateCalls === 1) && record.intentCorrect && record.binding?.status === "bound" && record.patchCorrect && record.fullRunnerOracleCorrect
            ? "passed"
            : record.bindingError ? "binding-failure"
              : record.parseError ? "protocol-output-failure"
                : record.transportError ? "inference-failure"
                  : record.plannerError ? "planner-failure"
                    : record.finalPatch && !record.patchCorrect ? "patch-outside-oracle"
                      : "model-misinterpretation";
          record.elapsedMs = Date.now() - startedAt;
          record.serviceStatusAfter = await service.getStatus().catch(() => null);
          record.managedServerPresentAfter = fs.existsSync(serverFile);
          report.cases.push(record);
          report.summary = summarize(report.cases);
          writeReport();
          console.log(JSON.stringify({ label, suite, index, expectedCalls, caseId: item.id, round, phase, callCount: record.callCount, outcome: record.outcome, plannerIntent: record.plannerIntent, bindingError: record.bindingError, finalPatch: record.finalPatch?.patchMatchesOracleTarget ?? null, fullRunnerOracle: record.fullRunnerReplay?.fullDocumentExactOracle ?? null }));
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

try {
  await main();
} catch (error) {
  report.status = "failed";
  report.error = jsonSafeError(error);
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(outputDirectory, { recursive: true });
  writeReport();
  console.error(JSON.stringify({ label, suite, status: report.status, error: report.error.message }));
  process.exitCode = 1;
}
