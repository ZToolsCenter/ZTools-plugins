import { describe, expect, it, vi } from "vitest";

import type { PasteStackState } from "@pasteboard-pro/core";

import { createPasteboardState } from "../src/state";
import { createPasteStackController } from "../src/paste-stack-controller";

const selectedIds = Array.from({ length: 100 }, (_, index) =>
  `mixed-${String(index).padStart(3, "0")}`,
);

function createHarness(options: {
  readonly supportsGlobalQueue?: boolean;
  readonly saved?: (snapshot: PasteStackState) => PasteStackState | undefined | Promise<PasteStackState | undefined>;
  readonly initialStack?: PasteStackState;
} = {}) {
  const state = createPasteboardState({
    items: [],
    selection: { selected: selectedIds },
    ...(options.initialStack === undefined ? {} : { pasteStack: options.initialStack }),
  });
  const statuses: string[] = [];
  const closeShelf = vi.fn();
  const saveStack = vi.fn(async (snapshot: PasteStackState) =>
    options.saved === undefined
      ? structuredClone(snapshot)
      : options.saved(snapshot),
  );
  const controller = createPasteStackController({
    state: {
      get pasteStack() {
        return state.pasteStack;
      },
      selectionPasteQueue: () => state.selectionPasteQueue(),
      dispatchPasteStack: action => state.dispatchPasteStack(action),
      setPasteStack: pasteStack => state.setPasteStack(pasteStack),
      clearSelection: () => state.clearSelection(),
    },
    saveStack,
    reportStatus: message => statuses.push(message),
    closeShelf,
    supportsGlobalQueue: options.supportsGlobalQueue ?? true,
  });
  return { state, statuses, closeShelf, saveStack, controller };
}

describe("paste stack controller", () => {
  it("only closes after all 100 mixed selected IDs are persisted", async () => {
    const harness = createHarness({
      initialStack: { direction: "reverse", itemIds: ["previous"] },
    });

    await expect(harness.controller.startSelection()).resolves.toBe(true);

    expect(harness.saveStack).toHaveBeenCalledTimes(1);
    expect(harness.saveStack.mock.calls[0]?.[0]).toEqual({
      direction: "reverse",
      itemIds: selectedIds,
    });
    expect(harness.state.pasteStack).toEqual({
      direction: "reverse",
      itemIds: selectedIds,
    });
    expect(harness.statuses).toEqual(["已按选择顺序生成 100 项粘贴队列"]);
    expect(harness.closeShelf).toHaveBeenCalledOnce();
  });

  it.each([
    ["no response", async () => undefined],
    ["dropped entries", async (snapshot: PasteStackState) => ({
      ...snapshot,
      itemIds: snapshot.itemIds.slice(0, 1),
    })],
    ["changed order", async (snapshot: PasteStackState) => ({
      ...snapshot,
      itemIds: [...snapshot.itemIds].reverse(),
    })],
    ["persistence rejection", async () => { throw new Error("database unavailable"); }],
  ] as const)("keeps the shelf open and restores the old queue after %s", async (_label, saved) => {
    const initialStack = { direction: "forward" as const, itemIds: ["previous"] };
    const harness = createHarness({
      initialStack,
      saved: vi.fn()
        .mockImplementationOnce(saved)
        .mockResolvedValueOnce(initialStack),
    });

    await expect(harness.controller.startSelection()).resolves.toBe(false);

    expect(harness.closeShelf).not.toHaveBeenCalled();
    expect(harness.saveStack).toHaveBeenCalledTimes(2);
    expect(harness.saveStack.mock.calls[1]?.[0]).toEqual(initialStack);
    expect(harness.state.pasteStack).toEqual(initialStack);
    expect(harness.statuses.at(-1)).toMatch(/队列|数据库|保存/);
  });

  it("does not simulate a rapid per-item paste on platforms without global queue", async () => {
    const harness = createHarness({ supportsGlobalQueue: false });

    await expect(harness.controller.startSelection()).resolves.toBe(false);

    expect(harness.saveStack).not.toHaveBeenCalled();
    expect(harness.closeShelf).not.toHaveBeenCalled();
    expect(harness.statuses).toContain("当前平台暂不支持逐项粘贴队列，请分次选择粘贴");
  });
});
