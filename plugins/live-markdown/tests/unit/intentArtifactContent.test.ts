import { describe, expect, it, vi } from "vitest";
import { isCompleteLiteralCodeArtifact } from "../../src/core/ai/intentArtifactContent";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTaskCore } from "../../src/core/ai/fullHarnessTaskRunnerCore";

describe("code artifact literal shape", () => {
  it.each([
    "```txt\nhello\n```",
    "```txt\n标题路径: foo\n```",
    "```markdown\n【当前正文段落】\n```"
  ])("accepts complete user-provided code without applying model-leak rules to its body: %s", text => {
    expect(isCompleteLiteralCodeArtifact(text)).toBe(true);
  });

  it.each(["markdown", "hello", "# hello", "```\nhello\n```", "```markdown\n# hello"])("rejects an incomplete or unlabelled code artifact: %s", text => {
    expect(isCompleteLiteralCodeArtifact(text)).toBe(false);
  });

  it("preserves a complete quoted code literal including editor-like field names", async () => {
    const source = "原文保持不变。";
    const code = "```txt\n标题路径: foo\n```";
    const instruction = `在文末原样新增代码块“${code}”`;
    const invoke = vi.fn(async () => { throw new Error("A complete literal must not need inference."); });
    const result = await runPlannedAiTaskCore({
      source, action: "custom", userPrompt: instruction, baseSystemPrompt: "只输出结果。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, { documentId: "literal-code.md", revision: 1, content: source, selection: null, cursor: source.length, readOnly: false }, {
      invoke, isCurrent: () => true, abortCurrent: vi.fn()
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.proposal?.patch?.insertText).toBe(`\n\n${code}`);
    expect(result.proposal?.snapshot.content).toBe(source);
  });
});
