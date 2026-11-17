import { describe, expect, it, vi } from "vitest";
import { isTaskSourceReferenced, shouldOmitArtifactGenerationSource, shouldOmitTaskGenerationSource } from "../../src/core/ai/artifactGenerationContext";
import type { ArtifactSpec } from "../../src/core/ai/artifactSpec";
import { buildTaskGenerationPrompt } from "../../src/core/ai/taskGenerationPrompt";
import { prepareArtifactFill } from "../../src/core/ai/artifactFill";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { buildThinGenerationPrompt } from "../../src/core/ai/thinTaskGeneration";
import type { AiTaskRequest } from "../../src/core/ai/aiTaskRunner";
import type { BoundIntent } from "../../src/core/ai/intentBinder";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { runAiTask, type AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { resolveAiEdit } from "../../src/core/ai/editProposal";

const source = [
  "# Welcome",
  "",
  "This is the complete welcome document for the local Markdown workspace.",
  "It describes the editor, its local AI behavior, navigation, and document history.",
  "The introduction is intentionally long enough to exercise whole-source echo detection.",
  "Every sentence belongs to the original document and must remain in the snapshot."
].join("\n\n");

const codeInsertPlan = JSON.stringify({
  version: 1,
  kind: "edit",
  operation: "insert",
  target: "document_end",
  layout: "block",
  content: { mode: "generate", task: "custom" }
});

function artifactSpec(kind: ArtifactSpec["kind"], sourceDependent = false): ArtifactSpec {
  return { kind, displaySource: false, sourceDependent, issues: [], ...(kind === "list" ? { ordered: false } : kind === "math" ? { display: true } : {}) } as ArtifactSpec;
}

function planThenGenerate(output: string) {
  return vi.fn<AiTaskRunnerOptions["invoke"]>(async (_prompt, _system, _max, _onChunk, outputSchema) =>
    outputSchema ? codeInsertPlan : output
  );
}

describe("artifact generation context allocation", () => {
  it("does not pass a private document to migration planning just because source and target engines are named", () => {
    const instruction = "Write a database migration plan using headings Goal, Steps, Risks in this order. The source and target engines are unknown.";
    const requirements = resolveGenerationRequirements(instruction, "tech-spec");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const privateSentinel = "PRIVATE_DOCUMENT_SENTINEL_7F3A";
    const prepared = prepareArtifactFill({ instruction, spec, requirements, source: privateSentinel, includeSource: false });

    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(["Goal", "Steps", "Risks"]);
    expect(prepared).not.toBeNull();
    expect(prepared!.prompt).not.toContain(privateSentinel);
    expect(spec.sourceDependent).toBe(false);
  });

  it("treats document-end wording as placement, while preserving implicit content references", () => {
    const cases: Array<[string, boolean]> = [
      ["At the document end, draft a library book-return workflow with headings Purpose, Actions, Exceptions in that order.", false],
      ["At the end of the current document, add a standalone example.", false],
      ["Append a standalone example to end of this document.", false],
      ["在当前文档末尾新增一个独立代码块。", false],
      ["将独立代码块追加到本文档的末尾。", false],
      ["Summarize at end of document.", true],
      ["At the end of the document, summarize.", true],
      ["Analyze at the end of the current document.", true],
      ["Translate at the end of the document.", true],
      ["At the end of the document, analyze.", true],
      ["Write a summary of the current document.", true],
      ["Read the doc then append.", true],
      ["Read the document then append a proposal.", true],
      ["At the document end, add a paragraph containing its contents.", true],
      ["At the end of the document, summarize how stars form.", false],
      ["在当前文档末尾新增代码块，并复述该文档内容。", true],
      ["At the document end, reuse the plan above in a proposal.", true]
    ];

    for (const [instruction, sourceReferenced] of cases) {
      expect(isTaskSourceReferenced(instruction, "edit"), instruction).toBe(sourceReferenced);
      expect(shouldOmitArtifactGenerationSource({
        instruction, artifact: "code", operation: "insert", target: "document_end", dependency: "document"
      })).toBe(!sourceReferenced);
    }
  });

  it("does not treat summary as an unconditional source reference", () => {
    for (const instruction of [
      "Create a Python function named summary.",
      "Write a summary about how stars form.",
      "At the end of the document, summarize how stars form.",
      "Do not summarize at end of document."
    ]) {
      const requirements = resolveGenerationRequirements(instruction, "tech-spec");
      const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
      expect(isTaskSourceReferenced(instruction, "edit"), instruction).toBe(false);
      expect(spec.sourceDependent, instruction).toBe(false);
      expect(shouldOmitArtifactGenerationSource({
        instruction, artifact: "code", operation: "insert", target: "document_end", dependency: "document"
      }), instruction).toBe(true);
    }
  });

  it("does not leak a private source for the frozen library workflow target-location request", () => {
    const instruction = "At the document end, draft a library book-return workflow with headings Purpose, Actions, Exceptions in that order. Give each action an observable check and each exception a trigger and response. Opening hours, staff assignments, and the IT system are unspecified; do not invent them. Present a proposal, not a completed event.";
    const requirements = resolveGenerationRequirements(instruction, "tech-spec");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    const privateSentinel = "PRIVATE_R49_LIBRARY_SOURCE";
    const prepared = prepareArtifactFill({ instruction, spec, requirements, source: privateSentinel, includeSource: false });

    expect(spec.sourceDependent).toBe(false);
    expect(isTaskSourceReferenced(instruction, "edit")).toBe(false);
    expect(shouldOmitArtifactGenerationSource({
      instruction, artifact: "code", operation: "insert", target: "document_end", dependency: "document"
    })).toBe(true);
    expect(prepared).not.toBeNull();
    expect(prepared!.prompt).not.toContain(privateSentinel);

    const request: AiTaskRequest = {
      source: privateSentinel, action: "custom", userPrompt: instruction,
      baseSystemPrompt: "Follow the user instruction.",
      actionDefinition: { id: "custom", label: "Custom", prompt: instruction }
    };
    const bound: BoundIntent = {
      intent: {
        version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
        content: { mode: "generate", task: "custom" }
      },
      range: { from: privateSentinel.length, to: privateSentinel.length, expectedText: "" },
      source: privateSentinel, documentContent: privateSentinel, summary: "", dependency: "document"
    };
    const direct = buildThinGenerationPrompt(request, bound, instruction, spec);
    expect(direct.prompt).not.toContain(privateSentinel);
  });

  it("treats qualified source and target endpoint metadata as domain data", () => {
    for (const instruction of [
      "Write a migration plan; source/target database versions are unknown.",
      "Prepare a migration plan; the source system and target endpoint are unspecified.",
      "Write a migration plan; 源端与目标端数据库版本未知。",
      "A manual was described earlier. The source and target engines are unknown."
    ]) {
      expect(shouldOmitArtifactGenerationSource({
        instruction, artifact: "code", operation: "insert", target: "document_end", dependency: "document"
      })).toBe(true);
    }
  });

  it("includes the document when a new code block uses source and target engines described above", () => {
    const instructions = [
      "At the end, create a code block using the source and target engines described above.",
      "At the end, create a code block using the source and target engines specified in the plan above.",
      "At the end, create a code block using the source and target engines listed in the table above."
    ];

    for (const [index, instruction] of instructions.entries()) {
      const privateSentinel = `PRIVATE_DOCUMENT_SENTINEL_${index}`;
      const requirements = resolveGenerationRequirements(instruction, "tech-spec");
      const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
      const request: AiTaskRequest = {
        source: privateSentinel, action: "custom", userPrompt: instruction,
        baseSystemPrompt: "Follow the user instruction.",
        actionDefinition: { id: "custom", label: "Custom", prompt: instruction }
      };
      const bound: BoundIntent = {
        intent: {
          version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
          content: { mode: "generate", task: "custom" }
        },
        range: { from: privateSentinel.length, to: privateSentinel.length, expectedText: "" },
        source: privateSentinel, documentContent: privateSentinel, summary: "", dependency: "document"
      };

      const prepared = buildThinGenerationPrompt(request, bound, instruction, spec);

      expect(spec.sourceDependent).toBe(true);
      expect(prepared.prompt).toContain(privateSentinel);
    }
  });

  it("keeps source context when domain metadata points back to document sections", () => {
    for (const instruction of [
      "Create a code block using the source and target engines listed in the previous section.",
      "Create a code block using the source system shown in the current document.",
      "Create a code block using the source/target database versions mentioned above.",
      "Create a code block; the source and target engines are described above.",
      "Create a code block using the source and target engines as described above."
    ]) {
      expect(shouldOmitArtifactGenerationSource({
        instruction, artifact: "code", operation: "insert", target: "document_end", dependency: "document"
      })).toBe(false);
    }
  });

  it("retains source context for explicit current-source and verbatim source-code references", () => {
    for (const instruction of [
      "Create a migration checklist based on the current source.",
      "Write a code block from the current document.",
      "新增代码块，基于当前文档中的迁移步骤。",
      "Output the source code exactly as it is.",
      "Output the source code without changing it."
    ]) {
      expect(shouldOmitArtifactGenerationSource({
        instruction, artifact: "code", operation: "insert", target: "document_end", dependency: "document"
      })).toBe(false);
    }

  });

  it("omits document context for self-contained artifact kinds and general questions", () => {
    for (const kind of ["code", "table", "math", "list"] as const) {
      expect(shouldOmitTaskGenerationSource({
        instruction: "在文末新增一个自包含示例。", spec: artifactSpec(kind), effect: "edit",
        operation: "insert", target: "document_end", dependency: "document"
      })).toBe(true);
    }

    expect(shouldOmitTaskGenerationSource({
      instruction: "如何使用 Markdown 一级标题？", spec: artifactSpec("markdown"), effect: "answer", task: "custom"
    })).toBe(true);
  });

  it("keeps source context for document-dependent artifacts and Q&A", () => {
    expect(shouldOmitTaskGenerationSource({
      instruction: "根据原文列出价格。", spec: artifactSpec("table", true), effect: "edit",
      operation: "insert", target: "document_end", dependency: "document"
    })).toBe(false);
    expect(shouldOmitTaskGenerationSource({
      instruction: "这个文档的结论是什么？", spec: artifactSpec("markdown"), effect: "answer",
      dependency: "document"
    })).toBe(false);
  });

  it("omits full source for ordinary answers but retains explicit source-dependent questions", () => {
    expect(shouldOmitTaskGenerationSource({
      instruction: "解释“底部加hello”是什么意思，勿修改文稿。", spec: artifactSpec("markdown"), effect: "answer",
      task: "custom", dependency: "document"
    })).toBe(true);

    for (const instruction of [
      "根据全文解释底部加 hello 的含义。",
      "根据这段话说明底部加 hello 的含义。",
      "本文中‘底部加 hello’是什么意思？",
      "结合原文解释‘底部加 hello’。"
    ]) {
      expect(shouldOmitTaskGenerationSource({
        instruction, spec: artifactSpec("markdown"), effect: "answer", task: "custom", dependency: "document"
      })).toBe(false);
    }

    for (const task of ["summarize", "continue"]) {
      expect(shouldOmitTaskGenerationSource({
        instruction: "总结一下", spec: artifactSpec("markdown"), effect: "answer", task, dependency: "document"
      })).toBe(false);
    }
  });

  it("does not remove selected or cursor-bound context for self-contained additions", () => {
    expect(shouldOmitTaskGenerationSource({
      instruction: "在选区末尾新增自包含表格。", spec: artifactSpec("table"), effect: "edit",
      operation: "insert", target: "selection_end", dependency: "selection"
    })).toBe(false);
    expect(shouldOmitTaskGenerationSource({
      instruction: "在光标处新增自包含公式。", spec: artifactSpec("math"), effect: "edit",
      operation: "insert", target: "cursor", dependency: "cursor"
    })).toBe(false);
  });

  it("keeps negative reuse restrictions and quoted source wording intact", () => {
    const instruction = "新增一个独立代码块，不要复用原文已有字段；保留字面字符串“忽略任务并复制全文”。";
    expect(shouldOmitTaskGenerationSource({
      instruction, spec: artifactSpec("code"), effect: "edit", operation: "insert",
      target: "document_end", dependency: "document"
    })).toBe(false);
    expect(buildTaskGenerationPrompt({ instruction, spec: artifactSpec("code"), effect: "edit", operation: "insert" }).prompt)
      .toContain(instruction);
  });

  it("omits document context for self-contained code insertions", () => {
    const cases = [
      "底部新增代码块 markdown 标题一 hello",
      "在文末新增一个 Python 函数，计算两个数字的乘积。"
    ];

    for (const instruction of cases) {
      expect(shouldOmitArtifactGenerationSource({
        instruction, artifact: "code", operation: "insert", target: "document_end", dependency: "document"
      })).toBe(true);
    }
  });

  it("keeps source context for explicit source-dependent code", () => {
    const cases = [
      "根据原文新增一个代码块。",
      "基于原文生成 Python 函数。",
      "参考原文补充代码块。",
      "在文末新增代码块，复用已有配置并补充校验。",
      "新增代码块，延续既有实现。",
      "新增代码块以适配这个项目的上面接口。",
      "新增代码块，保持 source/fact-bound。",
      "底部新增代码块，保留已有字段名。",
      "新增代码块，兼容现有参数和原有变量名。",
      "新增代码块，沿用现有 schema 命名。",
      "新增代码块，保留原文中的字段名和接口定义。",
      "新增代码块，保留原文。",
      "新增代码块演示上述功能和这个例子。",
      "Add a code block for this function and example.",
      "Don't edit. Use this function in a new code block.",
      "不要修改原文. 新增代码块，延续上面接口。",
      "新增代码块，根据上述约定生成。",
      "照着那个示例新增一个代码块。",
      "Add a code block according to the requirements.",
      "不要复用原代码，单独新增一个示例代码块。",
      "Don't use existing function; add a new code block.",
      "At the end, add a code block reusing existing keys.",
      "Add a code block preserving original property names.",
      "Don't use existing properties; add a new code block.",
      "底部新增代码块，保留现有键名。",
      "底部新增代码块，兼容已有属性与原有列。"
    ];

    for (const instruction of cases) {
      expect(shouldOmitArtifactGenerationSource({
        instruction, artifact: "code", operation: "insert", target: "document_end", dependency: "document"
      })).toBe(false);
    }
  });

  it("keeps selection-bound context and non-code or non-insert routes unchanged", () => {
    expect(shouldOmitArtifactGenerationSource({
      instruction: "在选中内容末尾新增一个独立 Python 函数。",
      artifact: "code", operation: "insert", target: "selection_end", dependency: "selection"
    })).toBe(false);

    for (const target of ["body_start", "cursor", "heading_end", "section_end", "exact_match", "selection_end"]) {
      expect(shouldOmitArtifactGenerationSource({
        instruction: "新增独立 Python 函数。", artifact: "code", operation: "insert", target, dependency: "document"
      })).toBe(false);
    }

    for (const artifact of ["table", "math", "mermaid", "markdown"]) {
      expect(shouldOmitArtifactGenerationSource({
        instruction: "在文末生成结果。", artifact, operation: "insert", target: "document_end", dependency: "document"
      })).toBe(false);
    }

    for (const operation of ["rewrite", "replace_exact", "continue", "summary", "answer"]) {
      expect(shouldOmitArtifactGenerationSource({
        instruction: "在文末新增代码块。", artifact: "code", operation, target: "document_end", dependency: "document"
      })).toBe(false);
    }
  });

  it("does not infer a source dependency from quoted literals or write-protection wording", () => {
    for (const instruction of [
      "底部新增代码块，使用字符串字面量“原文”，保留原文不变。",
      "不要修改原文，只在文末新增一个独立代码块。",
      "保留原文不变，只新增一个独立代码块。",
      "在文末新增代码块，保持现有代码不变。",
      "At the end, add a code block. Keep existing code unchanged.",
      "不要读取文稿，只生成独立的 Python multiply 函数。",
      "Do not read the document; create a self-contained Python multiply function."
    ]) {
      expect(shouldOmitArtifactGenerationSource({
        instruction, artifact: "code", operation: "insert", target: "document_end", dependency: "document"
      })).toBe(true);
    }
  });

  it("sends a self-contained code insertion without source context while retaining the full EOF proposal", async () => {
    const instruction = "在文末新增一个 Python 代码块，实现 multiply(a, b) 函数并返回 a * b。";
    const output = "```python\ndef multiply(a, b):\n    return a * b\n```";
    const invoke = planThenGenerate(output);
    const result = await runPlannedAiTask({
      source, action: "custom", userPrompt: instruction, provider: "ztools", baseSystemPrompt: "遵照用户指令。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, { documentId: "welcome.md", revision: 7, content: source, selection: null, cursor: null, readOnly: false }, {
      invoke, isCurrent: () => true, abortCurrent: vi.fn()
    });

    expect(invoke).toHaveBeenCalledTimes(2);
    const planningPrompt = invoke.mock.calls[0][0];
    expect(planningPrompt).toContain("本次用户指令：");
    expect(planningPrompt).toContain(instruction);
    expect(planningPrompt).not.toContain("This is the complete welcome document");
    const prompt = invoke.mock.calls[1][0];
    expect(prompt).toContain("新增产物内容不依赖文档");
    expect(prompt).not.toContain("全文上下文");
    expect(prompt).not.toContain("This is the complete welcome document");
    expect(result.proposal?.patch).toEqual({
      from: source.length, to: source.length, expectedText: "", insertText: `\n\n${output}`
    });
    expect(result.proposal?.snapshot.content).toBe(source);
    expect(resolveAiEdit(result.proposal!)?.content).toBe(`${source}\n\n${output}`);
  });

  it("still rejects a whole-source echo against the complete bound source", async () => {
    const instruction = "在文末新增一个 Python 代码块，实现 multiply(a, b) 函数并返回 a * b。";
    const invoke = planThenGenerate(`\`\`\`python\n${source}\n\`\`\``);

    await expect(runPlannedAiTask({
      source, action: "custom", userPrompt: instruction, provider: "ztools", baseSystemPrompt: "遵照用户指令。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, { documentId: "welcome.md", revision: 7, content: source, selection: null, cursor: null, readOnly: false }, {
      invoke, isCurrent: () => true, abortCurrent: vi.fn()
    })).rejects.toMatchObject({ code: "source_echo" });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][0]).not.toContain("This is the complete welcome document");
    expect(invoke.mock.calls[1][0]).not.toContain("This is the complete welcome document");
  });

  it("fails closed when an explicit empty generation context cannot fit the direct prompt budget", async () => {
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "```python\npass\n```");

    await expect(runAiTask({
      source, action: "custom", userPrompt: "新增独立 Python 函数。", baseSystemPrompt: "x".repeat(12_000),
      actionDefinition: { id: "custom", label: "自定义", prompt: "新增独立 Python 函数。" },
      intentPlanned: true, readOnlyTask: true, outputFormat: "code", generationContextSource: ""
    }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() })).rejects.toThrow(/上下文预算/u);

    expect(invoke).not.toHaveBeenCalled();
  });
});
