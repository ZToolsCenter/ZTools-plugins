import { describe, expect, it, vi } from "vitest";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { resolveAiEdit } from "../../src/core/ai/editProposal";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

const source = "保留前文。\n这是旧段落。\n保留后文。";
const selected = "这是旧段落。";
const from = source.indexOf(selected);
const instruction = "将当前选中的片段原样替换为“**已定稿**”";

describe("literal Markdown replacement in an explicit selection", () => {
  it("accepts inline formatting from the literal while preserving the rest of the document", async () => {
    const snapshot: AiDocumentSnapshot = {
      documentId: "selection.md",
      revision: 1,
      content: source,
      selection: { from, to: from + selected.length },
      selectionValid: true,
      cursor: null,
      readOnly: false
    };
    const plan = {
      version: 1,
      kind: "edit",
      operation: "rewrite",
      target: "selection",
      content: { mode: "literal", text: "**已定稿**" }
    };
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => JSON.stringify(plan));
    const options: AiTaskRunnerOptions = { invoke, isCurrent: () => true, abortCurrent: vi.fn() };

    const result = await runPlannedAiTask({
      source,
      action: "custom",
      userPrompt: instruction,
      baseSystemPrompt: "按指令处理。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snapshot, options);

    expect(result.proposal?.patch).toEqual({
      from,
      to: from + selected.length,
      expectedText: selected,
      insertText: "**已定稿**"
    });
    expect(result.resolvedIntent).toMatchObject({ operation: "rewrite", target: "selection", content: { mode: "literal", text: "**已定稿**" } });
    expect(result.proposal?.text).toBe("**已定稿**");
    expect(result.proposal?.snapshot.content).toBe(source);
    expect(resolveAiEdit(result.proposal!)?.content).toBe("保留前文。\n**已定稿**\n保留后文。");
    expect(invoke).toHaveBeenCalledTimes(0);
  });

  it("does not widen an explicit selection request to the full document when the selection is invalid", async () => {
    const snapshot: AiDocumentSnapshot = {
      documentId: "selection.md",
      revision: 1,
      content: source,
      selection: null,
      selectionValid: false,
      cursor: null,
      readOnly: false
    };
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => JSON.stringify({
      version: 1,
      kind: "edit",
      operation: "rewrite",
      target: "selection",
      content: { mode: "literal", text: "**已定稿**" }
    }));

    await expect(runPlannedAiTask({
      source,
      action: "custom",
      userPrompt: instruction,
      baseSystemPrompt: "按指令处理。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snapshot, { invoke, isCurrent: () => true, abortCurrent: vi.fn() }))
      .rejects.toMatchObject({ code: "selection_required" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "partial inline-code body",
      source: "保留前文。\n`这是旧段落。`\n保留后文。",
      selected: "这是旧段落。"
    },
    {
      label: "partial link destination",
      source: "[说明](https://example.test/这是旧段落)\n保留后文。",
      selected: "这是旧段落"
    },
    {
      label: "HTML attribute value",
      source: "<span title=\"这是旧段落。\">保留正文</span>",
      selected: "这是旧段落。"
    },
    {
      label: "table cell",
      source: "| 状态 | 备注 |\n| --- | --- |\n| 这是旧段落。 | 保留 |",
      selected: "这是旧段落。"
    }
  ])("keeps protected Markdown boundaries when the explicit selection covers only part of a $label", async ({ source, selected }) => {
    const from = source.indexOf(selected);
    const snapshot: AiDocumentSnapshot = {
      documentId: "selection.md",
      revision: 1,
      content: source,
      selection: { from, to: from + selected.length },
      selectionValid: true,
      cursor: null,
      readOnly: false
    };
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "");

    await expect(runPlannedAiTask({
      source,
      action: "custom",
      userPrompt: instruction,
      baseSystemPrompt: "按指令处理。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snapshot, { invoke, isCurrent: () => true, abortCurrent: vi.fn() }))
      .rejects.toThrow(/Markdown AST 结构校验/);
    expect(invoke).not.toHaveBeenCalled();
  });
});
