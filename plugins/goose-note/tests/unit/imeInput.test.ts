import { expect, test } from "playwright/test";
import {
  isDuplicateCompositionEndChange,
  isImeKeyboardEvent,
  shouldSkipAppHotkeyEvent,
} from "../../src/hooks/useImeInput";
import {
  isComposerDeleteInputType,
  resolveComposerBeforeInputDelete,
  shouldProcessComposerInput,
} from "../../src/components/editor/ai/composer/AiComposerInput";
import { parseSlashCommandBeforeCaret } from "../../src/components/editor/ai/composer/useSkillCommands";

test("IME keyboard detection covers modern and legacy Chromium events", () => {
  expect(isImeKeyboardEvent({ isComposing: true })).toBe(true);
  expect(isImeKeyboardEvent({ keyCode: 229 })).toBe(true);
  expect(isImeKeyboardEvent({ which: 229 })).toBe(true);
  expect(isImeKeyboardEvent({ isComposing: false, keyCode: 13 })).toBe(false);
});

test("global hotkeys ignore IME and repeated actions unless navigation opts in", () => {
  expect(shouldSkipAppHotkeyEvent({ isComposing: true })).toBe(true);
  expect(shouldSkipAppHotkeyEvent({ keyCode: 229 })).toBe(true);
  expect(shouldSkipAppHotkeyEvent({ which: 229 })).toBe(true);
  expect(shouldSkipAppHotkeyEvent({ repeat: true })).toBe(true);
  expect(shouldSkipAppHotkeyEvent({ repeat: true }, true)).toBe(false);
  expect(shouldSkipAppHotkeyEvent({ repeat: false })).toBe(false);
});

test("the duplicate change after compositionend is ignored only for the same value", () => {
  expect(isDuplicateCompositionEndChange("阿斯加德", "阿斯加德")).toBe(true);
  expect(isDuplicateCompositionEndChange("阿斯加德", "阿斯加德快乐")).toBe(
    false,
  );
  expect(isDuplicateCompositionEndChange(null, "阿斯加德")).toBe(false);
});

test("AI composer skips store sync while IME composition is active", () => {
  expect(
    shouldProcessComposerInput({
      isComposingFlag: true,
      inputEventIsComposing: false,
    }),
  ).toBe(false);
  expect(
    shouldProcessComposerInput({
      isComposingFlag: false,
      inputEventIsComposing: true,
    }),
  ).toBe(false);
  // 微信输入法：常无 composition 事件，仅靠 229 会话锁
  expect(
    shouldProcessComposerInput({
      isComposingFlag: false,
      imeSessionActive: true,
      inputEventIsComposing: false,
    }),
  ).toBe(false);
  expect(
    shouldProcessComposerInput({
      isComposingFlag: false,
      imeSessionActive: false,
      inputEventIsComposing: false,
    }),
  ).toBe(true);
});

test("bulk delete input types are detected for longer debounce", () => {
  expect(isComposerDeleteInputType("deleteContentBackward")).toBe(true);
  expect(isComposerDeleteInputType("deleteByCut")).toBe(true);
  expect(isComposerDeleteInputType("deleteSoftLineBackward")).toBe(true);
  expect(isComposerDeleteInputType("historyUndo")).toBe(true);
  expect(isComposerDeleteInputType("insertText")).toBe(false);
  expect(isComposerDeleteInputType(undefined)).toBe(false);
});

test("beforeinput delete: IME session never intercepts chip deletes", () => {
  expect(
    resolveComposerBeforeInputDelete({
      inputType: "deleteContentBackward",
      imeActive: true,
      hasChips: true,
      selectionCoversEntire: true,
      rangeCollapsed: false,
      rangeContainsChip: true,
      chipBeforeCaret: true,
      chipAfterCaret: false,
    }),
  ).toBe("ignore");
});

