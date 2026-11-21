import { describe, it, expect, vi } from "vitest";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
const source = "outside SECRET-A\n\nselected SECRET-B";
const snapshot = { documentId: "private.md", revision: 1, content: source, selection: { from: source.indexOf("selected"), to: source.length }, cursor: null, readOnly: false };
const plan = (target: "document" | "selection") => JSON.stringify({ version: 1, kind: "answer", target, content: { mode: "generate", task: "custom" } });
const request = (instruction: string) => buildAiTaskRequest({ source: source.slice(snapshot.selection.from), selected: true, action: "custom", userPrompt: instruction, config: { provider: "local", activeRoleId: "general", customSystemPrompt: "" } });
describe("default selected answer scope", () => {
  it("rejects a whole-document answer plan before any outside source reaches generation", async () => {
    const invoke = vi.fn(async () => plan("document"));
    await expect(runPlannedAiTask(request("解释一下"), snapshot, { invoke, isCurrent: () => true, abortCurrent: vi.fn() })).rejects.toMatchObject({ code: "scope_mismatch" });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls.flat().join()).not.toContain("SECRET-A");
  });
  it.each([
    ["解释一下", "selection", false],
    ["解释全文", "document", true]
  ] as const)("reads only the authorized range: %s", async (instruction, target, outsideAllowed) => {
    const outputs = [plan(target), "已解释当前请求范围。"];
    const invoke = vi.fn(async () => outputs.shift()!);
    const result = await runPlannedAiTask(request(instruction), snapshot, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });
    expect(result.answerOnly).toBe(true);
    expect((invoke.mock.calls[1] as unknown[])[0]?.toString().includes("SECRET-A")).toBe(outsideAllowed);
  });
});
