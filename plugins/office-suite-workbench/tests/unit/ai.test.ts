import { describe, expect, it, vi } from "vitest";

import {
  AI_CANCEL_UNSETTLED_MESSAGE,
  aiToolInactiveError,
  createOfficeAiTurn,
  createOfficeAiTurnToolHandler,
  normalizeOfficeAiToolInput,
  normalizeAiCancelResult,
  officeAiToolForTurn,
  type OfficeAiTurn
} from "../../src/lib/ai";

const documentPath = "/Users/harris/Downloads/1111.docx";

describe("Office AI turn binding", () => {
  it("uses a distinct safe tool name and immutable token for every turn", () => {
    const first = createOfficeAiTurn("session.-unsafe/value", 1);
    const second = createOfficeAiTurn("session.-unsafe/value", 2);

    expect(first.toolName).toBe("office_document_sessionunsafevalue_1");
    expect(second.toolName).toBe("office_document_sessionunsafevalue_2");
    expect(first.token).not.toBe(second.token);
    expect(officeAiToolForTurn(first).function.name).toBe(first.toolName);
    expect(aiToolInactiveError(first, first)).toBeNull();
    expect(aiToolInactiveError(second, first)).toEqual({
      code: "AI_TOOL_INACTIVE",
      message: "The AI turn is no longer active; this OfficeCLI call was not started."
    });
  });

  it("normalizes cancellation barriers and exposes the 2.5 second timeout warning", () => {
    expect(normalizeAiCancelResult({ cancelled: 2, settled: true }))
      .toEqual({ cancelled: 2, settled: true });
    expect(normalizeAiCancelResult({ cancelled: 1, settled: false }))
      .toEqual({ cancelled: 1, settled: false });
    expect(normalizeAiCancelResult(3)).toEqual({ cancelled: 3, settled: true });
    expect(normalizeAiCancelResult({ cancelled: -1, settled: true }))
      .toEqual({ cancelled: 0, settled: false });
    expect(AI_CANCEL_UNSETTLED_MESSAGE).toMatch(/2\.5 秒.*短暂重叠/u);
  });

  it("rejects A after stop and B start without running under B permissions or file selection", async () => {
    const turnA = createOfficeAiTurn("test", 1);
    const turnB = createOfficeAiTurn("test", 2);
    let activeTurn: OfficeAiTurn | null = turnA;
    const runA = vi.fn(async () => ({
      ok: true as const,
      data: { exitCode: 0, stdout: "A", stderr: "" }
    }));
    const runB = vi.fn(async () => ({
      ok: true as const,
      data: { exitCode: 0, stdout: "B", stderr: "" }
    }));
    const handlerA = createOfficeAiTurnToolHandler({
      turn: turnA,
      getActiveTurn: () => activeTurn,
      selectedFile: "/tmp/A.docx",
      allowWrite: false,
      runForAi: runA
    });
    const handlerB = createOfficeAiTurnToolHandler({
      turn: turnB,
      getActiveTurn: () => activeTurn,
      selectedFile: "/tmp/B.docx",
      allowWrite: true,
      runForAi: runB
    });

    activeTurn = null;
    activeTurn = turnB;
    await expect(handlerA({ operation: "view" })).resolves.toEqual({
      ok: false,
      error: {
        code: "AI_TOOL_INACTIVE",
        message: "The AI turn is no longer active; this OfficeCLI call was not started."
      }
    });
    expect(runA).not.toHaveBeenCalled();

    await expect(handlerB({ operation: "view" })).resolves.toMatchObject({ ok: true, stdout: "B" });
    expect(runB).toHaveBeenCalledWith(
      ["view", "/tmp/B.docx", "text"],
      { allowWrite: true }
    );
  });

  it("suppresses a result that completes after its owning turn was replaced", async () => {
    const turnA = createOfficeAiTurn("test", 1);
    const turnB = createOfficeAiTurn("test", 2);
    let activeTurn: OfficeAiTurn | null = turnA;
    let resolveRun: ((result: {
      ok: true;
      data: { exitCode: number; stdout: string; stderr: string };
    }) => void) | undefined;
    const runForAi = vi.fn(() => new Promise<{
      ok: true;
      data: { exitCode: number; stdout: string; stderr: string };
    }>(resolve => { resolveRun = resolve; }));
    const onResult = vi.fn();
    const handler = createOfficeAiTurnToolHandler({
      turn: turnA,
      getActiveTurn: () => activeTurn,
      selectedFile: "/tmp/A.docx",
      allowWrite: false,
      runForAi,
      onResult
    });

    const pending = handler({ operation: "view" });
    expect(runForAi).toHaveBeenCalledOnce();
    activeTurn = turnB;
    resolveRun?.({ ok: true, data: { exitCode: 0, stdout: "late A", stderr: "" } });

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "AI_TOOL_INACTIVE" }
    });
    expect(onResult).not.toHaveBeenCalled();
  });
});

describe("normalizeOfficeAiToolInput", () => {

  it("builds structured OfficeCLI argv and uses the selected document", () => {
    expect(normalizeOfficeAiToolInput({ operation: "view", args: ["stats", "--json"] }, documentPath))
      .toEqual(["view", documentPath, "stats", "--json"]);
    expect(normalizeOfficeAiToolInput({ operation: "set", args: ["/body/p[1]", "--prop", "bold=true"] }, documentPath))
      .toEqual(["set", documentPath, "/body/p[1]", "--prop", "bold=true"]);
  });

  it("repairs the path-first and read inputs observed from native AI", () => {
    expect(normalizeOfficeAiToolInput({ operation: documentPath }))
      .toEqual(["view", documentPath, "text"]);
    expect(normalizeOfficeAiToolInput({ operation: "read", filePath: documentPath }))
      .toEqual(["view", documentPath, "text"]);
    expect(normalizeOfficeAiToolInput({ command: documentPath }))
      .toEqual(["view", documentPath, "text"]);
    expect(normalizeOfficeAiToolInput({ command: "read" }, documentPath))
      .toEqual(["view", documentPath, "text"]);
  });

  it("rejects ambiguous operations and invalid argument shapes", () => {
    expect(() => normalizeOfficeAiToolInput({ operation: "summarize" }, documentPath))
      .toThrow(/Unsupported office_document operation/u);
    expect(() => normalizeOfficeAiToolInput({ operation: "view", args: "text" }, documentPath))
      .toThrow(/array of strings/u);
  });
});
