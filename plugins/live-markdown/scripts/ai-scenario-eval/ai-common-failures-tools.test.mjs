import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildExtendedCaseManifest, deriveInferenceSource, deriveRunnerSource, isIntentOutputSchema } from "./prepare-ai-common-failures-runs.mjs";
import { assessExecutionCompletion, probeLoopbackListen } from "./scenario-attempt-control.mjs";
import { mermaidSyntax, scoreLongDocument, scoreProofread, scoreTableRelations, sourceBoundReview, validatePythonAdd } from "./score-ai-common-failures-quality.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evaluationRoot = path.join(root, ".cache/acceptance/ai-common-failures/v1");
const createHash = (value) => crypto.createHash("sha256").update(value).digest("hex");

test("derived case set preserves all 80 legacy cases and adds seven independent quality holdouts", () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(evaluationRoot, "legacy-cases.json"), "utf8"));
  const holdouts = JSON.parse(fs.readFileSync(path.join(evaluationRoot, "holdout-cases.json"), "utf8"));
  const derived = buildExtendedCaseManifest(baseline, holdouts, "frozen-base-sha");
  assert.equal(derived.realCases.length, 87);
  assert.equal(derived.controlledCases.length, 16);
  assert.equal(derived.qualityOnlyHoldoutCount, 7);
  assert.deepEqual(derived.realCases.slice(0, 80), baseline.realCases);
  assert.equal(derived.realCases[80].id, "H03-table-entity-unit-01");
  assert.deepEqual(derived.realCases[80].qualityExpectation.rows.map(({ price, unit }) => [price, unit]), [["128", "元/人"], ["860", "元/月"]]);
  const crlf = derived.realCases.find(({ id }) => id === "H08-proofread-crlf-inline-01");
  assert.ok(crlf.source.includes("\r\n"));
  assert.equal(crlf.qualityOnly, true);
  assert.equal(crlf.expected.effect, "patch");
  const longEdit = derived.realCases.find(({ id }) => id === "H11-long-duplicate-paragraph-slots-01");
  assert.equal(longEdit.qualityExpectation.segments.length, 8);
  assert.match(longEdit.qualityExpectation.batchCount, /before-first-model-call/u);
});

test("derived runner separates quality holdouts from the legacy strict oracle and preserves source binding", () => {
  const fixture = [
    'fs.mkdirSync(path.join(resolved.runDirectory, "records"), { recursive: false });',
    'if (sourceManifest.caseManifestSha256 !== sha256(caseBytes)) throw new Error("Selected source snapshot is not bound to the frozen v2 case set.");',
    'if (ids.size !== 80 || manifest.controlledCases.length !== 16) throw new Error("The frozen comparison case set must retain the original 80 real and 16 controlled cases.");',
    'record.evaluation = evaluateScenarioV2(item, record, product);\n        record.status = record.harnessTimedOut || record.runnerDeadlineExceeded ? "blocked" : record.evaluation.passed ? "passed" : "failed";',
    'expected: item.expected, snapshot, sourceSha256: sha256(item.source), calls: [], result: null, resolvedEdit: null,',
    'if (!planning) { record.plannerError = { name: "ReplayUnavailable", code: null, message: "No captured planner response." }; return; }'
  ].join("\n");
  const derived = deriveRunnerSource(fixture);
  assert.match(derived, /baseCaseManifestSha256 \?\?/u);
  assert.match(derived, /ids\.size === 87/u);
  assert.match(derived, /quality-review-required/u);
  assert.match(derived, /body calls are not replayed as planner output/u);
  assert.match(derived, /qualityExpectation: item\.qualityExpectation \?\? null/u);
  assert.equal(derived.includes("strict oracle matches"), false);
  assert.throws(() => deriveRunnerSource(fixture.replace("ids.size !== 80", "ids.size !== 81")), /integration points/u);
});

