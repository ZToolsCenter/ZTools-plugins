import { describe, expect, it, vi } from "vitest";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { resolveAiEdit } from "../../src/core/ai/editProposal";

async function replace(source: string, find: string, text: string, instruction = `把“${find}”替换成“${text}”。`) {
  const invoke = vi.fn(async () => JSON.stringify({ version: 1, kind: "edit", operation: "replace_exact", target: "document", find, occurrence: "single", content: { mode: "literal", text } }));
  const result = await runPlannedAiTask({ source, action: "custom", userPrompt: instruction, baseSystemPrompt: "", actionDefinition: { id: "custom", label: "自定义", prompt: instruction } }, { content: source, documentId: "case.md", revision: 2, selection: null, cursor: null, readOnly: false }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });
  return { result, invoke };
}
describe("exact protected-node edits through the production task runner", () => {
  it.each([
    ['正文\n\n```ts\nconst value = "old-value";\n```', "old-value", "new-value"],
    ['| 字段 | 值 |\n| --- | --- |\n| 状态 | old-value |', "old-value", "new-value"],
    ['[文档](https://example.test/old-path)', "old-path", "new-path"],
    ['---\r\ntitle: old-title\r\nauthor: stable\r\n---\r\n\r\n# 正文', "old-title", "new-title"],
    ['面积为 $x^2$。', "x^2", "x^3"]
  ])("creates one literal patch without content generation: %s", async (source, find, text) => {
    const { result, invoke } = await replace(source, find, text);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.proposal?.patch).toEqual({ from: source.indexOf(find), to: source.indexOf(find) + find.length, expectedText: find, insertText: text });
    expect(resolveAiEdit(result.proposal!)?.content).toBe(source.replace(find, text));
  });
  it("keeps footnote ID rename blocked because every reference must be changed atomically", async () => {
    await expect(replace("正文[^1]。\n\n[^1]: 说明。", "[^1]:", "[^2]:")).rejects.toThrow(/AST|脚注/);
  });
  it("blocks a literal cell replacement that would add a table column", async () => {
    await expect(replace("| A | B |\n| --- | --- |\n| one | old-value |", "old-value", "new | column")).rejects.toThrow(/AST|结构/);
  });
});
