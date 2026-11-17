import { describe, expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTaskCore } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { compileLiteralMarkdownHeading, createLiteralMarkdownArtifact } from "../../src/core/ai/literalMarkdownArtifact";

const output = "```markdown\n# hello\n```";
const source = "# 文稿\n\n原有正文保持不变。";

function insertPlan(target: "document_end" | "cursor" = "document_end") {
  return JSON.stringify({
    version: 1,
    kind: "edit",
    operation: "insert",
    target,
    layout: "block",
    content: { mode: "generate", task: "custom" }
  });
}

function request(instruction: string) {
  return buildAiTaskRequest({
    source,
    selected: false,
    action: "custom",
    userPrompt: instruction,
    config: { provider: "ztools", activeRoleId: "general" }
  });
}

function snapshot(extra: { cursor?: number | null } = {}) {
  return {
    documentId: "literal.md",
    revision: 3,
    content: source,
    selection: null,
    cursor: extra.cursor ?? source.length,
    readOnly: false
  };
}

function options(invoke: AiTaskRunnerOptions["invoke"]): AiTaskRunnerOptions {
  return { invoke, isCurrent: () => true, abortCurrent: vi.fn() };
}

describe("literal Markdown heading artifacts", () => {
  it.each([
    ["代码块markdown的标题一 hello", output],
    ["代码块 markdown 的标题一 hello", output],
    ["代码块 markdown 标题一 hello", output],
    ["markdown代码块，标题一 hello", output],
    ["markdown 的代码块，标题二 hello", "```markdown\n## hello\n```"],
    ["标题三的markdown代码块 hello", "```markdown\n### hello\n```"],
    ["代码块   markdown 的 标题一   hello", output],
    ["markdown的代码块，里面加个h1的hello", output],
    ["Markdown代码块，内容为一级标题 hello", output],
    ["Markdown代码块，内容为标题二: hello world", "```markdown\n## hello world\n```"],
    ["代码块 markdown heading6: hello", "```markdown\n###### hello\n```"],
    ["代码块 md 标题一 hello", output],
    ["Markdown代码块，内容为一级标题 ‘Hello, world!’", "```markdown\n# Hello, world!\n```"],
    ["Markdown代码块，标题一 的确很好", "```markdown\n# 的确很好\n```"],
    ["Markdown代码块，标题一 是的", "```markdown\n# 是的\n```"],
    ["Markdown代码块，标题一 为好", "```markdown\n# 为好\n```"],
    ["Markdown代码块，h1的hello", output],
    ["markdown 的代码块，里面加个 H1 的 hello", output],
    ["代码块 markdown 标题一 的 的确很好", "```markdown\n# 的确很好\n```"],
    ["Markdown代码块，h1的‘的确很好’", "```markdown\n# 的确很好\n```"],
    ["Markdown代码块，标题一 为何", "```markdown\n# 为何\n```"],
    ["markdown code block heading 5: hello", "```markdown\n##### hello\n```"],
    ["md fenced code block, h4 hello", "```markdown\n#### hello\n```"],
    ["Markdown代码围栏，标题六 hello", "```markdown\n###### hello\n```"],
    ["代码块 markdown 标题一 ‘  Hello，世界！  ’", "```markdown\n#   Hello，世界！  \n```"]
  ])("builds an exact fenced heading from the complete template: %s", (instruction, expected) => {
    expect(createLiteralMarkdownArtifact(instruction)).toBe(expected);
  });

  it("returns explicit semantic slots and source spans for a literal heading", () => {
    const instruction = "代码块markdown的标题一 ‘  hello，世界！  ’";
    const compiled = compileLiteralMarkdownHeading(instruction);
    expect(compiled).toMatchObject({ language: "markdown", level: 1, text: "  hello，世界！  " });
    for (const evidence of Object.values(compiled!.evidence)) {
      expect(instruction.slice(evidence.from, evidence.to)).toBe(evidence.raw);
      expect(evidence.raw).not.toBe("");
    }
    expect(compiled!.evidence.payload.raw).toBe("‘  hello，世界！  ’");
  });

  it.each([
    "Markdown代码块，生成一个关于安全的标题",
    "Markdown代码块，内容为一级标题 hello，并添加一段介绍",
    "Markdown代码块，标题一 hello 和标题二 world",
    "Markdown代码块，标题一 hello 标题二 world",
    "Markdown代码块，标题一 hello 添加第二段正文",
    "代码块 标题一 hello",
    "Python代码块，标题一 hello",
    "Markdown代码块，标题七 hello",
    "Markdown代码块，标题一",
    "Markdown代码块，标题一 hello\nworld",
    "不要生成Markdown代码块，标题一 hello",
    "Markdown代码块，标题一 hello。添加正文",
    "Markdown代码块，内容不是一级标题 hello",
    "Markdown代码块，h10 hello",
    "Markdown代码块，heading10 hello",
    "Markdown代码块，标题一百 hello",
    "Markdown代码块，标题一hello",
    "Markdown代码块，内容为一级标题 生成一个关于安全的标题",
    "Markdown代码块，内容为一级标题 写一个有创意的标题",
    "Markdown代码块，内容为一级标题 “hello” 并生成 “world”",
    "Markdown代码块，参考原文标题，标题一 hello",
    "Markdown代码块，标题一 hello based on the source",
    "Markdown代码块，标题一 hello please add a section",
    "Markdown代码块标题一的确很好",
    "Markdown代码块标题一是的",
    "Markdown代码块标题一为何",
    `Markdown代码块，标题一 ${"中".repeat(86)}`,
    `${" ".repeat(500)}Markdown代码块，标题一 hello`
  ])("leaves ambiguous or compound wording for the model: %s", instruction => {
    expect(createLiteralMarkdownArtifact(instruction)).toBeUndefined();
  });

  it("enforces the UTF-8 payload bound while preserving exact literal spaces", () => {
    const accepted = compileLiteralMarkdownHeading(`Markdown代码块，标题一 ${"a".repeat(256)}`);
    expect(accepted?.text).toBe("a".repeat(256));
    expect(compileLiteralMarkdownHeading(`Markdown代码块，标题一 ${"a".repeat(257)}`)).toBeUndefined();
  });

  it("creates the exact EOF code block without any model call and retains the guarded proposal", async () => {
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("A literal heading template must not call the model.");
    });
    const snap = snapshot();
    const result = await runPlannedAiTaskCore(
      request("底部新增代码块 markdown 标题一 hello"),
      snap,
      options(invoke)
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(result.text).toBe(`\n\n${output}`);
    expect(result.proposal?.patch).toEqual({
      from: source.length,
      to: source.length,
      expectedText: "",
      insertText: `\n\n${output}`
    });
    expect(result.proposal?.snapshot.content).toBe(source);
  });

  it("keeps creative heading requests on the model generation route", async () => {
    const instruction = "底部新增 Markdown代码块，生成一个关于安全的一级标题";
    const generated = "```markdown\n# 安全提示\n```";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (_prompt, _system, _max, _chunk, outputSchema) =>
      outputSchema ? insertPlan() : generated
    );
    const result = await runPlannedAiTaskCore(
      request(instruction),
      snapshot(),
      options(invoke)
    );

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][0]).toContain("本次用户指令：");
    expect(invoke.mock.calls[1][0]).toContain("【用户原始指令（完整保留）】");
    expect(invoke.mock.calls[1][0]).toContain(instruction);
    expect(result.proposal?.patch?.insertText).toContain(generated);
  });

  it("keeps a source-dependent insert on the model generation route", async () => {
    const instruction = "底部新增 Markdown代码块，参考原文标题生成一级标题 hello";
    const generated = "```markdown\n# hello\n```";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (_prompt, _system, _max, _chunk, outputSchema) =>
      outputSchema ? insertPlan("document_end") : generated
    );
    const result = await runPlannedAiTaskCore(
      request(instruction),
      snapshot(),
      options(invoke)
    );

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][0]).toContain("本次用户指令：");
    expect(invoke.mock.calls[1][0]).toContain("【用户原始指令（完整保留）】");
    expect(invoke.mock.calls[1][0]).toContain(instruction);
    expect(result.proposal?.patch?.insertText).toContain(generated);
    expect(result.proposal).toBeDefined();
  });

  it("compiles a literal heading only after the planner validates a cursor insertion target", async () => {
    const instruction = "光标处新增 Markdown代码块，内容为一级标题 hello";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (_prompt, _system, _max, _chunk, outputSchema) =>
      outputSchema ? insertPlan("cursor") : "unexpected generation call"
    );
    const cursor = source.indexOf("原有");
    const result = await runPlannedAiTaskCore(
      request(instruction),
      snapshot({ cursor }),
      options(invoke)
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toContain("本次用户指令：");
    expect(result.proposal?.patch?.from).toBe(cursor);
    expect(result.proposal?.patch?.insertText).toContain(output);
  });
});
