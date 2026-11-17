import { describe, expect, it } from "vitest";
import type { ArtifactField, ArtifactSpec } from "../../src/core/ai/artifactSpec";
import { renderArtifact } from "../../src/core/ai/artifactRenderer";
import type { AiTaskRequest, AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import { bindAiIntent } from "../../src/core/ai/intentBinder";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { createExecutionPlan } from "../../src/core/ai/executionPlan";
import type { ValidatedIntent } from "../../src/core/ai/intentTypes";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

function resolve(instruction: string, effect: "edit" | "answer" = "edit", operation?: string): ArtifactSpec {
  return resolveArtifactSpec(instruction, resolveGenerationRequirements(instruction), { effect, operation });
}

function expectGrounded(instruction: string, field: ArtifactField<unknown> | undefined): void {
  expect(field).toBeDefined();
  for (const evidence of field!.evidence) {
    expect(evidence.from).toBeGreaterThanOrEqual(0);
    expect(evidence.to).toBeLessThanOrEqual(instruction.length);
    expect(evidence.to).toBeGreaterThan(evidence.from);
    expect(instruction.slice(evidence.from, evidence.to)).toBe(evidence.raw);
  }
}

describe("resolveArtifactSpec", () => {
  it.each([
    "创建代码块 markdown 格式 标题一 hello",
    "新增代码块markdown的标题一 hello",
    "在文末新增代码块 markdown 格式 标题二 “检查边界：状态✅”",
    "新增个markdown的代码块，里面加个h1的hello"
  ])("resolves a literal Markdown heading inside a requested code block: %s", instruction => {
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.language?.value).toBe("markdown");
    expect(spec.heading?.level?.value).toBe(instruction.includes("标题二") ? 2 : 1);
    expect(spec.heading?.text?.value).toBe(instruction.includes("检查边界") ? "检查边界：状态✅" : "hello");
    expect(spec.composition).toBe("complete");
    expectGrounded(instruction, spec.language);
    expectGrounded(instruction, spec.heading?.level);
    expectGrounded(instruction, spec.heading?.text);
  });

  it("recovers a quoted language parameter from its explicit role before parsing headings", () => {
    const instruction = "新增代码块，语言为‘markdown’，包含一级标题‘hello’";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.language?.value).toBe("markdown");
    expect(spec.language?.evidence[0]?.raw).toBe("markdown");
    expect(spec.heading?.level?.value).toBe(1);
    expect(spec.heading?.text?.value).toBe("hello");
    expectGrounded(instruction, spec.language);
    expectGrounded(instruction, spec.heading?.level);
    expectGrounded(instruction, spec.heading?.text);
  });

  it("program-composes a fully specified informal Markdown code artifact", () => {
    const instruction = "新增个markdown的代码块，里面加个h1的hello";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.composition).toBe("complete");
    expect(spec.issues).toEqual([]);
    expect(spec.language?.value).toBe("markdown");
    expect(spec.heading?.level?.value).toBe(1);
    expect(spec.heading?.text?.value).toBe("hello");
    expect(renderArtifact(spec)).toBe("```markdown\n# hello\n```");
  });

  it("selects the compose recipe in the execution-plan seam without a body-generation stage", () => {
    const instruction = "新增个markdown的代码块，里面加个h1的hello";
    const document: AiDocumentSnapshot = {
      documentId: "informal-heading.md", revision: 1,
      content: "# Existing\n\nKeep this source.", selection: null, cursor: null, readOnly: false
    };
    const contract = deriveInstructionContract(instruction, { hasSelection: false, hasCursor: false });
    const candidates = buildAiIntentCandidates(instruction, document.content, contract);
    const intent: ValidatedIntent = {
      version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
      content: { mode: "generate", task: "custom" }
    };
    const bound = bindAiIntent(intent, document, instruction, candidates, contract);
    const request: AiTaskRequest = {
      source: document.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "",
      actionDefinition: { id: "custom", label: "custom", prompt: instruction, system: "" }
    };
    const plan = createExecutionPlan(request, document, bound, instruction, "model");
    expect(plan.kind).toBe("edit");
    if (plan.kind !== "edit") return;
    expect(plan.content).toEqual({ mode: "compose", text: "```markdown\n# hello\n```" });
  });

  it("preserves exact quoted heading payload spaces, Unicode, and punctuation", () => {
    const instruction = "Markdown代码块，标题一 ‘  Hello，世界！  ’";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.heading?.text?.value).toBe("  Hello，世界！  ");
    expect(spec.heading?.text?.evidence[0]?.raw).toBe("‘  Hello，世界！  ’");
    expect(spec.composition).toBe("complete");
    expectGrounded(instruction, spec.heading?.text);
  });

  it("does not treat 的确 as a heading payload delimiter", () => {
    const instruction = "Markdown代码块，标题一 的确很好";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.heading?.text?.value).toBe("的确很好");
    expectGrounded(instruction, spec.heading?.text);
  });

  it("keeps an exact heading field while marking an additional creation request partial", () => {
    const instruction = "创建代码块 markdown 格式 标题一 hello，并解释历史背景";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.heading?.text?.value).toBe("hello");
    expect(spec.composition).toBe("partial");
    expect(spec.issues).toEqual([]);
  });

  it("keeps a directly quoted heading when the same instruction requests extra explanation", () => {
    const instruction = "在文末创建一个 Markdown 代码块，包含二级标题“hello”，并解释它的用途。";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.heading?.level?.value).toBe(2);
    expect(spec.heading?.text?.value).toBe("hello");
    expect(spec.composition).toBe("partial");
    expect(spec.issues).toEqual([]);
  });

  it.each([
    ["在文末新增 Markdown H2 标题“状态”，并在标题后写一句“准备发布”。", "状态"],
    ["在文末新增 Markdown H2 标题“状态”，内容还要包含“准备发布”。", "状态"]
  ])("reads the quoted title after a Chinese heading label and keeps the extra request partial: %s", (instruction, title) => {
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("heading");
    if (spec.kind !== "heading") return;
    expect(spec.heading.level?.value).toBe(2);
    expect(spec.heading.text?.value).toBe(title);
    expect(spec.heading.text?.evidence[0]?.raw).toBe(`“${title}”`);
    expect(spec.composition).toBe("partial");
    expect(spec.issues).toEqual([]);
  });

  it("preserves comma punctuation and creative wording inside an explicitly quoted Chinese heading", () => {
    const instruction = "在文末新增 Markdown H2 标题“生成发布方案，快速验证”。";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("heading");
    if (spec.kind !== "heading") return;
    expect(spec.heading.text?.value).toBe("生成发布方案，快速验证");
    expect(spec.composition).toBe("complete");
    expectGrounded(instruction, spec.heading.text);
  });

  it("preserves English creative wording inside an explicitly quoted heading", () => {
    const instruction = "Add a Markdown H2 heading “Generate a release plan, then verify it”.";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("heading");
    if (spec.kind !== "heading") return;
    expect(spec.heading.level?.value).toBe(2);
    expect(spec.heading.text?.value).toBe("Generate a release plan, then verify it");
    expectGrounded(instruction, spec.heading.text);
  });

  it("does not complete an unquoted title when a comma introduces additional prose", () => {
    const instruction = "在文末新增 Markdown H2 标题状态，内容还要包含准备发布。";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("heading");
    if (spec.kind !== "heading") return;
    expect(spec.heading.level?.value).toBe(2);
    expect(spec.composition).toBe("partial");
  });

  it("generates the extra body after an H2 title instead of compiling the instruction as title text", async () => {
    const instructions = [
      "在文末新增 Markdown H2 标题“状态”，并在标题后写一句“准备发布”。",
      "在文末新增 Markdown H2 标题“状态”，内容还要包含“准备发布”。"
    ];
    for (const instruction of instructions) {
      const document: AiDocumentSnapshot = {
        documentId: "heading-extra.md", revision: 2,
        content: "# Existing\n\nKeep this source.", selection: null, cursor: null, readOnly: false
      };
      const request: AiTaskRequest = {
        source: document.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "",
        actionDefinition: { id: "custom", label: "custom", prompt: instruction, system: "" }
      };
      let calls = 0;
      const options: AiTaskRunnerOptions = {
        invoke: async () => { calls += 1; return JSON.stringify({ payload: "准备发布" }); },
        isCurrent: () => true, abortCurrent() {}
      };
      const result = await runPlannedAiTaskCore(request, document, options);
      expect(calls).toBe(1);
      expect(result.proposal?.patch?.insertText).toContain("## 状态");
      expect(result.proposal?.patch?.insertText).toContain("准备发布");
      expect(result.proposal?.patch?.insertText).not.toContain("标题后写一句");
      expect(result.proposal?.patch?.insertText).not.toContain("内容还要包含");
    }
  });

  it("still composes a fully specified standalone H2 heading without a body call", async () => {
    const instruction = "在文末新增 Markdown H2 标题“状态”。";
    const document: AiDocumentSnapshot = {
      documentId: "heading-only.md", revision: 1,
      content: "# Existing\n\nKeep this source.", selection: null, cursor: null, readOnly: false
    };
    const request: AiTaskRequest = {
      source: document.content, action: "custom", userPrompt: instruction, baseSystemPrompt: "",
      actionDefinition: { id: "custom", label: "custom", prompt: instruction, system: "" }
    };
    let calls = 0;
    const result = await runPlannedAiTaskCore(request, document, {
      invoke: async () => { calls += 1; return "unexpected"; },
      isCurrent: () => true, abortCurrent() {}
    });
    expect(calls).toBe(0);
    expect(result.proposal?.patch?.insertText).toContain("## 状态");
  });

  it.each([
    "新增代码块markdown的标题一，生成一个关于安全的创意标题",
    "新增 Markdown 代码块，标题二，解释它为什么重要",
    "新增 Markdown 代码块，标题二，根据安全规范生成一个标题",
    "新增 Markdown 代码块，标题二，说明标题为什么重要",
    "新增 Markdown 代码块，标题二，按照安全规范生成一个标题",
    "Create a Markdown code block with level 2 heading, Generate a title about safety",
    "新增代码块markdown的标题一 hello，生成一个关于安全的创意标题",
    "新增 Markdown 代码块，标题二 hello，解释标题为什么重要",
    "新增 Markdown 代码块，标题二 hello，根据安全规范生成一个标题"
  ])("keeps an unquoted generation or explanation request out of heading text: %s", instruction => {
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.heading?.level?.value).toBe(instruction.includes("标题一") ? 1 : 2);
    expect(spec.heading?.text).toBeUndefined();
    expect(spec.composition).toBe("partial");
    expect(spec.issues).toEqual([]);
  });

  it("preserves the same generation wording when it is explicitly quoted as a heading literal", () => {
    const instruction = "新增代码块markdown的标题一，“生成一个关于安全的创意标题”";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.heading?.level?.value).toBe(1);
    expect(spec.heading?.text?.value).toBe("生成一个关于安全的创意标题");
    expect(spec.heading?.text?.evidence[0]?.raw).toBe("“生成一个关于安全的创意标题”");
    expect(spec.composition).toBe("complete");
  });

  it("keeps a direct heading distinct from a heading nested in a Markdown code block", () => {
    const direct = resolve("底部新增二级标题：hello", "edit", "insert");
    const nested = resolve("新增 markdown 代码块，内含标题二 ‘hello’", "edit", "insert");
    expect(direct.kind).toBe("heading");
    if (direct.kind === "heading") {
      expect(direct.heading.level?.value).toBe(2);
      expect(direct.heading.text?.value).toBe("hello");
    }
    expect(nested.kind).toBe("code");
    if (nested.kind === "code") expect(nested.heading?.level?.value).toBe(2);
  });

  it.each([
    ["底部新增 H1 heading with hello", 1, "hello"],
    ["底部新增 level 2: Hello 世界", 2, "Hello 世界"],
    ["底部新增三级标题：状态✅", 3, "状态✅"]
  ])("normalizes direct English and Chinese heading forms: %s", (instruction, level, text) => {
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("heading");
    if (spec.kind !== "heading") return;
    expect(spec.heading.level?.value).toBe(level);
    expect(spec.heading.text?.value).toBe(text);
    expect(spec.composition).toBe("complete");
  });

  it.each([
    ["新增 Python 代码块，定义 add(a, b)，返回 a + b。", "python"],
    ["Create a JS code block that exports a helper.", "javascript"],
    ["新增 TS 代码块，定义类型 User。", "typescript"],
    ["新增 JSON 代码块，内容为 {\"ok\": true, \"count\": 3}。", "json"],
    ["Add an md code block with a heading.", "markdown"]
  ])("normalizes explicit code language aliases in %s", (instruction, language) => {
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.language?.value).toBe(language);
    expectGrounded(instruction, spec.language);
  });

  it("extracts an explicitly named function without treating the name as a complete code body", () => {
    const instruction = "在文末新增 Python 代码块，定义 add(a, b)，返回 a + b。";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.functionName?.value).toBe("add");
    expect(spec.literalBody).toBeUndefined();
    expect(spec.composition).toBe("partial");
    expectGrounded(instruction, spec.functionName);
  });

  it("does not mistake a language label for a complete code body", () => {
    const spec = resolve("在文末新增 Python 代码块。", "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.language?.value).toBe("python");
    expect(spec.literalBody).toBeUndefined();
    expect(spec.composition).toBe("partial");
  });

  it("parses a complete explicit JSON literal and keeps its source evidence", () => {
    const instruction = "在文末新增 JSON 代码块，内容为 {\"ok\": true, \"count\": 3}。";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.jsonBody?.value).toEqual({ ok: true, count: 3 });
    expect(spec.composition).toBe("complete");
    expectGrounded(instruction, spec.jsonBody);
  });

  it("leaves malformed JSON content unset and records an issue", () => {
    const spec = resolve("新增 JSON 代码块，内容为 {\"ok\": true,}。", "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.jsonBody).toBeUndefined();
    expect(spec.issues).toContain("invalid_json_literal");
  });

  it("leaves multiple JSON literal candidates unset instead of choosing the last one", () => {
    const spec = resolve("新增 JSON 代码块，内容为 {\"ok\": true}，内容为 {\"ok\": false}。", "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.jsonBody).toBeUndefined();
    expect(spec.issues).toContain("ambiguous_json_literal");
  });

  it("binds table row cells to explicit columns and complete row pairs", () => {
    const instruction = "新增一个 Markdown 表格，列名为测试项、结果；行数据为编译器→通过、测试→待定。";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("table");
    if (spec.kind !== "table") return;
    expect(spec.columns?.map(({ value }) => value)).toEqual(["测试项", "结果"]);
    expect(spec.rows?.map(row => row.map(({ value }) => value))).toEqual([["编译器", "通过"], ["测试", "待定"]]);
    expect(spec.composition).toBe("complete");
    for (const column of spec.columns ?? []) expectGrounded(instruction, column);
    for (const row of spec.rows ?? []) for (const cell of row) expectGrounded(instruction, cell);
  });

  it("does not invent source-bound table rows from the instruction", () => {
    const instruction = "严格根据原文新增两列表格，列名“水果”“价格”，列出文中所有水果及价格。";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("table");
    expect(spec.sourceDependent).toBe(true);
    if (spec.kind !== "table") return;
    expect(spec.columns?.map(({ value }) => value)).toEqual(["水果", "价格"]);
    expect(spec.rows).toBeUndefined();
    expect(spec.composition).toBe("partial");
  });

  it("retains complete table fields but does not omit requested analysis", () => {
    const instruction = "新增表格，列名为名称、状态；行数据为编译器→通过、测试→待定，并写一段分析";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("table");
    if (spec.kind !== "table") return;
    expect(spec.rows?.map(row => row.map(({ value }) => value))).toEqual([["编译器", "通过"], ["测试", "待定"]]);
    expect(spec.composition).toBe("partial");
    expect(spec.issues).toEqual([]);
  });

  it("does not expose rows when a declared row is incomplete for the columns", () => {
    const spec = resolve("新增表格，列名为名称、状态；行数据为编译器→通过、测试。", "edit", "insert");
    expect(spec.kind).toBe("table");
    if (spec.kind !== "table") return;
    expect(spec.rows).toBeUndefined();
    expect(spec.issues).toContain("incomplete_table_rows");
  });

  it("does not choose between conflicting explicit table headers", () => {
    const spec = resolve("新增表格，列名为名称、状态；表头为项目、结果。", "edit", "insert");
    expect(spec.kind).toBe("table");
    if (spec.kind !== "table") return;
    expect(spec.columns).toBeUndefined();
    expect(spec.issues).toContain("conflicting_table_columns");
  });

  it("extracts a given display equation with its exact formula text", () => {
    const instruction = "在文末新增一个 LaTeX 显示公式块，用 $$ 包裹公式，表达勾股定理：a^2 + b^2 = c^2。";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("math");
    if (spec.kind !== "math") return;
    expect(spec.display).toBe(true);
    expect(spec.equation?.value).toBe("a^2 + b^2 = c^2");
    expect(spec.composition).toBe("complete");
    expectGrounded(instruction, spec.equation);
  });

  it("extracts explicit icon list items and item evidence", () => {
    const instruction = "在文末新增三个状态图标清单：✅ 已完成、⚠️ 待确认、❌ 已阻塞。";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("list");
    if (spec.kind !== "list") return;
    expect(spec.ordered).toBe(false);
    expect(spec.count?.value).toBe(3);
    expect(spec.items?.map(({ value }) => value)).toEqual(["✅ 已完成", "⚠️ 待确认", "❌ 已阻塞"]);
    expect(spec.composition).toBe("complete");
    for (const item of spec.items ?? []) expectGrounded(instruction, item);
  });

  it("extracts ordinary delimited list items as well as icon items", () => {
    const instruction = "在文末新增无序列表：计划、评审、发布。";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("list");
    if (spec.kind !== "list") return;
    expect(spec.items?.map(({ value }) => value)).toEqual(["计划", "评审", "发布"]);
    expect(spec.composition).toBe("complete");
  });

  it("preserves an explicitly ordered list request", () => {
    const spec = resolve("在文末新增有序清单：计划、评审、发布。", "edit", "insert");
    expect(spec.kind).toBe("list");
    if (spec.kind !== "list") return;
    expect(spec.ordered).toBe(true);
    expect(spec.items?.map(({ value }) => value)).toEqual(["计划", "评审", "发布"]);
    expect(spec.composition).toBe("complete");
  });

  it("keeps follow-up item decoration outside list fields and marks the artifact partial", () => {
    const spec = resolve("在文末新增有序列表：计划、评审、发布，并给每项加上状态图标。", "edit", "insert");
    expect(spec.kind).toBe("list");
    if (spec.kind !== "list") return;
    expect(spec.ordered).toBe(true);
    expect(spec.items?.map(({ value }) => value)).toEqual(["计划", "评审", "发布"]);
    expect(spec.composition).toBe("partial");
  });

  it("builds a Mermaid graph only from a directly stated arrow sequence", () => {
    const instruction = "在文末新增 Mermaid 流程图，按顺序表示开始→审核→结束。";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("mermaid");
    if (spec.kind !== "mermaid") return;
    expect(spec.graph).toMatchObject({ direction: "LR", edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }] });
    expect(spec.graph?.nodes.map(({ value }) => value)).toEqual(["开始", "审核", "结束"]);
    expect(spec.composition).toBe("complete");
    for (const node of spec.graph?.nodes ?? []) expectGrounded(instruction, node);
  });

  it("accepts a direct Mermaid arrow chain without requiring a prose relation marker", () => {
    const spec = resolve("在文末新增 Mermaid 流程图 开始→审核→结束。", "edit", "insert");
    expect(spec.kind).toBe("mermaid");
    if (spec.kind !== "mermaid") return;
    expect(spec.graph?.nodes.map(({ value }) => value)).toEqual(["开始", "审核", "结束"]);
    expect(spec.composition).toBe("complete");
  });

  it("does not interpret a code block how-to question as a code artifact", () => {
    const instruction = "怎么创建 Markdown 代码块？只告诉我方法，不要修改文稿。";
    const requirements = resolveGenerationRequirements(instruction);
    expect(resolveArtifactSpec(instruction, requirements, { effect: "answer" }).kind).toBe("none");
  });

  it("does not turn a how-to question mentioning a response format into an output artifact", () => {
    const instruction = "怎么使用 Markdown 代码块？只告诉我方法，不要修改文稿。";
    expect(resolve(instruction, "answer").kind).toBe("none");
  });

  it("keeps quoted edit commands out of an answer artifact", () => {
    const instruction = "请解释“底部加hello”是什么意思，勿修改文稿。";
    expect(resolve(instruction, "answer").kind).toBe("none");
  });

  it("reports conflicting code languages without choosing one", () => {
    const instruction = "新增 Python 和 TypeScript 代码块，实现一个示例。";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.language).toBeUndefined();
    expect(spec.issues).toContain("conflicting_code_languages");
  });

  it("does not mark a table complete when a second artifact is requested", () => {
    const instruction = "新增 Markdown 表格，列名为名称、状态；行数据为编译器→通过，并新增一个代码块说明细节。";
    const spec = resolve(instruction, "edit", "insert");
    expect(spec.kind).toBe("none");
    expect(spec.issues).toContain("conflicting_artifact_types");
  });
});
