import { describe, expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { parseArtifactInstructionFields } from "../../src/core/ai/artifactInstructionFields";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

const source = "# Existing\n\nKeep this source.";
const snapshot: AiDocumentSnapshot = {
  documentId: "compound-heading.md", revision: 1, content: source,
  selection: null, cursor: source.length, readOnly: false
};

function specFor(instruction: string) {
  return resolveArtifactSpec(instruction, resolveGenerationRequirements(instruction), { effect: "edit", operation: "insert" });
}

function request(instruction: string) {
  return buildAiTaskRequest({ source, selected: false, action: "custom", userPrompt: instruction,
    config: { provider: "local", activeRoleId: "general" } });
}

function options(invoke: AiTaskRunnerOptions["invoke"]): AiTaskRunnerOptions {
  return { invoke, isCurrent: () => true, abortCurrent: vi.fn() };
}

describe("compound Markdown code-block instructions", () => {
  it("deterministically composes an unquoted heading and fully specified unordered-list item", async () => {
    const instruction = "在文末新增代码块 markdown 格式，内容为标题一 hello 和一条无序列表 world。";
    const spec = specFor(instruction);
    expect(spec).toMatchObject({ kind: "code", language: { value: "markdown" }, composition: "complete",
      heading: { level: { value: 1 }, text: { value: "hello" } } });
    if (spec.kind !== "code" || !spec.heading?.text) throw new Error("Expected the literal heading span.");
    const evidence = spec.heading.text.evidence[0];
    expect(instruction.slice(evidence.from, evidence.to)).toBe("hello");

    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("A fully specified Markdown body should not need a model call.");
    });
    const result = await runPlannedAiTaskCore(request(instruction), snapshot, options(invoke));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.proposal?.patch?.insertText).toContain("```markdown\n# hello\n\n- world\n```");
    expect(result.proposal?.patch).toMatchObject({ from: source.length, to: source.length, expectedText: "" });
  });

  it.each([
    ["在文末新增 Markdown 代码块，一级标题 hello and a bullet list world。", "complete", "# hello\n\n- world"],
    ["新增代码块 markdown 格式 标题一 hello 以及一个表格 world。", "partial", undefined],
    ["新增代码块 markdown 格式 标题一 hello 和一段正文“paragraph details”。", "complete", "# hello\n\nparagraph details"]
  ])("composes only a fully specified secondary Markdown body: %s", (instruction, composition, body) => {
    const parsed = parseArtifactInstructionFields(instruction, resolveGenerationRequirements(instruction), "code", false);
    const heading = parsed.heading?.text;
    expect(heading?.value).toBe("hello");
    if (!heading) throw new Error("Expected the grounded heading text.");
    const evidence = heading.evidence[0];
    expect(instruction.slice(evidence.from, evidence.to)).toBe("hello");
    expect(parsed.composition).toBe(composition);
    expect(parsed.literalBody?.value).toBe(body);
  });

  it("keeps a quoted heading literal even when it contains a structure phrase", async () => {
    const instruction = "在文末新增代码块 markdown 格式 标题一“hello 和一条无序列表 world”。";
    const spec = specFor(instruction);
    expect(spec).toMatchObject({ kind: "code", composition: "complete",
      heading: { text: { value: "hello 和一条无序列表 world" } } });
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("A fully quoted literal heading must not be reinterpreted as an action.");
    });
    const result = await runPlannedAiTaskCore(request(instruction), snapshot, options(invoke));
    expect(invoke).not.toHaveBeenCalled();
    expect(result.proposal?.patch?.insertText).toContain("# hello 和一条无序列表 world");
  });

  it("composes an explicit paragraph that follows a title", () => {
    const instruction = "在文末新增代码块 markdown 格式 标题一 hello 和一段正文“paragraph details”。";
    const parsed = parseArtifactInstructionFields(instruction, resolveGenerationRequirements(instruction), "code", false);
    expect(parsed.heading?.text?.value).toBe("hello");
    expect(parsed.composition).toBe("complete");
    expect(parsed.literalBody?.value).toBe("# hello\n\nparagraph details");
  });
});