test("call phase follows the intent output schema rather than invocation order", () => {
  const intentSchema = { anyOf: [{ type: "object", properties: { version: { const: 1 }, kind: { const: "edit" } } }, { type: "object", properties: { version: { const: 1 }, kind: { enum: ["clarify", "unsupported"] } } }] };
  const summarySchema = { type: "object", properties: { ids: { type: "array" } }, required: ["ids"] };
  const proseSchema = { type: "object", properties: { protocol: { const: "prose-edit/v1" }, edits: { type: "array" } } };
  assert.equal(isIntentOutputSchema(intentSchema), true);
  assert.equal(isIntentOutputSchema(summarySchema), false);
  assert.equal(isIntentOutputSchema(proseSchema), false);
  const source = 'function isoNow() {\n  return new Date().toISOString();\n}\n\nconst phase = index === 1 ? "planning" : "generation";\n\n      onProgress: (message) => { if (!harnessTimedOut) record.progress.push({ at: Date.now(), message }); },';
  const derived = deriveInferenceSource(source);
  assert.match(derived, /const phase = outputSchema && isIntentOutputSchema\(outputSchema\)/u);
  assert.doesNotMatch(derived, /index === 1/u);
  assert.throws(() => deriveInferenceSource(source.replace("index === 1", "index === 2")), /phase\/evidence integration points/u);
});

