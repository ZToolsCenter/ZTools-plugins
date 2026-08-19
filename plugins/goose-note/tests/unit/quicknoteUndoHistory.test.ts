import { expect, test } from "playwright/test";
import {
  applyRedo,
  applyUndo,
  contentEquals,
  createEmptySlotStacks,
  normalizeSlotStacks,
  recordEditHistory,
  QUICKNOTE_UNDO_MAX,
  budgetQuickNoteHistory,
} from "../../src/lib/quicknote/undoHistory";
import type { JSONContent } from "../../src/types";

const para = (text: string): JSONContent =>
  [{ type: "paragraph", content: text }] as unknown as JSONContent;

test("recordEditHistory pushes previous and clears redo", () => {
  const first = recordEditHistory({
    undo: [],
    redo: [para("stale")],
    previous: null,
    next: para("a"),
    lastRecordAt: 0,
    now: 1_000,
  });
  expect(first.recorded).toBe(true);
  expect(first.undo).toHaveLength(1);
  expect(contentEquals(first.undo[0], null)).toBe(true);
  expect(first.redo).toEqual([]);
  expect(first.lastRecordAt).toBe(1_000);

  const second = recordEditHistory({
    undo: first.undo,
    redo: [],
    previous: para("a"),
    next: para("ab"),
    lastRecordAt: first.lastRecordAt,
    now: 1_000 + 900, // 超出合并窗口
  });
  expect(second.recorded).toBe(true);
  expect(second.undo).toHaveLength(2);
  expect(contentEquals(second.undo[1], para("a"))).toBe(true);
});

test("持久化历史遵守总字节预算且保留各栈最新记录", () => {
  const large = (label: string) => para(`${label}:${"x".repeat(20_000)}`);
  const undo = createEmptySlotStacks();
  const redo = createEmptySlotStacks();
  undo[1] = [large("old"), large("new")];
  redo[2] = [large("redo-old"), large("redo-new")];

  const budgeted = budgetQuickNoteHistory(undo, redo, 90_000);
  const serializedBytes =
    JSON.stringify(budgeted.undoStacks).length * 2 +
    JSON.stringify(budgeted.redoStacks).length * 2;

  expect(serializedBytes).toBeLessThanOrEqual(91_000);
  expect(JSON.stringify(budgeted.undoStacks[1])).toContain("new");
  expect(JSON.stringify(budgeted.redoStacks[2])).toContain("redo-new");
});

test("recordEditHistory coalesces rapid edits", () => {
  const first = recordEditHistory({
    undo: [],
    redo: [],
    previous: null,
    next: para("a"),
    lastRecordAt: 0,
    now: 1_000,
  });
  const second = recordEditHistory({
    undo: first.undo,
    redo: [],
    previous: para("a"),
    next: para("ab"),
    lastRecordAt: first.lastRecordAt,
    now: 1_000 + 200, // 合并窗口内
  });
  expect(second.recorded).toBe(false);
  expect(second.undo).toHaveLength(1);
  expect(contentEquals(second.undo[0], null)).toBe(true);
});

test("recordEditHistory skips identical content", () => {
  const result = recordEditHistory({
    undo: [para("old")],
    redo: [para("r")],
    previous: para("same"),
    next: para("same"),
    lastRecordAt: 10,
    now: 9999,
  });
  expect(result.recorded).toBe(false);
  expect(result.undo).toHaveLength(1);
  expect(result.redo).toHaveLength(1);
  expect(result.lastRecordAt).toBe(10);
});

test("applyUndo and applyRedo round-trip", () => {
  let undo = [null, para("one")] as Array<JSONContent | null>;
  let redo: Array<JSONContent | null> = [];
  let current: JSONContent | null = para("two");

  const u1 = applyUndo({ undo, redo, current });
  expect(u1.applied).toBe(true);
  expect(contentEquals(u1.content, para("one"))).toBe(true);
  undo = u1.undo;
  redo = u1.redo;
  current = u1.content;

  const u2 = applyUndo({ undo, redo, current });
  expect(u2.applied).toBe(true);
  expect(contentEquals(u2.content, null)).toBe(true);
  undo = u2.undo;
  redo = u2.redo;
  current = u2.content;

  expect(applyUndo({ undo, redo, current }).applied).toBe(false);

  const r1 = applyRedo({ undo, redo, current });
  expect(r1.applied).toBe(true);
  expect(contentEquals(r1.content, para("one"))).toBe(true);
  undo = r1.undo;
  redo = r1.redo;
  current = r1.content;

  const r2 = applyRedo({ undo, redo, current });
  expect(r2.applied).toBe(true);
  expect(contentEquals(r2.content, para("two"))).toBe(true);
  expect(applyRedo({ undo: r2.undo, redo: r2.redo, current: r2.content }).applied).toBe(
    false,
  );
});

test("normalizeSlotStacks clamps and sanitizes", () => {
  const huge = Array.from({ length: QUICKNOTE_UNDO_MAX + 5 }, (_, i) =>
    para(`v${i}`),
  );
  const normalized = normalizeSlotStacks({
    1: huge,
    2: "bad",
    3: [null, para("ok"), 42, "x"],
  });
  expect(normalized[1]).toHaveLength(QUICKNOTE_UNDO_MAX);
  expect(contentEquals(normalized[1][0], para("v5"))).toBe(true);
  expect(normalized[2]).toEqual([]);
  expect(normalized[3]).toHaveLength(2);
  expect(contentEquals(normalized[3][0], null)).toBe(true);
  expect(contentEquals(normalized[3][1], para("ok"))).toBe(true);
  expect(createEmptySlotStacks()[4]).toEqual([]);
});
