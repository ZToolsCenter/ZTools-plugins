import { expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";

it.each([
  ["在文末用四级标题“接口 (v2) [beta]”，随后用 Python 代码围栏定义 run_check。", "def run_check():\n    return True", "#### 接口 \\(v2\\) \\[beta\\]", "artifact", 1],
  ["在文末追加 JSON 对象，仅包含 enabled:false、owner:null 和 tags:[“青”,“蓝”]。", '{"enabled":false,"owner":null,"tags":["青","蓝"]}', '"enabled": false', "literal", 0]
])("uses literal data or one content payload when code language and insertion anchor are known: %s", async (instruction, body, expected, executor, calls) => {
  const content = "# Private\n\nPRIVATE_SOURCE must not be sent.";
  const invoke = vi.fn(async (prompt: string, _system: string, _tokens: number, _emit: unknown, schema?: Record<string, unknown>) => {
    expect(prompt).not.toContain("PRIVATE_SOURCE");
    expect(schema).toHaveProperty("properties.payload");
    expect(schema).not.toHaveProperty("anyOf");
    return JSON.stringify({ payload: body });
  });
  const request = buildAiTaskRequest({ source: content, selected: false, action: "custom", userPrompt: instruction,
    config: { provider: "local", activeRoleId: "general" } });
  const result = await runPlannedAiTaskCore(request, { documentId: "code.md", revision: 1, content, selection: null, cursor: null, readOnly: false },
    { invoke, isCurrent: () => true, abortCurrent() {} });
  expect(result.contentExecutor).toBe(executor);
  expect(result.candidateText).toContain(expected);
  expect(result.proposal?.patch).toMatchObject({ from: content.length, to: content.length, expectedText: "" });
  expect(invoke).toHaveBeenCalledTimes(calls);
});
