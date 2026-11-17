import { expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";

it("treats preserved first/last markers as prose constraints rather than insertion positions", async () => {
  const source = "OPEN-EDGE\n\nThe release notes needs a review.\n\n```js\nconst stable = 'KEEP';\n```\n\nCLOSE-EDGE";
  const instruction = "只润色可读正文，保留代码块、公式、表格和文首文末标记原样不变。";
  const request = buildAiTaskRequest({ source, selected: false, action: "custom", userPrompt: instruction,
    config: { provider: "local", activeRoleId: "general" } });
  const invoke = vi.fn(async (prompt: string) => {
    expect(prompt).not.toMatch(/OPEN-EDGE|CLOSE-EDGE|const stable/u);
    const marker = "正文文本槽：";
    const data = JSON.parse(prompt.slice(prompt.lastIndexOf(marker) + marker.length)) as { slots: Array<{ id: string; text: string }> };
    return JSON.stringify({ edits: data.slots.map(({ id, text }) => ({ id, text: text.replace("notes needs", "notes need") })) });
  });
  const result = await runPlannedAiTaskCore(request, { documentId: "polish.md", revision: 1, content: source,
    selection: null, cursor: 0, readOnly: false }, { invoke, isCurrent: () => true, abortCurrent() {} });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(result.contentExecutor).toBe("prose");
  expect(result.proposal?.patch?.insertText).toBe(source.replace("notes needs", "notes need"));
});

it("keeps an actual append target when another clause preserves document markers", () => {
  const contract = deriveInstructionContract("在文末追加 hello，同时保留文首文末标记原样不变。", { hasSelection: false, hasCursor: true });
  expect(contract.target).toMatchObject({ state: "explicit", value: "document_end" });
});
