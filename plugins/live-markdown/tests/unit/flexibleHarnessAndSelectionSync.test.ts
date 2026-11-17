import { describe, expect, it, vi } from "vitest";
import { readScopedEditorSelectionText } from "../../src/core/ai/editorSelectionSync";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import type { AiTaskRequest } from "../../src/core/ai/aiTaskRunner";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { assertSingleEditOperation } from "../../src/core/ai/intentConstraints";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { parseSingleCallEditResponse } from "../../src/core/ai/singleCallEditProtocol";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { resolveAiEdit } from "../../src/core/ai/editProposal";

describe("flexible harness & selection sync regressions", () => {
  it("ignores CM6 contentDOM native selectionchange while still tracking CM6 read-only widget selections and source textarea selections", () => {
    const cm6Line = { closest: () => null } as unknown as Element;
    const cm6Widget = { closest: (sel: string) => (sel.includes(".ty-cm6-table-widget") ? ({} as Element) : null) } as unknown as Element;
    const cm6TextNode = { nodeType: 3, parentElement: cm6Line } as unknown as Node;
    const widgetTextNode = { nodeType: 3, parentElement: cm6Widget } as unknown as Node;
    const editorRoot = { contains: (n: Node) => n === cm6TextNode || n === widgetTextNode } as unknown as HTMLElement;

    const sel = (node: Node, text: string) =>
      ({
        rangeCount: 1,
        isCollapsed: false,
        getRangeAt: () => ({ startContainer: node, endContainer: node }) as Range,
        toString: () => text
      }) as unknown as Selection;

    // CM6 regular line selection is owned by CodeMirror state, not native selectionchange
    expect(readScopedEditorSelectionText({ mode: "cm6", selection: sel(cm6TextNode, "line text"), editorRoot, sourceTextarea: null })).toBeNull();
    // CM6 read-only table widget selection is captured so the UI can warn safely instead of silently using stale text
    expect(readScopedEditorSelectionText({ mode: "cm6", selection: sel(widgetTextNode, "cell text"), editorRoot, sourceTextarea: null })).toBe("cell text");

    // Source mode tracks textarea selection only when focused
    const textarea = { selectionStart: 2, selectionEnd: 7, value: "01hello89", contains: () => false } as unknown as HTMLTextAreaElement;
    expect(readScopedEditorSelectionText({ mode: "source", selection: null, editorRoot: null, sourceTextarea: textarea, activeElement: textarea })).toBe("hello");
    expect(readScopedEditorSelectionText({ mode: "source", selection: null, editorRoot: null, sourceTextarea: textarea, activeElement: null })).toBeNull();
  });

  it("allows same-anchor sequential multi-artifact insertions like equation + rust code block between items 4 and 5 while keeping genuine multi-location compound edits blocked", async () => {
    const instruction = "4、5条中间插入一个二元一次方程式并在下面插入一个rust的代码块，输出打印helloworld";
    const source = "# 清单\n\n1. 第一条\n2. 第二条\n3. 第三条\n4. 第四条内容\n5. 第五条内容\n";

    expect(() => assertSingleEditOperation(instruction)).not.toThrow();
    const contract = deriveInstructionContract(instruction, { hasSelection: false, hasCursor: true });
    expect(contract.issues).toEqual([]);
    expect(contract.occurrence.state).toBe("unknown");

    const req = resolveGenerationRequirements(instruction, "custom");
    expect(req.artifact.state).toBe("unknown");

    // Genuine compound across different targets/operations must remain blocked
    expect(() => assertSingleEditOperation("底部加hello，再润色第一段")).toThrow(/多个编辑操作/u);

    const request: AiTaskRequest = {
      source,
      action: "custom",
      userPrompt: instruction,
      baseSystemPrompt: "只输出结果。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction },
      provider: "ztools",
      executionPolicy: "thin"
    };
    const snapshot = { documentId: "doc-1", revision: 1, content: source, selection: null, cursor: null, selectionValid: true, readOnly: false };
    const generatedMarkdown = "$$\nx + 2y = 5\n$$\n\n```rust\nfn main() {\n    println!(\"helloworld\");\n}\n```";
  const rawJson = "```json\n" + JSON.stringify({
    version: 1,
    kind: "edit",
    operation: "insert",
    target: "exact_match",
    find: "4. 第四条内容",
    occurrence: "single",
    matchScope: "document",
    text: generatedMarkdown
  }) + "\n```";
  const invoke = vi.fn(async () => rawJson);

    const result = await runPlannedAiTaskCore(request, snapshot, {
      invoke,
      isCurrent: () => true,
      abortCurrent: () => undefined
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.proposal).toBeDefined();
    expect(result.proposal?.patch?.expectedText).toBe("");
    const applied = resolveAiEdit(result.proposal!);
    expect(applied?.content).toContain("4. 第四条内容");
    expect(applied?.content).toContain("$$\nx + 2y = 5\n$$");
    expect(applied?.content).toContain("5. 第五条内容");
  });

  it("unwraps Markdown JSON code fences in host single-call edit responses and validates source-grounded exact_match anchors", () => {
    const source = "alpha\n4. 第四条\n5. 第五条";
    const instruction = "4、5条中间插入一个公式";
    const contract = deriveInstructionContract(instruction, { hasSelection: false, hasCursor: false });
    const candidates = buildAiIntentCandidates(instruction, source, contract);
    const fenced = '```json\n{"version":1,"kind":"edit","operation":"insert","target":"exact_match","find":"4. 第四条","occurrence":"single","matchScope":"document","text":"$$x+y=1$$"}\n```';

    const parsed = parseSingleCallEditResponse(fenced, { instruction, source, selected: false, candidates, contract });
    expect(parsed.intent).toMatchObject({
      kind: "edit",
      operation: "insert",
      target: "exact_match",
      find: "4. 第四条",
      occurrence: "single",
      matchScope: "document"
    });
    expect(parsed.text).toBe("$$x+y=1$$");
  });
});
