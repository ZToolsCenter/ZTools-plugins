import { describe, expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { PlanValidationError } from "../../src/core/ai/intentPlanValidation";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";

const instruction = "在光标处原样插入“X”";
const plan = {
  version: 1,
  kind: "edit",
  operation: "insert",
  target: "cursor",
  layout: "inline",
  content: { mode: "literal", text: "X" }
} as const;

function buildRequest(source: string) {
  return buildAiTaskRequest({
    source,
    selected: false,
    action: "custom",
    userPrompt: instruction,
    config: { provider: "local", activeRoleId: "general", customSystemPrompt: "" }
  });
}

function buildSnapshot(content: string, cursor: number): AiDocumentSnapshot {
  return { documentId: "offset-check.md", revision: 7, content, selection: null, cursor, readOnly: false };
}

function runAtCursor(content: string, cursor: number) {
  const snapshot = buildSnapshot(content, cursor);
  const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => JSON.stringify(plan));
  const executionOptions: AiTaskRunnerOptions = { invoke, isCurrent: () => true, abortCurrent: vi.fn() };
  return {
    snapshot,
    invoke,
    result: runPlannedAiTask(buildRequest(content), snapshot, executionOptions)
  };
}

describe("planned-task cursor offset preflight", () => {
  it.each([
    ["emoji surrogate pair", "A😀B", 2],
    ["CRLF separator", "left\r\nright", 5]
  ])("rejects a cursor inside a %s before planning or proposing", async (_name, source, cursor) => {
    const { snapshot, invoke, result } = runAtCursor(source, cursor);
    const outcome = await result.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );

    if (outcome.ok) throw new Error("Expected the unsafe cursor to fail preflight.");
    expect(outcome.error).toBeInstanceOf(PlanValidationError);
    expect(outcome.error).toMatchObject({
      code: "cursor_required",
      message: "这条指令要求在当前光标处插入，但无法读取有效光标位置。请先在文档中放置光标。"
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(outcome.error).not.toHaveProperty("proposal");
    expect(snapshot.content).toBe(source);
  });

  it.each([
    ["after emoji", "A😀B", 3, "A😀XB"],
    ["after CRLF", "left\r\nright", 6, "left\r\nXright"]
  ])("uses the exact valid %s boundary without planning or generation", async (_name, source, cursor, expectedContent) => {
    const { snapshot, invoke, result } = runAtCursor(source, cursor);
    const value = await result;

    expect(invoke).not.toHaveBeenCalled();
    expect(value.proposal?.patch).toEqual({ from: cursor, to: cursor, expectedText: "", insertText: "X" });
    expect(value.proposal?.snapshot.content).toBe(source);
    expect(source.slice(0, cursor) + value.proposal?.patch?.insertText + source.slice(cursor)).toBe(expectedContent);
    expect(snapshot.content).toBe(source);
  });
});
