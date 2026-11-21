import { describe, expect, it, vi } from "vitest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import { resolveAiEdit } from "../../src/core/ai/editProposal";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";

async function execute(instruction: string, source: string) {
  const invoke = vi.fn(async () => { throw new Error("Grounded replacement must not infer."); });
  const result = await runPlannedAiTaskCore({ source, action: "custom", userPrompt: instruction,
    actionDefinition: { id: "custom", label: "custom", prompt: instruction }, baseSystemPrompt: "", provider: "local" },
    { documentId: "all.md", revision: 1, content: source, selection: null, cursor: null, readOnly: false },
    { invoke, isCurrent: () => true, abortCurrent: vi.fn() });
  expect(invoke).not.toHaveBeenCalled();
  return result;
}

describe("unquoted English all is an occurrence qualifier", () => {
  it.each(["Replace all foo with bar", "Change all foo to bar"])("binds %s to all source matches", async instruction => {
    const result = await execute(instruction, "foo\r\nKEEP\r\nfoo");
    expect(result.resolvedIntent).toMatchObject({ operation: "replace_exact", find: "foo", occurrence: "all" });
    expect(resolveAiEdit(result.proposal!)?.content).toBe("bar\r\nKEEP\r\nbar");
  });

  it("keeps a quoted qualifier inside the exact source literal", async () => {
    const contract = deriveInstructionContract("Replace ‘all foo’ with ‘bar’");
    expect(contract.literals).toContainEqual(expect.objectContaining({ role: "find", value: "all foo" }));
    expect(contract.occurrence.state).toBe("unknown");
    const result = await execute("Replace only one occurrence of ‘all foo’ with ‘bar’", "all foo then foo");
    expect(result.resolvedIntent).toMatchObject({ find: "all foo" });
    expect(resolveAiEdit(result.proposal!)?.content).toBe("bar then foo");
  });
});
