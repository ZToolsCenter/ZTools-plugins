import assert from "node:assert/strict";
import { test } from "node:test";
import { assessThinExecutionCase } from "./thin-execution-assessment.mjs";
import { addedContentExecutorCases, contentExecutorCases, contentExecutorMatrixSummary } from "./content-executor-cases.mjs";
import { thinExecutionCases } from "./thin-execution-cases.mjs";

const get = (id) => addedContentExecutorCases.find((item) => item.id === id);

function completeObservation(scenario, text, extra = {}) {
  const patch = scenario.expected.effect === "replace"
    ? { from: 0, to: scenario.source.length, expectedText: scenario.source, insertText: text, content: text }
    : { from: scenario.source.length, to: scenario.source.length, expectedText: "", insertText: `\n\n${text}`, content: `${scenario.source}\n\n${text}` };
  return {
    effect: scenario.expected.effect, text, target: scenario.expected.target ?? (scenario.expected.effect === "replace" ? "document" : "document_end"),
    patch, completed: true, calls: 1, program: false, reviewable: true, autoApplied: false, sourceUntouched: true,
    ...extra
  };
}

test("B31 extends the unchanged 79-case baseline with 20 cases and stays within the live budget", () => {
  assert.equal(thinExecutionCases.length, 79);
  assert.deepEqual(contentExecutorCases.slice(0, 79), thinExecutionCases);
  assert.equal(addedContentExecutorCases.length, 20);
  assert.equal(contentExecutorCases.length, 99);
  assert.equal(new Set(contentExecutorCases.map(({ id }) => id)).size, 99);
  assert.equal(contentExecutorMatrixSummary.originalCaseCount, 79);
  assert.equal(contentExecutorMatrixSummary.addedCaseCount, 20);
  assert.equal(contentExecutorMatrixSummary.addedLiveCaseCount, 9);
  assert.ok(contentExecutorMatrixSummary.addedLiveCaseCount <= 10);
  assert.equal(contentExecutorMatrixSummary.liveCaseCount, 34);
  assert.equal(contentExecutorMatrixSummary.estimatedLiveComparisons, 204);
  assert.ok(contentExecutorMatrixSummary.estimatedLiveComparisons <= 210);
  assert.ok(addedContentExecutorCases.every(({ id, family, instruction, source, expected, executionMode }) =>
    id.startsWith("B31-") && family && instruction.trim() && typeof source === "string" && expected.effect && executionMode));
});

test("fixtures express the requested structural, data, source, polish, long-context, and control cases", () => {
  assert.deepEqual(get("B31-CODE-H2").expected.artifact.heading, { level: 2, text: "API <v2> & C++" });
  assert.deepEqual(get("B31-CODE-H4").expected.artifact.heading, { level: 4, text: "接口 (v2) [beta]" });
  assert.deepEqual(get("B31-HEAD-ZH-ORDER").expected.artifact.headings.map(({ text }) => text), ["迁移观察", "后续计划"]);
  assert.deepEqual(get("B31-HEAD-EN-ORDER").expected.artifact.headings.map(({ text }) => text), ["Compatibility Review", "Next Actions"]);
  assert.deepEqual(get("B31-JSON-FALSE-NULL").expected.artifact.value, { enabled: false, owner: null, tags: ["青", "蓝"] });
  assert.deepEqual(get("B31-JSON-ARRAY-PRIMITIVES").expected.artifact.value, [false, null, "pending", 3]);
  assert.equal(get("B31-JSON-NULL").expected.artifact.value, null);
  assert.equal(get("B31-TABLE-PIPE").expected.artifact.requiredCells[0].value, "A|B");
  assert.equal(get("B31-TABLE-BREAK").expected.artifact.requiredCells[0].value, "line one<br>line two");
  assert.deepEqual(get("B31-FACT-UNKNOWN-STATUS").expected.facts, ["摘录未提供 Orion 状态", "不能据此断言完整文档没有状态信息"]);
  assert.match(get("B31-POL-CRLF-STRUCTURE").source, /\r\n/u);
  assert.ok(get("B31-LONG-COVERAGE").expected.facts.length === 3);
  assert.equal(get("B31-CONTROL-CANCEL").live, false);
  assert.equal(get("B31-CONTROL-READONLY").preconditions.readOnly, true);
  for (const item of addedContentExecutorCases.filter(({ expected }) => expected.effect === "answer")) {
    assert.equal(item.expected.semanticReview, true, `${item.id} must remain manual semantic review`);
  }
});

test("reuses the existing scorer to separate table/JSON format from explicit parameter errors", () => {
  const tableCase = get("B31-TABLE-PRICE");
  const badTable = "| Product | Price |\n| --- | --- |\n| Cedar | 11 yuan |\n| Maple | 20 yuan |";
  const tableScores = assessThinExecutionCase(tableCase, { thin: completeObservation(tableCase, badTable) }).lanes.thin;
  assert.equal(tableScores.layers.format.status, "pass");
  assert.equal(tableScores.layers.parameters.status, "fail");
  assert.ok(tableScores.failedLayers.includes("parameters"));
  assert.ok(!tableScores.failedLayers.includes("format"));

  const jsonCase = get("B31-JSON-FALSE-NULL");
  const badJson = JSON.stringify({ enabled: true, owner: null, tags: ["青", "蓝"] });
  const jsonScores = assessThinExecutionCase(jsonCase, { thin: completeObservation(jsonCase, badJson) }).lanes.thin;
  assert.equal(jsonScores.layers.format.status, "pass");
  assert.equal(jsonScores.layers.parameters.status, "fail");
  assert.ok(jsonScores.failedLayers.includes("parameters"));
  assert.ok(!jsonScores.failedLayers.includes("format"));
});

test("keyword-complete but misassociated facts remain needs_manual_review", () => {
  const scenario = get("B31-FACT-SAME-AMOUNT");
  const wrongRelations = "Cedar 由周岚负责，预算 30 万元；Maple 由林安负责，预算 30 万元。";
  const score = assessThinExecutionCase(scenario, {
    thin: { effect: "answer", text: wrongRelations, completed: true, calls: 1, program: false, autoApplied: false, sourceUntouched: true }
  }).lanes.thin;
  assert.equal(score.layers.task.status, "pass");
  assert.equal(score.layers.quality.status, "needs_manual_review");
  assert.equal(score.disposition, "needs_manual_review");
  assert.ok(!score.failedLayers.includes("quality"));
});

test("code contracts verify fence/name/heading while leaving behavior for human review", () => {
  const scenario = get("B31-CODE-H2");
  const text = "## API <v2> & C++\n\n```typescript\nexport function greetUser(name: string): string { return name; }\n```";
  const score = assessThinExecutionCase(scenario, { thin: completeObservation(scenario, text) }).lanes.thin;
  assert.equal(score.layers.format.status, "pass");
  assert.equal(score.layers.parameters.status, "pass");
  assert.equal(score.layers.quality.status, "needs_manual_review");
  assert.equal(score.disposition, "needs_manual_review");
});