test("beforeinput delete: full selection with chips clears editor", () => {
  expect(
    resolveComposerBeforeInputDelete({
      inputType: "deleteByCut",
      imeActive: false,
      hasChips: true,
      selectionCoversEntire: true,
      rangeCollapsed: false,
      rangeContainsChip: true,
      chipBeforeCaret: false,
      chipAfterCaret: false,
    }),
  ).toBe("clear-editor");
  expect(
    resolveComposerBeforeInputDelete({
      inputType: "deleteContentBackward",
      imeActive: false,
      hasChips: true,
      selectionCoversEntire: true,
      rangeCollapsed: false,
      rangeContainsChip: true,
      chipBeforeCaret: false,
      chipAfterCaret: false,
    }),
  ).toBe("clear-editor");
});

test("beforeinput delete: non-collapsed range containing chip", () => {
  expect(
    resolveComposerBeforeInputDelete({
      inputType: "deleteContentBackward",
      imeActive: false,
      hasChips: true,
      selectionCoversEntire: false,
      rangeCollapsed: false,
      rangeContainsChip: true,
      chipBeforeCaret: false,
      chipAfterCaret: false,
    }),
  ).toBe("delete-selection-chips");
  expect(
    resolveComposerBeforeInputDelete({
      inputType: "deleteContentBackward",
      imeActive: false,
      hasChips: true,
      selectionCoversEntire: false,
      rangeCollapsed: false,
      rangeContainsChip: false,
      chipBeforeCaret: false,
      chipAfterCaret: false,
    }),
  ).toBe("ignore");
});

test("beforeinput delete: collapsed caret at chip boundary", () => {
  expect(
    resolveComposerBeforeInputDelete({
      inputType: "deleteContentBackward",
      imeActive: false,
      hasChips: true,
      selectionCoversEntire: false,
      rangeCollapsed: true,
      rangeContainsChip: false,
      chipBeforeCaret: true,
      chipAfterCaret: false,
    }),
  ).toBe("remove-chip-before");
  expect(
    resolveComposerBeforeInputDelete({
      inputType: "deleteContentForward",
      imeActive: false,
      hasChips: true,
      selectionCoversEntire: false,
      rangeCollapsed: true,
      rangeContainsChip: false,
      chipBeforeCaret: false,
      chipAfterCaret: true,
    }),
  ).toBe("remove-chip-after");
  expect(
    resolveComposerBeforeInputDelete({
      inputType: "deleteContentBackward",
      imeActive: false,
      hasChips: true,
      selectionCoversEntire: false,
      rangeCollapsed: true,
      rangeContainsChip: false,
      chipBeforeCaret: false,
      chipAfterCaret: false,
    }),
  ).toBe("ignore");
  // 无 chip 时不拦截
  expect(
    resolveComposerBeforeInputDelete({
      inputType: "deleteContentBackward",
      imeActive: false,
      hasChips: false,
      selectionCoversEntire: true,
      rangeCollapsed: false,
      rangeContainsChip: false,
      chipBeforeCaret: false,
      chipAfterCaret: false,
    }),
  ).toBe("ignore");
});

test("slash command parse allows / after whitespace at any position (like @)", () => {
  expect(parseSlashCommandBeforeCaret("/")).toEqual({
    query: "",
    slashIndex: 0,
  });
  expect(parseSlashCommandBeforeCaret("/foo")).toEqual({
    query: "foo",
    slashIndex: 0,
  });
  expect(parseSlashCommandBeforeCaret("  /bar")).toEqual({
    query: "bar",
    slashIndex: 2,
  });
  expect(parseSlashCommandBeforeCaret("hello /baz")).toEqual({
    query: "baz",
    slashIndex: 6,
  });
  expect(parseSlashCommandBeforeCaret("x/foo")).toBe(null);
  expect(parseSlashCommandBeforeCaret("/foo bar")).toBe(null);
  expect(parseSlashCommandBeforeCaret("hello")).toBe(null);
});
