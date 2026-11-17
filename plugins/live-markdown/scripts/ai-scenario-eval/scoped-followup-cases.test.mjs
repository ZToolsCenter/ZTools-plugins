import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildScopedFollowupCases,
  extractQuickstartTemplate,
  scoreScopedFollowupCase
} from "./scoped-followup-cases.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = ".cache/acceptance/ai-common-failures/v1";
const frozen = JSON.parse(fs.readFileSync(path.join(pluginRoot, base, "run-inputs/case-manifest.json"), "utf8"));
const nativeSource = fs.readFileSync(path.join(pluginRoot, base, "native-host-20261023/executed-native-fixture.md"), "utf8");
const candidateModule = fs.readFileSync(path.join(pluginRoot, "src/core/sampleDocs.ts"), "utf8");

function buildCases() {
  return buildScopedFollowupCases({
    frozenManifest: frozen,
    nativeSource,
    welcomeSource: extractQuickstartTemplate(candidateModule),
    nativeSourceProvenance: { path: `${base}/native-host-20261023/executed-native-fixture.md`, sha256: "fixture-hash" }
  });
}

function patchRecord(item, insertText, from = item.source.length, to = from) {
  const sourceEnd = item.source.slice(0, from);
  const sourceTail = item.source.slice(to);
  const content = sourceEnd + insertText + sourceTail;
  return {
    snapshot: { content: item.source },
    calls: [],
    result: null,
    resolvedEdit: { from, to, expectedText: item.source.slice(from, to), insertText, content }
  };
}

