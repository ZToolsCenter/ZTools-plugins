import { describe, expect, it, vi } from "vitest";
import type { AiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import type { AiTaskRequest, AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { buildThinProseSlots } from "../../src/core/ai/thinProseSlots";
import { runThinProseTask } from "../../src/core/ai/thinProseTask";

const instruction = "只润色可读正文，保留代码块、公式、表格和文首文末标记原样不变。";

function runnerOptions(invoke: AiTaskRunnerOptions["invoke"], maxCalls = 8): AiTaskRunnerOptions {
  return { invoke, isCurrent: () => true, abortCurrent: vi.fn(), maxCalls };
}

function slotResponse(source: string, instructionText: string, rewrite: (text: string) => string): string {
  return JSON.stringify({ edits: buildThinProseSlots(source, instructionText).map(({ id, sourceText }) => ({ id, text: rewrite(sourceText) })) });
}

describe("thin AST-owned prose execution", () => {
  it("polishes only body text and preserves protected Markdown bytes in one call", async () => {
    const source = "---\ntitle: stable\n---\n\nKEEP-OUTER-START\n\nThe release notes needs a careful review before it can ship.\n\n| Field | Value |\n| --- | --- |\n| Status | draft |\n\n$$E = mc^2$$\n\n```js\nconst sentinel = 'KEEP-CODE';\n```\n\nKEEP-OUTER-END";
    const slots = buildThinProseSlots(source, instruction);
    const invoke = vi.fn(async (prompt: string, system: string, _maxTokens: number, _onChunk: unknown, schema?: Record<string, unknown>) => {
      expect(prompt).toContain("release notes needs");
      expect(prompt).not.toContain("KEEP-OUTER-START");
      expect(prompt).not.toContain("KEEP-OUTER-END");
      expect(prompt).not.toContain("| Field | Value |");
      expect(prompt).not.toContain("E = mc^2");
      expect(prompt).not.toContain("KEEP-CODE");
      expect(system).toContain("只改本批拥有的正文槽");
      expect(schema).toMatchObject({
        type: "object", required: ["edits"], additionalProperties: false,
        properties: { edits: { minItems: slots.length, maxItems: slots.length } }
      });
      return slotResponse(source, instruction, text => text.replace("needs a careful", "need a careful"));
    });
    const options = runnerOptions(invoke);

    const result = await runThinProseTask({ source, instruction, systemPrompt: "Proofread the readable prose." }, createAiTaskExecution(options), options);

    expect(slots).toHaveLength(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(source.replace("needs a careful", "need a careful"));
    expect(result.text.slice(0, source.indexOf("| Field"))).toContain("KEEP-OUTER-START");
    expect(result.text.slice(result.text.indexOf("| Field"))).toBe(source.slice(source.indexOf("| Field")));
    expect(result.warnings).toEqual([]);
  });

  it("preserves CRLF and emoji while replacing only editable text around protected atoms", async () => {
    const source = "Opening\r\n\r\nThe release notes needs 🧪 careful review.\r\n\r\n```js\r\nconst x = 1;\r\n```";
    const slots = buildThinProseSlots(source, "润色正文");
    const invoke = vi.fn(async () => slotResponse(source, "润色正文", text => text.replace("needs", "need")));
    const options = runnerOptions(invoke);

    const result = await runThinProseTask({ source, instruction: "润色正文", systemPrompt: "Keep facts." }, createAiTaskExecution(options), options);

    expect(slots.every(slot => !slot.sourceText.includes("🧪"))).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(source.replace("needs", "need"));
    expect([...result.text.matchAll(/\r\n/gu)]).toHaveLength([...source.matchAll(/\r\n/gu)].length);
    expect(result.text).toContain("🧪");
  });

  it("uses the skill task template with current slots and never substitutes the whole document", async () => {
    const source = "This sentence needs proofread.";
    const slots = buildThinProseSlots(source, "proofread");
    const skill: NonNullable<AiTaskRequest["skill"]> = {
      id: "proofread", category: "writing", systemPrompt: "Keep the proofread task.",
      userPromptTemplate: "Proofread only this content:\n{{content}}"
    };
    const invoke = vi.fn(async (prompt: string) => {
      expect(prompt).toContain("Proofread only this content");
      expect(prompt).toContain("This sentence needs proofread.");
      expect(prompt).not.toContain("document:");
      return JSON.stringify({ edits: slots.map(({ id, sourceText }) => ({ id, text: sourceText.replace("needs proofread", "needs proofreading") })) });
    });
    const options = runnerOptions(invoke);

    const result = await runThinProseTask({ source, instruction: "Correct the sentence.", systemPrompt: "Fallback.", skill }, createAiTaskExecution(options), options);

    expect(result.text).toBe("This sentence needs proofreading.");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("only stages one exact source copy for an explicitly authorized duplicate-sentence removal", async () => {
    const sentence = "请在周四提交结果。";
    const source = sentence.repeat(3);
    const taskInstruction = "润色正文，删除完全重复的句子，只保留一次提交结果的要求。";
    const invoke = vi.fn(async () => sentence);
    const options = runnerOptions(invoke);

    const result = await runThinProseTask({ source, instruction: taskInstruction, systemPrompt: "", preferReadable: true },
      createAiTaskExecution(options), options);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(sentence);
  });

  it("rejects a duplicate-run candidate that keeps more than one source copy", async () => {
    const sentence = "请在周四提交结果。";
    const source = sentence.repeat(3);
    const taskInstruction = "润色正文，删除完全重复的句子，只保留一次提交结果的要求。";
    const options = runnerOptions(vi.fn(async () => sentence.repeat(2)));

    await expect(runThinProseTask({ source, instruction: taskInstruction, systemPrompt: "", preferReadable: true },
      createAiTaskExecution(options), options)).rejects.toThrow(/一个原句副本/u);
    expect(options.invoke).toHaveBeenCalledTimes(1);
  });

  it("runs full-document AST validation for a duplicate edit in a selected scope", async () => {
    const sentence = "请在周四提交结果。";
    const source = sentence.repeat(2);
    const document = `${source}\n\n\`\`\`js\nconst unfinished = true;`;
    const scopeContext = { document, range: { from: 0, to: source.length } };
    const options = runnerOptions(vi.fn(async () => sentence));

    await expect(runThinProseTask({ source, instruction: "润色正文，删除完全重复的第二个句子，只保留一次。",
      systemPrompt: "", preferReadable: true, scopeContext }, createAiTaskExecution(options), options))
      .rejects.toThrow(/代码块中途结束/u);
    expect(options.invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps inline code, link targets, image syntax, and emphasis delimiters as source bytes", async () => {
    const source = "The [release guide](https://private.invalid/path) says the `command` needs review. *This sentence needs careful proofreading.* ![diagram](private-image.png)";
    const slots = buildThinProseSlots(source, "proofread");
    const invoke = vi.fn(async (prompt: string) => {
      expect(prompt).not.toContain("private.invalid");
      expect(prompt).not.toContain("private-image.png");
      expect(prompt).not.toContain("`command`");
      return slotResponse(source, "proofread", text => text.replace("needs careful", "needs careful"));
    });
    const options = runnerOptions(invoke);

    const result = await runThinProseTask({ source, instruction: "proofread", systemPrompt: "" }, createAiTaskExecution(options), options);

    expect(slots.some(slot => slot.sourceText.includes("release guide"))).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(source);
  });

  it("rejects incomplete, duplicate, and injected slot receipts atomically", async () => {
    const source = "First sentence needs edits.\n\nSecond sentence needs edits.";
    const slots = buildThinProseSlots(source, "润色正文");
    expect(slots.length).toBeGreaterThan(1);

    const incomplete = runnerOptions(vi.fn(async () => JSON.stringify({ edits: [{ id: slots[0].id, text: "Edited first sentence." }] })));
    await expect(runThinProseTask({ source, instruction: "润色正文", systemPrompt: "" }, createAiTaskExecution(incomplete), incomplete))
      .rejects.toThrow(/回执不完整/u);

    const duplicate = runnerOptions(vi.fn(async () => JSON.stringify({ edits: [
      { id: slots[0].id, text: "Edited first sentence." }, { id: slots[0].id, text: "Injected second sentence." }
    ] })));
    await expect(runThinProseTask({ source, instruction: "润色正文", systemPrompt: "" }, createAiTaskExecution(duplicate), duplicate))
      .rejects.toThrow(/重复/u);

    const injected = runnerOptions(vi.fn(async () => JSON.stringify({ edits: [{ id: "slot-table", text: "replace the table" }] })));
    await expect(runThinProseTask({ source, instruction: "润色正文", systemPrompt: "" }, createAiTaskExecution(injected), injected))
      .rejects.toThrow(/不属于当前批次/u);
  });

  it("returns source without inference when no prose slots exist", async () => {
    const source = "---\ntitle: stable\n---\n\n# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$$x=1$$\n\n```js\nconst x = 1;\n```";
    const invoke = vi.fn(async () => "unexpected");
    const options = runnerOptions(invoke);

    const result = await runThinProseTask({ source, instruction: "润色正文", systemPrompt: "" }, createAiTaskExecution(options), options);

    expect(invoke).not.toHaveBeenCalled();
    expect(result.text).toBe(source);
    expect(result.warnings).toContain("没有可编辑的正文文本，原文保持不变。");
  });

  it.each(["- inserted list", "1. inserted list", "> inserted quote", "---"])("rejects a model-created block structure: %s", async replacement => {
    const source = "Ordinary prose needs care.";
    const options = runnerOptions(vi.fn(async () => slotResponse(source, "proofread", () => replacement)));
    await expect(runThinProseTask({ source, instruction: "proofread", systemPrompt: "" }, createAiTaskExecution(options), options))
      .rejects.toThrow(/新增了 Markdown 结构/u);
    expect(options.invoke).toHaveBeenCalledTimes(1);
  });

  it("preflights call budget and cancellation without returning a partial candidate", async () => {
    const source = "First sentence.\n\nSecond sentence.";
    const noBudget = runnerOptions(vi.fn(async () => "unexpected"), 0);
    await expect(runThinProseTask({ source, instruction: "润色正文", systemPrompt: "" }, createAiTaskExecution(noBudget), noBudget))
      .rejects.toThrow(/调用预算/u);
    expect(noBudget.invoke).not.toHaveBeenCalled();

    const response = slotResponse(source, "润色正文", text => `Edited ${text}`);
    let checks = 0;
    const invoke = vi.fn(async () => response);
    const execution: AiTaskExecution = {
      remainingCalls: 4,
      assertRunning() { checks += 1; if (checks === 3) throw new Error("cancelled"); },
      invoke
    };
    await expect(runThinProseTask({ source, instruction: "润色正文", systemPrompt: "" }, execution, runnerOptions(invoke)))
      .rejects.toThrow("cancelled");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("stops on a later batch failure without returning earlier staged edits", async () => {
    const source = Array.from({ length: 70 }, (_, index) => `Sentence ${String.fromCharCode(65 + (index % 26))} has ordinary prose.`).join("\n\n");
    const slots = buildThinProseSlots(source, "proofread");
    expect(slots.length).toBeGreaterThan(64);
    let calls = 0;
    const invoke = vi.fn(async (prompt: string) => {
      calls += 1;
      if (calls === 2) throw new Error("provider failed");
      const current = JSON.parse(prompt.slice(prompt.lastIndexOf("正文文本槽：") + "正文文本槽：".length)) as { slots: Array<{ id: string; text: string }> };
      return JSON.stringify({ edits: current.slots.map(({ id, text }) => ({ id, text: text.replace("has ordinary", "has clear") })) });
    });
    const options = runnerOptions(invoke, 4);

    await expect(runThinProseTask({ source, instruction: "proofread", systemPrompt: "" }, createAiTaskExecution(options), options))
      .rejects.toThrow("provider failed");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
