import { describe, expect, it, vi } from "vitest";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

const source = "# 原文\n\n这段正文必须保留。";
const snapshot: AiDocumentSnapshot = {
  documentId: "explicit-code.md", revision: 1, content: source,
  selection: null, cursor: null, selectionValid: true, readOnly: false
};

describe("explicit code artifact validation across creation verbs", () => {
  it.each(["追加", "增加", "生成"])("keeps the code artifact for an explicit %s request", async (verb) => {
    const instruction = `在文末${verb} Python 代码块。`;
    expect(resolveGenerationRequirements(instruction).artifact).toMatchObject({ state: "explicit", value: "code" });
    const invoke = vi.fn(async (prompt: string) => prompt.includes("本次用户指令：")
      ? JSON.stringify({ version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "generate", task: "custom" } })
      : "这是普通说明，没有用户要求的代码块。");
    await expect(runPlannedAiTask({
      source, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出新增内容。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snapshot, { invoke, isCurrent: () => true, abortCurrent: vi.fn() })).rejects.toThrow(/代码块/u);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
