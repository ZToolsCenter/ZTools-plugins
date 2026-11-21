import { describe, expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { createLiteralMarkdownArtifact } from "../../src/core/ai/literalMarkdownArtifact";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTaskCore } from "../../src/core/ai/fullHarnessTaskRunnerCore";

const source = "# 文稿\n\nPRIVATE_SOURCE_TOKEN 保持原样。\n\n末段不变。";
const artifact = "```markdown\n# hello\n```";

function request(instruction: string) {
  return buildAiTaskRequest({
    source,
    selected: false,
    action: "custom",
    userPrompt: instruction,
    config: { provider: "ztools", activeRoleId: "general" }
  });
}

function snapshot(cursor: number | null = null) {
  return { documentId: "literal-heading.md", revision: 26, content: source, selection: null, cursor, readOnly: false };
}

function runnerOptions(invoke: AiTaskRunnerOptions["invoke"]): AiTaskRunnerOptions {
  return { invoke, isCurrent: () => true, abortCurrent: vi.fn() };
}

function insertPlan(target: "document_end" | "cursor") {
  return JSON.stringify({
    version: 1,
    kind: "edit",
    operation: "insert",
    target,
    layout: "block",
    content: { mode: "generate", task: "custom" }
  });
}

function insertContentAlternatives(schema: Record<string, unknown>) {
  const branches = schema.anyOf as Array<{ properties?: Record<string, unknown> }>;
  const insertBranch = branches.find(({ properties }) =>
    (properties?.operation as { const?: string } | undefined)?.const === "insert");
  const content = insertBranch?.properties?.content as {
    anyOf?: Array<{ properties?: Record<string, unknown> }>;
  } | undefined;
  return content?.anyOf ?? [];
}

const literalHeadingBriefCases: Array<[string, string]> = [
  ["代码块markdown的标题一 hello", artifact],
  ["markdown 的代码块，里面加个 H1 的 hello", artifact],
  ["Markdown代码块 标题2 hello world", "```markdown\n## hello world\n```"],
  ...Array.from({ length: 6 }, (_, index): [string, string] => {
    const level = index + 1;
    return [`代码块 markdown H${level} hello`, `\`\`\`markdown\n${"#".repeat(level)} hello\n\`\`\``];
  }),
  ["Markdown代码块，内容为H2的‘Hello, world!’", "```markdown\n## Hello, world!\n```"],
  ["代码块的markdown 标题三：‘v1.2 ready?’", "```markdown\n### v1.2 ready?\n```"]
];

const invalidLiteralPlans: Array<{ label: string; content: Record<string, string>; candidateText?: string }> = [
  { label: "plain hello text", content: { mode: "literal", text: "hello" } },
  { label: "the markdown candidate literal-1 from the observed model trace", content: { mode: "literal", literalId: "literal-1" }, candidateText: '"id":"literal-1","text":"markdown"' }
];