test("prose-plan evidence is durably written before invocation with prompts, budgets, ranges, and no overwrite", async () => {
  const toolRoot = path.join(root, ".cache/acceptance/ai-scenarios/v2-r4/tool-source/scripts/ai-scenario-eval");
  const source = deriveInferenceSource(fs.readFileSync(path.join(toolRoot, "scenario-inference.mjs"), "utf8"));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-prose-plan-evidence-"));
  const modulePath = path.join(directory, "derived-inference.mjs");
  const preplanDirectory = path.join(directory, "preplans");
  fs.mkdirSync(preplanDirectory);
  try {
    fs.writeFileSync(modulePath, source);
    const { writeProsePlanEvidence } = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`);
    const record = { id: "H11-fixture", preplanDirectory };
    const plan = {
      sourceHash: "frozen-source-hash", revision: "r1", scope: { from: 0, to: 12 },
      slots: [{ id: "s1", range: { from: 0, to: 12 }, paragraphId: "p1" }],
      batches: [{ id: "b1", slots: [{ id: "s1" }], prompt: "actual prompt with slot", systemPrompt: "system", maxTokens: 256, contextTokens: 4096, maxOutputBytes: 4096 }]
    };
    const evidence = writeProsePlanEvidence(record, plan, (value) => createHash(value));
    assert.equal(evidence.batchCount, 1);
    assert.equal(evidence.slotCount, 1);
    assert.match(evidence.sha256, /^[0-9a-f]{64}$/u);
    const persisted = JSON.parse(fs.readFileSync(path.join(preplanDirectory, "H11-fixture.json"), "utf8"));
    assert.deepEqual(persisted.sourceOwnedRanges[0].range, { from: 0, to: 12 });
    assert.equal(persisted.batches[0].prompt, "actual prompt with slot");
    assert.equal(persisted.batches[0].maxTokens, 256);
    assert.throws(() => writeProsePlanEvidence(record, plan, (value) => createHash(value)), /EEXIST/u);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reviewed patches apply and parse against the frozen v2 runner and inference tool", () => {
  const toolRoot = path.join(root, ".cache/acceptance/ai-scenarios/v2-r4/tool-source/scripts/ai-scenario-eval");
  const runner = deriveRunnerSource(fs.readFileSync(path.join(toolRoot, "scenario-v2-runner.mjs"), "utf8"));
  const inference = deriveInferenceSource(fs.readFileSync(path.join(toolRoot, "scenario-inference.mjs"), "utf8"));
    assert.match(runner, /path\.join\(resolved\.runDirectory, "preplans"\)/u);
    assert.match(inference, /onProsePlan: \(plan\) => \{ record\.prosePlanEvidence/u);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-common-failures-tools-"));
  try {
    for (const [name, source] of [["runner.mjs", runner], ["inference.mjs", inference]]) {
      const target = path.join(directory, name);
      fs.writeFileSync(target, source);
      execFileSync(process.execPath, ["--check", target], { stdio: "pipe" });
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("independent table score requires a real GFM table and same-row entity/price/unit relations", () => {
  const source = "# 定价\n\n海岬公园的家庭票每人 128 元。松汀植物园的月卡每月 860 元。";
  const insertText = "\n\n| 场馆 | 票种 | 价格 | 单位 |\n| --- | --- | ---: | --- |\n| 海岬公园 | 家庭票 | 128 | 元/人 |\n| 松汀植物园 | 月卡 | 860 | 元/月 |";
  const record = {
    snapshot: { content: source }, sourceSha256: "test",
    result: { proposal: { patch: { from: source.length, to: source.length, expectedText: "", insertText } } },
    resolvedEdit: { from: source.length, to: source.length, expectedText: "", insertText, content: source + insertText }
  };
  const expectations = { headings: ["场馆", "票种", "价格", "单位"], rows: [{ venue: "海岬公园", ticket: "家庭票", price: "128", unit: "元/人" }, { venue: "松汀植物园", ticket: "月卡", price: "860", unit: "元/月" }] };
  assert.equal(scoreTableRelations(record, expectations).status, "passed");
  const swapped = insertText.replace("元/人", "元/__TEMP__").replace("元/月", "元/人").replace("元/__TEMP__", "元/月");
  record.result.proposal.patch.insertText = swapped;
  record.resolvedEdit.insertText = swapped;
  record.resolvedEdit.content = source + swapped;
  assert.equal(scoreTableRelations(record, expectations).status, "failed");
});

test("proofread score checks every typo, exact structure, and line ending sequence", () => {
  const source = "标题\r\n我门以经完成复核。路经已确认。\r\n`KEEP`";
  const fixed = "标题\r\n我们已经完成复核。路径已确认。\r\n`KEEP`";
  const patch = { from: 0, to: source.length, expectedText: source, insertText: fixed };
  const record = { snapshot: { content: source }, resolvedEdit: { ...patch, content: fixed }, result: { proposal: { patch } } };
  assert.equal(scoreProofread(record, [{ from: "我门", to: "我们" }, { from: "以经", to: "已经" }, { from: "路经", to: "路径" }], ["`KEEP`"]).status, "passed");
  const bad = fixed.replace("已经", "以经");
  record.resolvedEdit = { ...patch, insertText: bad, content: bad };
  record.result.proposal.patch = record.resolvedEdit;
  assert.equal(scoreProofread(record, [{ from: "我门", to: "我们" }, { from: "以经", to: "已经" }, { from: "路经", to: "路径" }], ["`KEEP`"]).status, "failed");
});

test("long document score requires all eight corrected segments and pre-call batch evidence", () => {
  const segments = Array.from({ length: 8 }, (_, index) => `C${String(index + 1).padStart(2, "0")}：我们已经核对输入内容，并保留了验收记录。`).join("\n\n");
  const source = segments.replaceAll("我们已经", "我们以经");
  const patch = { from: 0, to: source.length, expectedText: source, insertText: segments };
  const record = { snapshot: { content: source }, resolvedEdit: { ...patch, content: segments }, result: { proposal: { patch }, proseStats: { batches: 2, modelCalls: 2, sourceHash: "frozen-source-hash" } }, calls: [{ phase: "generation" }, { phase: "generation" }] };
  const preplan = { batchCount: 2, slotCount: 8, sha256: "a".repeat(64), sourceHash: "frozen-source-hash" };
  assert.equal(scoreLongDocument(record, preplan).status, "passed");
  assert.equal(scoreLongDocument(record, null).status, "failed");
  const incomplete = segments.replace("H08", "H08").replace("C08：我们已经", "C08：我们以经");
  record.resolvedEdit = { ...patch, insertText: incomplete, content: incomplete };
  record.result.proposal.patch = record.resolvedEdit;
  assert.equal(scoreLongDocument(record, preplan).status, "failed");
});

test("zero model responses from systematic loopback EPERM cannot complete or count as model failures", async () => {
  const infrastructureError = Object.assign(new Error("listen EPERM: operation not permitted 127.0.0.1"), { code: "EPERM" });
  const blockedServer = {
    once(event, listener) { this.listener = listener; return this; },
    listen() { queueMicrotask(() => this.listener(infrastructureError)); },
    close(callback) { callback?.(); }
  };
  const preflight = await probeLoopbackListen({ createServer: () => blockedServer });
  assert.deepEqual(preflight, {
    ok: false,
    code: "EPERM",
    message: "listen EPERM: operation not permitted 127.0.0.1"
  });

  const report = {
    expectedTotal: 87,
    executedTotal: 87,
    notRunIds: [],
    cases: Array.from({ length: 87 }, (_, index) => ({ id: `C${index}`, evaluation: { errorIdentity: "EPERM" } })),
    source: { snapshotStableAfter: true },
    toolSnapshot: { stableAfter: true },
    cleanup: { errors: [] }
  };
  const records = Array.from({ length: 87 }, (_, index) => ({
    id: `C${index}`,
    calls: [{ error: { code: "EPERM" }, raw: null }]
  }));
  assert.deepEqual(assessExecutionCompletion({ report, records, exitCode: 1 }), {
    status: "infrastructure-invalid",
    reason: "systematic-EPERM-before-model-response",
    successfulResponses: 0,
    runnerExitCode: 1
  });

  const validResponses = records.map((record) => ({ ...record, calls: [{ error: null, raw: "not-json-but-a-real-model-response" }] }));
  const validEvidence = assessExecutionCompletion({ report: { ...report, cases: report.cases.map((item) => ({ ...item, evaluation: { errorIdentity: null } })) }, records: validResponses, exitCode: 1 });
  assert.equal(validEvidence.status, "execution-complete", "a nonzero scorer exit must not erase a fully captured low-quality model run");
  assert.equal(validEvidence.successfulResponses, 87);
});

test("code scoring uses static Python AST parsing and never executes generated code", () => {
  const valid = "def add(a, b):\n    return a + b\n";
  assert.equal(validatePythonAdd(valid).status, "passed");
  assert.equal(validatePythonAdd("def add(a, b):\n    return a - b\n").status, "failed");
  assert.equal(validatePythonAdd("def add(a, b)\n    return a + b\n").status, "failed");
});

test("source-bound generation and Mermaid checks never claim unsupported semantic or preview proof", () => {
  const record = { snapshot: { content: "未指定日期。" }, resolvedEdit: { from: 6, to: 6, expectedText: "", insertText: "\n\n在 2027-01-01 发布。", content: "未指定日期。\n\n在 2027-01-01 发布。" }, result: { proposal: { patch: { from: 6, to: 6, expectedText: "", insertText: "\n\n在 2027-01-01 发布。" } } } };
  assert.equal(sourceBoundReview(record).status, "manual_review_required");
  const diagram = { id: "H04-mermaid-real-preview-01", snapshot: { content: "流程" }, qualityExpectation: { requiredLabels: ["受理", "复核", "归档"], edgeCount: 2 }, resolvedEdit: { from: 2, to: 2, expectedText: "", insertText: "\n\n```mermaid\ngraph TD\n受理 --> 复核\n复核 --> 归档\n```", content: "流程\n\n```mermaid\ngraph TD\n受理 --> 复核\n复核 --> 归档\n```" }, result: { proposal: { patch: { from: 2, to: 2, expectedText: "", insertText: "\n\n```mermaid\ngraph TD\n受理 --> 复核\n复核 --> 归档\n```" } } } };
  const scored = mermaidSyntax(diagram);
  assert.equal(scored.status, "candidate-structure-only");
  assert.equal(scored.preview, "not_assessed");
});