describe("scoped follow-up case freeze and scoring", () => {
  it("freezes native, rich Welcome, exact 87-case, and boundary examples", () => {
    const cases = buildCases();
    expect(cases).toHaveLength(11);
    const native = cases.find(({ id }) => id === "sf-native-multiply-exact");
    const welcome = cases.find(({ id }) => id === "sf-native-multiply-welcome");
    expect(native.source).toBe(nativeSource);
    expect(welcome.instruction).toBe(native.instruction);
    expect(welcome.source).toContain("# Welcome to Live Markdown");
    expect(cases.find(({ id }) => id === "sf-ambiguous-target-requires-clarification").instruction)
      .toContain("位置由我稍后确定");
    for (const id of ["G16", "H16-continue-no-invented-date-01", "L25"]) {
      const original = frozen.realCases.find((item) => item.id === id);
      const scoped = cases.find((item) => item.id === id);
      expect(scoped.source).toBe(original.source);
      expect(scoped.instruction).toBe(original.instruction);
    }
  });

  it("scores only the exact L25 patch and unchanged text outside the selection", () => {
    const item = buildCases().find(({ id }) => id === "L25");
    const expected = item.assessment.expectedPatch;
    const record = patchRecord(item, expected.insertText, expected.from, expected.to);
    record.resolvedEdit.expectedText = expected.expectedText;
    expect(scoreScopedFollowupCase(item, record)).toMatchObject({ status: "passed", checks: { exactPatch: true, sourceOutsideSelectionPreserved: true } });
    record.resolvedEdit.insertText = "**已改坏**";
    record.resolvedEdit.content = item.source.slice(0, expected.from) + "**已改坏**" + item.source.slice(expected.to);
    expect(scoreScopedFollowupCase(item, record).status).toBe("failed");
  });

  it("uses lexical static code checks and never claims generated code was executed", () => {
    const item = buildCases().find(({ id }) => id === "sf-native-multiply-exact");
    const insertion = "```python\ndef multiply(a, b):\n    return a * b\n```";
    const record = patchRecord(item, insertion);
    expect(scoreScopedFollowupCase(item, record)).toMatchObject({
      status: "passed",
      checks: { lexicalStaticCheck: true },
      staticAnalysis: { type: "lexicalStaticCheck", generatedCodeExecuted: false, provesPythonOrJavaScriptExecution: false }
    });
    const wrong = patchRecord(item, "```python\ndef other(a, b):\n    return a * b\n```");
    expect(scoreScopedFollowupCase(item, wrong).status).toBe("failed");
  });

  it("accepts the explicitly enumerated commutative clamp form without relaxing arbitrary returns", () => {
    const item = buildCases().find(({ id }) => id === "sf-code-python-clamp-short-variant");
    const commutative = patchRecord(item, "\n```python\ndef clamp(value, lower, upper):\n    return max(min(value, upper), lower)\n```");
    expect(scoreScopedFollowupCase(item, commutative)).toMatchObject({ status: "passed", checks: { returnBehavior: true, lexicalStaticCheck: true } });

    const wrongOrder = patchRecord(item, "\n```python\ndef clamp(value, lower, upper):\n    return max(min(value, lower), upper)\n```");
    const arbitrary = patchRecord(item, "\n```python\ndef clamp(value, lower, upper):\n    return value + lower + upper\n```");
    expect(scoreScopedFollowupCase(item, wrongOrder).checks.returnBehavior).toBe(false);
    expect(scoreScopedFollowupCase(item, arbitrary).checks.returnBehavior).toBe(false);
  });

  it("passes grounded actions only with one program-mode call, legal traceable facts, and concrete steps", () => {
    const item = buildCases().find(({ id }) => id === "G16");
    const quote = "发布前必须完成备份与恢复演练。";
    const from = item.source.indexOf(quote);
    const id = `sf:${from}:${from + quote.length}:constraint`;
    const insertText = "- 建议演练：准备与该事项对应的检查输入，执行相关演练，记录观察结果及发现的问题。\n依据摘录：必须完成备份与恢复演练";
    const record = patchRecord(item, insertText);
    record.result = { planningMode: "program", sourceFacts: [quote] };
    record.calls = [{
      prompt: `可引用事实 ID：${JSON.stringify([{ id, quote }])}\n\n只返回 suggestions。`,
      raw: JSON.stringify({ suggestions: [{ action: "演练", evidenceIds: [id] }] })
    }];
    expect(scoreScopedFollowupCase(item, record)).toMatchObject({
      status: "passed",
      checks: {
        appendedAtEof: true,
        singleProgrammedContentCall: true,
        legalActionsAndTraceableFacts: true,
        operationResultEvidencePerAction: true
      }
    });
    expect(scoreScopedFollowupCase(item, record).evidence.procedureSteps.length).toBeGreaterThanOrEqual(2);
  });

  it("does not pass generic action-template wording without required topics and captured source evidence", () => {
    const item = buildCases().find(({ id }) => id === "G16");
    const record = patchRecord(item, "- 建议核对：将该事项拆成检查点，逐项核对前置条件、实际结果与完成证据，并记录未满足项。\n依据摘录：一般工作事项");
    record.result = { planningMode: "program", sourceFacts: [] };
    record.calls = [{ prompt: "可引用事实 ID：[]\n\n只返回 suggestions。", raw: JSON.stringify({ suggestions: [] }) }];
    expect(scoreScopedFollowupCase(item, record).status).not.toBe("passed");
  });

  it("requires H16 append placement, all next-step topics, and a source-bound operation", () => {
    const item = buildCases().find(({ id }) => id === "H16-continue-no-invented-date-01");
    const quote = "下一步应核对依赖清单、安排双人复核并记录结果。";
    const from = item.source.indexOf(quote);
    const id = `sf:${from}:${from + quote.length}:action`;
    const insertText = "- 建议核对：将该事项拆成检查点，逐项核对前置条件、实际结果与完成证据，并记录未满足项。\n依据摘录：核对依赖清单、安排双人复核并记录结果";
    const record = patchRecord(item, insertText);
    record.result = { planningMode: "program", sourceFacts: [quote] };
    record.calls = [{
      prompt: `可引用事实 ID 与可执行动作：${JSON.stringify([{ id, quote }])}\n\n只返回 suggestions。`,
      raw: JSON.stringify({ suggestions: [{ action: "核对", evidenceIds: [id] }] })
    }];
    expect(scoreScopedFollowupCase(item, record)).toMatchObject({
      status: "passed",
      checks: { appendedAtEof: true, requiredTopics: true, distinctConcreteActions: true, legalActionsAndTraceableFacts: true }
    });
  });

  it("labels product clarification as a safe stop while keeping task-answer completion separate", () => {
    const cases = buildCases();
    const missingSelection = cases.find(({ id }) => id === "sf-missing-selection-no-full-document-fallback");
    const missing = { snapshot: { content: missingSelection.source }, calls: [], result: null, resolvedEdit: null, error: { name: "PlanValidationError", code: "selection_required" } };
    expect(scoreScopedFollowupCase(missingSelection, missing)).toMatchObject({ status: "passed", outcome: "safe-stop", taskAnswerCompleted: false, checks: { productTerminalObserved: true, expectedTerminalReason: true, taskAnswerCompleted: false } });

    const ambiguous = cases.find(({ id }) => id === "sf-ambiguous-target-requires-clarification");
    const clarified = { snapshot: { content: ambiguous.source }, calls: [{ raw: JSON.stringify({ version: 1, kind: "clarify", reason: "missing_operation" }), error: null }], result: null, resolvedEdit: null, error: { name: "PlanValidationError", code: "invalid_evidence", message: "指令证据与当前指令不一致，尚未修改文档。" } };
    expect(scoreScopedFollowupCase(ambiguous, clarified)).toMatchObject({ status: "passed", outcome: "safe-stop", taskAnswerCompleted: false, checks: { productTerminalObserved: true, expectedTerminalReason: false, taskAnswerCompleted: false } });

    const negated = cases.find(({ id }) => id === "sf-negated-edit-is-answer-only");
    const binderClarification = { snapshot: { content: negated.source }, calls: [{ raw: JSON.stringify({ version: 1, kind: "clarify", reason: "missing_target" }), error: null }], result: null, resolvedEdit: null, error: { name: "Error", message: "请说明修改位置，例如文末、某个标题后或当前选区。" } };
    expect(scoreScopedFollowupCase(negated, binderClarification)).toMatchObject({ status: "passed", outcome: "safe-stop", taskAnswerCompleted: false });
    expect(scoreScopedFollowupCase(negated, { snapshot: { content: negated.source }, calls: [{ raw: "回答内容" }], result: { answerOnly: true }, resolvedEdit: null })).toMatchObject({ status: "passed", outcome: "answer-only", taskAnswerCompleted: true });

    const unavailable = { ...clarified, calls: [{ raw: null, error: { name: "FetchError", code: "ECONNREFUSED" } }], error: { name: "FetchError", code: "ECONNREFUSED" } };
    expect(scoreScopedFollowupCase(ambiguous, unavailable)).toMatchObject({ status: "incomplete", outcome: "infrastructure-incomplete" });
    expect(scoreScopedFollowupCase(ambiguous, { ...clarified, error: { name: "TypeError", message: "Runtime crashed" } })).toMatchObject({ status: "incomplete", outcome: "infrastructure-incomplete" });
    expect(scoreScopedFollowupCase(ambiguous, { ...clarified, calls: [], error: null })).toMatchObject({ status: "incomplete", outcome: "unverified-no-write" });
  });
});