describe("literal Markdown heading intent contract", () => {
  it.each(literalHeadingBriefCases)("compiles a closed literal heading brief without losing its slots: %s", (brief, expected) => {
    expect(createLiteralMarkdownArtifact(brief)).toBe(expected);
  });

  it.each([
    ["新增代码块markdown的标题一 hello", "document_end", null],
    ["光标处新增代码块markdown的标题一 hello", "cursor", source.indexOf("PRIVATE_SOURCE_TOKEN")]
  ] as const)("plans before compiling a fixed heading and never calls content generation: %s", async (instruction, target, cursor) => {
    const prompts: string[] = [];
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt, _system, _max, _chunk, schema) => {
      prompts.push(prompt);
      return schema ? insertPlan(target) : artifact;
    });
    const result = await runPlannedAiTaskCore(
      request(instruction),
      snapshot(cursor),
      runnerOptions(invoke)
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(prompts[0]).toContain("本次用户指令：");
    expect(prompts[0]).toContain(instruction);
    expect(prompts[0]).not.toContain("PRIVATE_SOURCE_TOKEN");
    expect(result).toMatchObject({
      planningMode: "model",
      resolvedIntent: { kind: "edit", operation: "insert", target, layout: "block", content: { mode: "generate", task: "custom" } }
    });
    expect(result.proposal?.patch).toMatchObject({ from: target === "cursor" ? cursor : source.length, expectedText: "" });
    expect(result.proposal?.patch?.insertText).toContain(artifact);
    expect(result.proposal?.patch?.insertText.match(/```/gu)).toHaveLength(2);
    expect(result.proposal?.snapshot.content).toBe(source);
  });

  it.each(invalidLiteralPlans)("does not offer or accept $label as a Markdown code artifact", async ({ content, candidateText }) => {
    const instruction = "新增代码块markdown的标题一 hello";
    let receivedSchema: Record<string, unknown> | undefined;
    let plannerPrompt = "";
    let result: Awaited<ReturnType<typeof runPlannedAiTaskCore>> | undefined;
    let failure: unknown;
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt, _system, _max, _chunk, schema) => {
      receivedSchema = schema;
      plannerPrompt = prompt;
      return JSON.stringify({
        version: 1,
        kind: "edit",
        operation: "insert",
        target: "document_end",
        layout: "block",
        content
      });
    });
    try {
      result = await runPlannedAiTaskCore(request(instruction), snapshot(), runnerOptions(invoke));
    } catch (error) {
      failure = error;
    }

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(failure).toBeInstanceOf(Error);
    expect(result?.proposal).toBeUndefined();
    expect(result?.text).not.toBe("hello");
    if (candidateText) expect(plannerPrompt).toContain(candidateText);
    expect(receivedSchema).toBeDefined();
    const alternatives = insertContentAlternatives(receivedSchema!);
    const modes = alternatives.map(({ properties }) =>
      (properties?.mode as { const?: string } | undefined)?.const);
    expect(modes).toContain("generate");
    expect(modes).not.toContain("literal");
    const generated = alternatives.find(({ properties }) =>
      (properties?.mode as { const?: string } | undefined)?.const === "generate");
    const task = generated?.properties?.task as { enum?: string[]; const?: string } | undefined;
    expect(task?.enum ?? (task?.const ? [task.const] : [])).toContain("custom");
  });

  it("preserves a grounded, fully quoted code block as literal content while still planning its target", async () => {
    const rawArtifact = "```markdown\n# hello\n```";
    const instruction = `新增Markdown代码块“${rawArtifact}”`;
    let receivedSchema: Record<string, unknown> | undefined;
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (_prompt, _system, _max, _chunk, schema) => {
      receivedSchema = schema;
      return JSON.stringify({
        version: 1,
        kind: "edit",
        operation: "insert",
        target: "document_end",
        layout: "block",
        content: { mode: "literal", literalId: "literal-1" }
      });
    });
    const result = await runPlannedAiTaskCore(request(instruction), snapshot(), runnerOptions(invoke));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(receivedSchema).toBeDefined();
    const alternatives = insertContentAlternatives(receivedSchema!);
    const modes = alternatives.map(({ properties }) => (properties?.mode as { const?: string } | undefined)?.const);
    expect(modes).toContain("literal");
    expect(result).toMatchObject({ planningMode: "model", resolvedIntent: { kind: "edit", content: { mode: "literal", literalId: "literal-1" } } });
    expect(result.proposal?.patch?.insertText).toContain(rawArtifact);
    expect(result.proposal?.snapshot.content).toBe(source);
  });

  it("rejects a generated title that conflicts with the explicit hello requirement", async () => {
    const instruction = "根据原文标题新增代码块markdown的标题一 hello";
    const generated = "```markdown\n# 安全提示\n```";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (_prompt, _system, _max, _chunk, schema) =>
      schema ? insertPlan("document_end") : generated);
    await expect(runPlannedAiTaskCore(request(instruction), snapshot(), runnerOptions(invoke)))
      .rejects.toThrow(/heading_text_mismatch/u);

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("generates a source-dependent title when no exact title text is specified", async () => {
    const instruction = "根据原文标题新增代码块markdown的一级标题";
    const generated = "```markdown\n# 文稿\n```";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (_prompt, _system, _max, _chunk, schema) =>
      schema ? insertPlan("document_end") : generated);
    const result = await runPlannedAiTaskCore(request(instruction), snapshot(), runnerOptions(invoke));

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.planningMode).toBe("model");
    expect(result.proposal?.patch?.insertText).toContain(generated);
    expect(result.proposal?.snapshot.content).toBe(source);
  });

  it("keeps a creative title request on the content-generation route", async () => {
    const instruction = "新增代码块markdown的标题一，生成一个关于安全的创意标题";
    const generated = "```markdown\n# 安全提示\n```";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (_prompt, _system, _max, _chunk, schema) =>
      schema ? insertPlan("document_end") : generated);
    const result = await runPlannedAiTaskCore(request(instruction), snapshot(), runnerOptions(invoke));

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.planningMode).toBe("model");
    expect(result.proposal?.patch?.insertText).toContain(generated);
    expect(result.proposal?.snapshot.content).toBe(source);
  });
});
