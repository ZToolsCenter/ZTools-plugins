import { expect, test } from "@playwright/test";
import {
  isInlineCodeBacktickKeyEvent,
  shouldToggleInlineCodeOnBacktick,
} from "../../src/components/editor/extensions/inlineCodeBacktickWrapExtension";

test("识别裸反引号键，忽略修饰键、~ 与 IME 组合态", () => {
  expect(isInlineCodeBacktickKeyEvent({ key: "`", code: "Backquote" })).toBe(
    true,
  );
  expect(
    isInlineCodeBacktickKeyEvent({ key: "", code: "Backquote" } as any),
  ).toBe(true);
  expect(
    isInlineCodeBacktickKeyEvent({
      key: "Unidentified",
      code: "Backquote",
    } as any),
  ).toBe(true);
  expect(
    isInlineCodeBacktickKeyEvent({ key: "", keyCode: 192 } as any),
  ).toBe(true);
  // Shift+Backquote 产出 ~ 时不应 wrap
  expect(
    isInlineCodeBacktickKeyEvent({ key: "~", code: "Backquote" } as any),
  ).toBe(false);
  expect(
    isInlineCodeBacktickKeyEvent({
      key: "`",
      code: "Backquote",
      metaKey: true,
    } as any),
  ).toBe(false);
  expect(
    isInlineCodeBacktickKeyEvent({
      key: "`",
      code: "Backquote",
      ctrlKey: true,
    } as any),
  ).toBe(false);
  expect(
    isInlineCodeBacktickKeyEvent({
      key: "`",
      code: "Backquote",
      altKey: true,
    } as any),
  ).toBe(false);
  expect(
    isInlineCodeBacktickKeyEvent({
      key: "`",
      code: "Backquote",
      isComposing: true,
    } as any),
  ).toBe(false);
  expect(
    isInlineCodeBacktickKeyEvent({
      key: "`",
      code: "Backquote",
      keyCode: 229,
    } as any),
  ).toBe(false);
  expect(
    isInlineCodeBacktickKeyEvent({
      key: "`",
      code: "Backquote",
      repeat: true,
    } as any),
  ).toBe(false);
  expect(isInlineCodeBacktickKeyEvent({ key: "e", code: "KeyE" })).toBe(false);
});

test("空选区或不带 code mark 的 schema 不应触发 toggle", () => {
  const emptyState = {
    selection: { empty: true, $from: { depth: 0 }, $to: { depth: 0 } },
    schema: { marks: { code: {} } },
    doc: { nodesBetween: () => {} },
  } as any;

  expect(
    shouldToggleInlineCodeOnBacktick(emptyState, {
      key: "`",
      code: "Backquote",
    }),
  ).toBe(false);

  const noCodeMarkState = {
    selection: {
      empty: false,
      from: 1,
      to: 4,
      $from: {
        depth: 2,
        node: (d: number) =>
          d === 1 ? { type: { name: "blockContainer" } } : { type: { name: "paragraph" } },
      },
      $to: {
        depth: 2,
        node: (d: number) =>
          d === 1 ? { type: { name: "blockContainer" } } : { type: { name: "paragraph" } },
      },
    },
    schema: { marks: {} },
    doc: {
      nodesBetween: () => {},
      resolve: () => emptyState.selection.$from,
    },
  } as any;

  expect(
    shouldToggleInlineCodeOnBacktick(noCodeMarkState, {
      key: "`",
      code: "Backquote",
    }),
  ).toBe(false);
});

test("paragraph 非空选区 + 反引号应允许 toggle", () => {
  const $pos = {
    depth: 2,
    node(d: number) {
      if (d === 1) return { type: { name: "blockContainer" } };
      if (d === 2) return { type: { name: "paragraph" } };
      return { type: { name: "doc" } };
    },
  };
  const state = {
    selection: { empty: false, from: 1, to: 5, $from: $pos, $to: $pos },
    schema: { marks: { code: { name: "code" } } },
    doc: {
      nodesBetween(
        _from: number,
        _to: number,
        f: (node: any, pos: number) => boolean | void,
      ) {
        f({ isText: true, nodeSize: 4 }, 1);
      },
      resolve: () => $pos,
    },
  } as any;

  expect(
    shouldToggleInlineCodeOnBacktick(state, { key: "`", code: "Backquote" }),
  ).toBe(true);
});

test("heading / codeBlock 内选区拒绝反引号 wrap", () => {
  const makeState = (contentType: string) => {
    const $pos = {
      depth: 2,
      node(d: number) {
        if (d === 1) return { type: { name: "blockContainer" } };
        if (d === 2) return { type: { name: contentType } };
        return { type: { name: "doc" } };
      },
    };
    return {
      selection: { empty: false, from: 1, to: 5, $from: $pos, $to: $pos },
      schema: { marks: { code: { name: "code" } } },
      doc: {
        nodesBetween() {},
        resolve: () => $pos,
      },
    } as any;
  };

  expect(
    shouldToggleInlineCodeOnBacktick(makeState("heading"), {
      key: "`",
      code: "Backquote",
    }),
  ).toBe(false);
  expect(
    shouldToggleInlineCodeOnBacktick(makeState("codeBlock"), {
      key: "`",
      code: "Backquote",
    }),
  ).toBe(false);
});

test("view 处于 composing 时不接管", () => {
  const $pos = {
    depth: 2,
    node(d: number) {
      if (d === 1) return { type: { name: "blockContainer" } };
      if (d === 2) return { type: { name: "paragraph" } };
      return { type: { name: "doc" } };
    },
  };
  const state = {
    selection: { empty: false, from: 1, to: 5, $from: $pos, $to: $pos },
    schema: { marks: { code: { name: "code" } } },
    doc: {
      nodesBetween() {},
      resolve: () => $pos,
    },
  } as any;

  expect(
    shouldToggleInlineCodeOnBacktick(
      state,
      { key: "`", code: "Backquote" },
      { viewComposing: true },
    ),
  ).toBe(false);
});
