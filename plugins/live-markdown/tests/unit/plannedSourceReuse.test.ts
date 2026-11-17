import { describe, expect, it, vi } from "vitest";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { resolveAiEdit } from "../../src/core/ai/editProposal";

const source = "const flags = { beta: true, gamma: false };";
const output = `\`\`\`javascript\n${source}\nif (typeof flags.beta !== "boolean") throw new Error("invalid flags");\n\`\`\``;
const insertPlan = JSON.stringify({ version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "generate", task: "custom" } });

function stagedInvoke(generated = output) {
  return vi.fn(async (_prompt: string, _system?: string, _max?: number, _emit?: unknown, outputSchema?: unknown) => outputSchema ? insertPlan : generated);
}

describe("planned insertion with intentional structured-source reuse", () => {
  it("gives generation a reuse-compatible instruction and creates one reviewed append", async () => {
    const instruction = "在文末新增一个 JavaScript 代码块，复用原配置，包含字段类型校验。只输出新增代码块。";
    const invoke = stagedInvoke();
    const snapshot = { documentId: "reuse.md", revision: 2, content: source, selection: null, cursor: null, readOnly: false };
    const result = await runPlannedAiTask({
      source, action: "custom", userPrompt: instruction, provider: "ztools", baseSystemPrompt: "遵照用户指令。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snapshot, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(2);
    const prompt = (invoke.mock.calls as unknown as Array<[string, unknown, unknown, unknown, unknown]>)[1][0];
    expect(prompt).toContain("按要求复用");
    expect(prompt).toContain(instruction);
    expect(prompt).toContain("仅在要求的产物内部按要求复用来源材料");
    expect(result.planningMode).toBe("model");
    expect(result.proposal?.mode).toBe("append");
    expect(resolveAiEdit(result.proposal!)?.content).toBe(`${source}\n\n${output}`);
    expect(snapshot.content).toBe(source);
  });

  it("keeps a read-only preservation instruction from authorizing code duplication", async () => {
    const instruction = "在文末新增一个 JavaScript 代码块，保留原代码不变并只输出新增代码块。";
    const invoke = stagedInvoke();
    await expect(runPlannedAiTask({
      source, action: "custom", userPrompt: instruction, provider: "ztools", baseSystemPrompt: "遵照用户指令。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, { documentId: "reuse.md", revision: 2, content: source, selection: null, cursor: null, readOnly: false },
    { invoke, isCurrent: () => true, abortCurrent: vi.fn() })).rejects.toMatchObject({ code: "source_echo" });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("respects an explicit 请勿 reuse prohibition throughout the planned insertion", async () => {
    const instruction = "在文末新增一个 JavaScript 代码块，请勿复用原代码，只输出新增代码块。";
    const invoke = stagedInvoke();
    await expect(runPlannedAiTask({
      source, action: "custom", userPrompt: instruction, provider: "ztools", baseSystemPrompt: "遵照用户指令。",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, { documentId: "reuse.md", revision: 2, content: source, selection: null, cursor: null, readOnly: false },
    { invoke, isCurrent: () => true, abortCurrent: vi.fn() })).rejects.toMatchObject({ code: "source_echo" });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("keeps a prior read-only sentence from negating a subsequent explicit reuse directive", async () => {
    const instruction = "At the end, add a JavaScript code block. Do not modify the original code. Reuse existing code.";
    const invoke = stagedInvoke();
    const result = await runPlannedAiTask({
      source, action: "custom", userPrompt: instruction, provider: "ztools", baseSystemPrompt: "Follow the user's instruction.",
      actionDefinition: { id: "custom", label: "Custom", prompt: instruction }
    }, { documentId: "reuse.md", revision: 2, content: source, selection: null, cursor: null, readOnly: false },
    { invoke, isCurrent: () => true, abortCurrent: vi.fn() });
    expect(result.proposal?.mode).toBe("append");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(resolveAiEdit(result.proposal!)?.content).toBe(`${source}\n\n${output}`);
  });
});
