import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateScenarioV2 } from "./scenario-v2-oracles.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(here, "../../.cache/acceptance/ai-scenarios/v1/case-manifest.json"), "utf8"));
const item = (id) => structuredClone(cases.realCases.find((candidate) => candidate.id === id));
const noOpModules = {
  isAiProposalCurrent: () => true,
  validateMarkdownFragmentCompleteness: () => {},
  validateMarkdownAppendIntegrity: () => {},
  validateMarkdownAstIntegrity: () => {}
};

function recordFor(candidate, overrides = {}) {
  return {
    snapshot: { content: candidate.source, selection: candidate.selection ?? null, revision: 1 },
    rawParsedIntent: null, rawParsedError: null, plannerIntent: null, plannerError: null,
    calls: [], result: null, resolvedEdit: null, error: null,
    inputSnapshotUnchanged: true, sourceUnchanged: true, ...overrides
  };
}

test("B04 recognizes equivalent wording for the document's final portion", () => {
  const candidate = item("B04");
  const record = recordFor(candidate, {
    rawParsedIntent: { kind: "answer", target: "document", content: { mode: "generate", task: "custom" } },
    result: { answerOnly: true, text: "草稿将在稿件的最后部分发布为终稿。" },
    calls: [{ phase: "planning" }, { phase: "generation" }]
  });
  const evaluation = evaluateScenarioV2(candidate, record, noOpModules);
  assert.equal(evaluation.strictIntent.pass, true);
  assert.equal(evaluation.quality.pass, true);
});

test("G07 recognizes completed wording without dropping the typo-correction rubric", () => {
  const candidate = item("G07");
  const text = "我们已完成备份，接下来会对恢复步骤进行检查。";
  const expected = candidate.expected.patch;
  const content = candidate.source.slice(0, expected.from) + text + candidate.source.slice(expected.to);
  const record = recordFor(candidate, {
    rawParsedIntent: { kind: "edit", operation: "rewrite", target: "selection", content: { mode: "generate", task: "polish" } },
    result: { proposal: { id: "fixture" }, text },
    resolvedEdit: { ...expected, insertText: text, content },
    calls: [{ phase: "planning" }, { phase: "generation" }]
  });
  const evaluation = evaluateScenarioV2(candidate, record, noOpModules);
  assert.equal(evaluation.strictIntent.pass, true);
  assert.equal(evaluation.quality.pass, true);
  assert.equal(evaluation.range.pass, true);
});

test("B06 accepts the product compound-edit diagnostic while keeping strict intent separate", () => {
  const candidate = item("B06");
  const message = "检测到这条指令包含多个编辑操作，请拆分成单条指令后再发送。原文尚未修改。";
  const record = recordFor(candidate, {
    rawParsedIntent: { kind: "edit", operation: "insert", target: "document_end", content: { mode: "literal", literalId: "literal-1" } },
    error: { message }, calls: [{ phase: "planning" }]
  });
  const evaluation = evaluateScenarioV2(candidate, record, noOpModules);
  assert.equal(evaluation.policy.pass, true);
  assert.equal(evaluation.policy.diagnosticEquivalent, true);
  assert.equal(evaluation.userTask.pass, true);
  assert.equal(evaluation.strictIntent.pass, false);
  assert.equal(evaluation.userTaskQualityRangeScore.pass, true);
});

test("B22 accepts the generic AST guard as a safe protected-footnote rejection", () => {
  const candidate = item("B22");
  const record = recordFor(candidate, {
    rawParsedIntent: { kind: "edit", operation: "replace_exact", target: "document", find: "[^1]:", occurrence: "single", content: { mode: "literal", text: "[^2]:" } },
    error: { message: "AI 输出未通过 Markdown AST 结构校验（代码、表格、HTML、链接目标或其所在结构被修改），未生成可应用的修改。" },
    calls: [{ phase: "planning" }]
  });
  const evaluation = evaluateScenarioV2(candidate, record, noOpModules);
  assert.equal(evaluation.strictIntent.pass, true);
  assert.equal(evaluation.policy.pass, true);
  assert.equal(evaluation.safety.pass, true);
});

test("G04 exposes Mermaid structural-subset scoring as unverified rendering", () => {
  const candidate = item("G04");
  const record = recordFor(candidate, {
    result: { text: "```mermaid\ngraph LR\nstart[开始] --> audit[审核]\naudit --> finish[结束]\n```" },
    calls: [{ phase: "planning" }, { phase: "generation" }]
  });
  const evaluation = evaluateScenarioV2(candidate, record, noOpModules);
  assert.equal(evaluation.quality.pass, true);
  assert.equal(evaluation.quality.rendering.verified, false);
  assert.ok(evaluation.quality.rendering.unverified.includes("native visual rendering"));
});
