import { describe, expect, it, vi } from "vitest";
import { runAiTask, type AiTaskRequest, type AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { AI_ACTIONS } from "../../src/core/ai/aiTaskPrompts";
import { buildProseEditPlan } from "../../src/core/ai/proseEditPlan";

const SLOTS_MARKER = "【待编辑文本槽】\n";
type SlotPayload = { id: string; text: string; contextBefore: string; contextAfter: string };
type ProseBatch = { protocol: "prose-edit/v1"; batchId: string; slots: SlotPayload[] };

function readBatch(prompt: string): ProseBatch {
  const start = prompt.indexOf(SLOTS_MARKER);
  if (start < 0) throw new Error("expected source-bound prose slot payload");
  return JSON.parse(prompt.slice(start + SLOTS_MARKER.length)) as ProseBatch;
}

function proseReply(prompt: string, transform: (text: string) => string = (text) => text): string {
  const batch = readBatch(prompt);
  return JSON.stringify({
    protocol: batch.protocol,
    batchId: batch.batchId,
    edits: batch.slots.map(({ id, text }) => {
      const replacement = transform(text);
      return replacement === text ? { id, status: "unchanged" } : { id, status: "replace", text: replacement };
    })
  });
}

function planFor(request: AiTaskRequest, source: string) {
  return buildProseEditPlan({
    source,
    instruction: request.userPrompt || request.actionDefinition.prompt,
    systemPrompt: request.skill?.systemPrompt || `${request.baseSystemPrompt}\n${request.actionDefinition.system || ""}`
  }, 64);
}

describe("source-bound local prose edits over paragraph documents", () => {
  it("returns one complete result with batches derived from the real prompt and output budget", async () => {
    const paragraphs = Array.from({ length: 8 }, (_, index) =>
      `ANCHOR_${String(index + 1).padStart(2, "0")}: 本段包含独立说明和一个错字。`
    );
    const source = paragraphs.join("\n\n");
    const request: AiTaskRequest = {
      source,
      action: "polish",
      baseSystemPrompt: "只润色本段，保持原意与 Markdown。",
      actionDefinition: AI_ACTIONS.find((action) => action.id === "polish")!,
      granularity: "paragraph"
    };
    const expectedPlan = planFor(request, source);
    let activeCalls = 0;
    let maxActiveCalls = 0;
    const observedSlots: string[] = [];
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt) => {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      const batch = readBatch(prompt);
      observedSlots.push(...batch.slots.map((slot) => slot.text));
      await Promise.resolve();
      activeCalls -= 1;
      return proseReply(prompt, (text) => text.replace("错字", "正字"));
    });

    const result = await runAiTask(request, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(expectedPlan.batches.length);
    expect(invoke.mock.calls.length).toBeGreaterThan(0);
    expect(maxActiveCalls).toBe(1);
    expect(observedSlots).toEqual(expectedPlan.slots.map((slot) => slot.sourceText));
    expect(result.text).toBe(source.replaceAll("错字", "正字"));
    expect(result.sourceOwned).toBe(true);
    expect(result.proseStats?.batches).toBe(expectedPlan.batches.length);
  });

  it("keeps an existing heading outside the editable body slots", async () => {
    const source = "## Existing title\n\nThis paragraph has a stable body.";
    const request: AiTaskRequest = {
      source,
      action: "polish",
      baseSystemPrompt: "保持原意。",
      actionDefinition: AI_ACTIONS.find((action) => action.id === "polish")!,
      granularity: "paragraph"
    };
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt) => proseReply(prompt));

    const result = await runAiTask(request, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(readBatch(invoke.mock.calls[0][0]).slots.map(({ text }) => text).join(" ")).toContain("stable body");
    expect(readBatch(invoke.mock.calls[0][0]).slots.map(({ text }) => text).join(" ")).not.toContain("Existing title");
    expect(result.text).toBe(source);
  });

  it("does not confuse 51 short paragraphs with 51 model calls", async () => {
    const paragraphs = Array.from({ length: 51 }, (_, index) => `第 ${index + 1} 段是独立且完整的正文。`);
    const source = paragraphs.join("\n\n");
    const request: AiTaskRequest = {
      source,
      action: "polish",
      baseSystemPrompt: "保持原意。",
      actionDefinition: AI_ACTIONS.find((action) => action.id === "polish")!,
      granularity: "paragraph"
    };
    const expectedPlan = planFor(request, source);
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt) => proseReply(prompt));

    const result = await runAiTask(request, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(expectedPlan.batches.length).toBeLessThan(51);
    expect(invoke).toHaveBeenCalledTimes(expectedPlan.batches.length);
    expect(result.text).toBe(source);
  });

  it("rejects a structural change once and leaves nested-list source unmodified", async () => {
    const source = "- Parent item\n  - Nested item\n\nA later paragraph remains untouched.";
    const request: AiTaskRequest = {
      source,
      action: "polish",
      baseSystemPrompt: "保持 Markdown 结构。",
      actionDefinition: AI_ACTIONS.find((action) => action.id === "polish")!,
      granularity: "paragraph"
    };
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (prompt) => proseReply(prompt, (text) => text.replace("Parent item", "# Parent item")));

    await expect(runAiTask(request, { invoke, isCurrent: () => true, abortCurrent: vi.fn() })).rejects.toThrow();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(source).toBe("- Parent item\n  - Nested item\n\nA later paragraph remains untouched.");
  });
});
