import { describe, expect, it, vi } from "vitest";
import { resolveIntentGenerationRequirements } from "../../src/core/ai/intentGenerationRequirements";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTaskCore } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import type { ValidatedIntent } from "../../src/core/ai/intentTypes";

const answer = (task: "custom" | "summarize" = "custom"): ValidatedIntent => ({
  version: 1, kind: "answer", target: "document", content: { mode: "generate", task }
});
const generatedEdit: ValidatedIntent = {
  version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
  content: { mode: "generate", task: "custom" }
};

describe("generation requirements follow the resolved intent", () => {
  it.each([
    "如何新增代码块？",
    "如何在文末添加一个 Markdown 表格？",
    "如何使用 LaTeX 公式？"
  ])("does not treat an artifact discussed in an answer question as a required output format: %s", instruction => {
    const requirements = resolveIntentGenerationRequirements(instruction, answer());
    expect(requirements.artifact.state).toBe("unknown");
    expect(requirements.display.state).toBe("unknown");
    expect(requirements.contentInstruction).toBe(instruction);
  });

  it.each([
    ["如何新增代码块？请用代码块举例。", "code"],
    ["请用表格解释如何校对", "table"],
    ["如何写公式？请给出 LaTeX 公式示例。", "math"]
  ] as const)("keeps an explicitly requested answer medium: %s", (instruction, expected) => {
    const requirements = resolveIntentGenerationRequirements(instruction, answer());
    expect(requirements.artifact).toMatchObject({ state: "explicit", value: expected });
    expect(requirements.contentInstruction).toBe(instruction);
  });

  it.each([
    ["如何新增代码块？不要用代码块举例。", "unknown"],
    ["如何新增代码块？解释‘用代码块举例’这句话。", "unknown"],
    ["如何新增代码块？不要用代码块举例，请用表格解释。", "table"]
  ] as const)("ignores quoted or negated format mentions while keeping a later positive medium: %s", (instruction, expected) => {
    const requirements = resolveIntentGenerationRequirements(instruction, answer());
    if (expected === "unknown") expect(requirements.artifact.state).toBe("unknown");
    else expect(requirements.artifact).toMatchObject({ state: "explicit", value: expected });
    expect(requirements.contentInstruction).toBe(instruction);
  });

  it("preserves a requested table for a read-only summary answer", () => {
    const instruction = "生成一张 Markdown 表格总结全文，只回答，不修改文档";
    const requirements = resolveIntentGenerationRequirements(instruction, answer("summarize"));
    expect(requirements.artifact).toMatchObject({ state: "explicit", value: "table" });
    expect(requirements.factPolicy).toBe("source_bound");
  });

  it("keeps edit-generation format extraction unchanged", () => {
    const instruction = "在文末新增一个 Python 代码块，实现 multiply(a,b) 并返回乘积。";
    const requirements = resolveIntentGenerationRequirements(instruction, generatedEdit);
    expect(requirements.artifact).toMatchObject({ state: "explicit", value: "code" });
    expect(requirements.contentInstruction).toContain("实现 multiply(a,b)");
    expect(requirements.contentInstruction).not.toContain("在文末");
  });

  it("lets the production answer runner explain an artifact question without creating a proposal", async () => {
    const source = "当前文稿不涉及代码围栏。";
    const instruction = "如何新增代码块？";
    const stages: string[] = [];
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt, _system, _max, _emit, schema) => {
      if (prompt.includes("本次用户指令：")) {
        stages.push("planner");
        expect(schema).toBeDefined();
        return JSON.stringify({ version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "custom" } });
      }
      stages.push("answer");
      expect(prompt).toContain(instruction);
      expect(prompt).not.toMatch(/必须使用代码围栏|只输出代码块|code block is required/iu);
      return "在 Markdown 中，代码块用三反引号包围代码；开始围栏后可以标注语言。";
    });
    const request = buildAiTaskRequest({ source, selected: false, action: "custom", userPrompt: instruction, config: { provider: "local", activeRoleId: "general" } });
    const snapshot = { documentId: "intent-answer.md", revision: 1, content: source, selection: null, cursor: source.length, readOnly: false };
    const result = await runPlannedAiTaskCore(request, snapshot, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(stages).toEqual(["planner", "answer"]);
    expect(result).toMatchObject({ planningMode: "model", answerOnly: true, resolvedIntent: { kind: "answer", content: { task: "custom" } } });
    expect(result.proposal).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
