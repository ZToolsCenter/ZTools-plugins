import { describe, expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTaskCore } from "../../src/core/ai/fullHarnessTaskRunnerCore";

const source = "# 项目记录\n\n当前计划需要复核。\n\n文档末尾保留。";
const snapshot = (content = source, selected = false) => ({
  documentId: "intent-stage.md",
  revision: 1,
  content,
  selection: selected ? { from: 0, to: 5 } : null,
  selectionValid: true,
  cursor: content.length,
  readOnly: false
});

function request(instruction: string, action: "custom" | "polish" = "custom", content = source) {
  return buildAiTaskRequest({
    source: content,
    selected: false,
    action,
    userPrompt: instruction,
    config: { provider: "local", activeRoleId: "general" }
  });
}

function options(invoke: AiTaskRunnerOptions["invoke"]): AiTaskRunnerOptions {
  return { invoke, isCurrent: () => true, abortCurrent: vi.fn() };
}

function plan(kind: "answer" | "clarify", task = "custom") {
  return JSON.stringify(kind === "answer"
    ? { version: 1, kind, target: "document", content: { mode: "generate", task } }
    : { version: 1, kind, reason: "missing_operation" });
}

function insertPlan(task = "custom") {
  return JSON.stringify({
    version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
    content: { mode: "generate", task }
  });
}

function isPlanner(prompt: string): boolean {
  return prompt.includes("本次用户指令：");
}

describe("model-first natural-language intent stages", () => {
  const metaQuestions = [
    "润色的标准是什么？",
    "如何润色这段话？",
    "校对有哪些方法？",
    "为什么要润色全文？",
    "What does proofreading mean?",
    "How do I polish this?",
    "续写有什么技巧？",
    "帮我解释一下怎么续写。",
    "续写的定义是什么？",
    "总结全文的方法是什么？",
    "如何润色选区？",
    "告诉我如何在文末增加 hello。"
  ];

  it.each(metaQuestions)("plans a question about editing before producing an answer: %s", async instruction => {
    const stages: string[] = [];
    const promptInputs: string[] = [];
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt, _system, _max, _chunk, schema) => {
      promptInputs.push(prompt);
      if (isPlanner(prompt)) {
        stages.push("planner");
        expect(schema).toBeDefined();
        return plan("answer");
      }
      stages.push("answer");
      return "这句话是在询问写作方法，文档内容不会因此改变。";
    });

    const result = await runPlannedAiTaskCore(request(instruction), snapshot(), options(invoke));

    expect(stages).toEqual(["planner", "answer"]);
    expect(promptInputs[0]).toContain(instruction);
    expect(promptInputs[0]).not.toContain("当前计划需要复核");
    expect(result).toMatchObject({ planningMode: "model", answerOnly: true, resolvedIntent: { kind: "answer", content: { task: "custom" } } });
    expect(result.proposal).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["在文末新增一个 Python 代码块，实现 multiply(a,b) 并返回乘积。", "```python\ndef multiply(a, b):\n    return a * b\n```", "custom"],
    ["底部新增 Markdown代码块，生成一个关于安全的一级标题", "```markdown\n# 安全提示\n```", "custom"],
    ["我希望结尾多一段简短的行动建议", "## 下一步\n\n- 核对待确认事项。", "continue"]
  ] as const)("gets a structured plan before generating free-form content: %s", async (instruction, generated, task) => {
    const stages: string[] = [];
    const promptInputs: string[] = [];
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt, _system, _max, _chunk, schema) => {
      promptInputs.push(prompt);
      if (isPlanner(prompt)) {
        stages.push("planner");
        expect(schema).toBeDefined();
        return insertPlan(task);
      }
      stages.push("generator");
      return generated;
    });

    const result = await runPlannedAiTaskCore(request(instruction), snapshot(), options(invoke));

    expect(stages).toEqual(["planner", "generator"]);
    expect(promptInputs[0]).toContain(instruction);
    expect(promptInputs[0]).not.toContain("当前计划需要复核");
    expect(result.planningMode).toBe("model");
    expect(result.proposal?.patch?.from).toBe(source.length);
    expect(result.proposal?.patch?.insertText).toContain(generated);
    expect(result.proposal?.snapshot.content).toBe(source);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("stops on a model clarification without generating or proposing an edit", async () => {
    const instruction = "给最后那块处理一下";
    const prompts: string[] = [];
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async prompt => {
      prompts.push(prompt);
      return plan("clarify");
    });

    await expect(runPlannedAiTaskCore(request(instruction), snapshot(), options(invoke))).rejects.toThrow(/请说明要对文档执行什么操作/);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(instruction);
    expect(prompts[0]).not.toContain("当前计划需要复核");
  });

  it("does not retry an invalid plan or continue to content generation", async () => {
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => JSON.stringify({ version: 1, kind: "edit", operation: "rewrite", target: "selection", content: { mode: "generate", task: "polish" } }));

    await expect(runPlannedAiTaskCore(request("如何润色这段话？"), snapshot(), options(invoke))).rejects.toThrow();

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps grounded literal append content out of generation and strict heading artifacts on the zero-call route", async () => {
    const original = "已有正文。";
    const appendInvoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => JSON.stringify({
      version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
      content: { mode: "literal", text: "hello" }
    }));
    const append = await runPlannedAiTaskCore(request("底部加hello", "custom", original), snapshot(original), options(appendInvoke));

    expect(appendInvoke).toHaveBeenCalledTimes(1);
    expect(isPlanner(appendInvoke.mock.calls[0][0])).toBe(true);
    expect(append.proposal?.patch?.insertText).toBe("\n\nhello");

    const artifactInvoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => { throw new Error("A strict artifact template must not invoke a model."); });
    const artifact = await runPlannedAiTaskCore(
      request("底部新增代码块 markdown 标题一 hello", "custom", original),
      snapshot(original),
      options(artifactInvoke)
    );
    expect(artifactInvoke).not.toHaveBeenCalled();
    expect(artifact.proposal?.patch?.insertText).toBe("\n\n```markdown\n# hello\n```");
  });

  it("keeps explicit task buttons on their direct generation path", async () => {
    const original = "需要复核。";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "需要复核！");
    const result = await runPlannedAiTaskCore(request("", "polish", original), snapshot(original), options(invoke));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(isPlanner(invoke.mock.calls[0][0])).toBe(false);
    expect(result.proposal?.patch?.insertText).toBe("需要复核！");
  });
});
