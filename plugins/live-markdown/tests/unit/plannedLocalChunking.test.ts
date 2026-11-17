import { describe, expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { resolveAiEdit } from "../../src/core/ai/editProposal";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";

const SLOTS_MARKER = "【待编辑 Markdown】\n";

function proseReply(prompt: string, transform: (text: string) => string): string {
  const start = prompt.indexOf(SLOTS_MARKER);
  return transform(prompt.slice(start + SLOTS_MARKER.length));
}

const paragraph = (id: number) => `C0${id}：我们以经记录本轮工作，现阶段需要梳理处理流程。` + "参与人员应该在开始前核对输入内容，执行结束后保留验收记录。原有事实和数字必须保持稳定。".repeat(3);
const code = '```js\nconst sentinel = "KEEP-CODE";\n```';
const source = Array.from({ length: 8 }, (_, index) => paragraph(index + 1) + (index === 3 ? `\n\n${code}` : "")).join("\n\n");

describe("local natural-language conservative editing policy", () => {
  it("derives paragraph processing after planning without a test-only granularity override", async () => {
    const userPrompt = "润色全文并纠正错别字，保留原有事实、代码和段落标识顺序。";
    const request = buildAiTaskRequest({ source, selected: false, action: "custom", userPrompt, config: { provider: "local", activeRoleId: "general", customSystemPrompt: "" } });
    expect(request.granularity).toBe("budget");
    let plannedBatches = 0;
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async prompt => {
      if (!prompt.includes(SLOTS_MARKER)) return JSON.stringify({ version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "polish" } });
      return proseReply(prompt, (text) => text.replaceAll("以经", "已经"));
    });
    const result = await runPlannedAiTask(request, { documentId: "long.md", revision: 3, content: source, selection: null, cursor: null, readOnly: false }, {
      invoke, isCurrent: () => true, abortCurrent: vi.fn(),
      onProsePlan: (plan) => { plannedBatches = plan.batches.length; }
    });
    const content = resolveAiEdit(result.proposal!)!.content;
    expect(content).toBe(source.replaceAll("以经", "已经"));
    expect(content).toContain(code);
    const contentCalls = invoke.mock.calls.filter(([prompt]) => prompt.includes(SLOTS_MARKER));
    expect(plannedBatches).toBeGreaterThan(0);
    expect(contentCalls).toHaveLength(plannedBatches);
    const ownedTexts: string[] = [];
    for (const [prompt] of contentCalls) {
      const text = prompt.slice(prompt.indexOf(SLOTS_MARKER) + SLOTS_MARKER.length);
      expect(source.includes(text)).toBe(true);
      expect(text).not.toContain("KEEP-CODE");
      ownedTexts.push(text);
    }
    for (let id = 1; id <= 8; id += 1) {
      expect(ownedTexts.some(text => text.includes(`C0${id}：我们以经记录本轮工作，现阶段需要梳理处理流程。`))).toBe(true);
    }
  });
});

it("keeps a protected-only document unchanged without invoking content generation", async () => {
  const protectedSource = '```js\nconst code = 1;\n```\n\n| A | B |\n| --- | --- |\n| x | 1 |\n\n$$\nx^2\n$$';
  const request = buildAiTaskRequest({ source: protectedSource, selected: false, action: "custom", userPrompt: "润色全文", config: { provider: "local", activeRoleId: "general", customSystemPrompt: "" } });
  const invoke = vi.fn(async () => JSON.stringify({ version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "polish" } }));
  const result = await runPlannedAiTask(request, { documentId: "protected.md", revision: 1, content: protectedSource, selection: null, cursor: null, readOnly: false }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });
  expect(invoke).not.toHaveBeenCalled();
  expect(result.preservedSource).toBe(true);
  expect(result.proposal).toBeUndefined();
  expect(result.text).toBe(protectedSource);
});
