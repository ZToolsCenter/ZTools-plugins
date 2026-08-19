import { expect, test } from "@playwright/test";
import {
  adjacentInlineCodeTextIndex,
  edgeGraphemeLength,
  heldInlineCodeBoundaryArrowAction,
  inlineCodeEndRightArrowAction,
  isSingleGrapheme,
  isTwoGraphemes,
  pickInlineCodeChipIndexForEndClick,
  preferOutsideInlineCodeEndClick,
  resolveHeldInlineCodeBoundary,
  resolveMouseupInlineCodePos,
  shouldForceCaretOutsideInlineCodeEnd,
} from "../../src/components/editor/extensions/inlineCodeBoundaryNavigationExtension";

test("只在左移一步即可到达行内代码起点时接管光标", () => {
  expect(isSingleGrapheme("1")).toBe(true);
  expect(isSingleGrapheme("中")).toBe(true);
  expect(isSingleGrapheme("😀")).toBe(true);
  expect(isSingleGrapheme("12")).toBe(false);
  expect(isSingleGrapheme("")).toBe(false);
});

test("识别首字符前一步的预备位置", () => {
  expect(isTwoGraphemes("py")).toBe(true);
  expect(isTwoGraphemes("中😀")).toBe(true);
  expect(isTwoGraphemes("p")).toBe(false);
  expect(isTwoGraphemes("pyt")).toBe(false);
});

test("从左右边界返回代码内时按完整字素移动", () => {
  expect(edgeGraphemeLength("Agent", "start")).toBe(1);
  expect(edgeGraphemeLength("Agent", "end")).toBe(1);
  expect(edgeGraphemeLength("😀Agent🚀", "start")).toBe(2);
  expect(edgeGraphemeLength("😀Agent🚀", "end")).toBe(2);
});

test("行内代码边界保持精确的两步方向键语义", () => {
  expect(heldInlineCodeBoundaryArrowAction("end", "inside", "right")).toBe(
    "to-outside",
  );
  expect(heldInlineCodeBoundaryArrowAction("end", "outside", "right")).toBe(
    "advance",
  );
  expect(heldInlineCodeBoundaryArrowAction("end", "outside", "left")).toBe(
    "to-inside",
  );
  expect(heldInlineCodeBoundaryArrowAction("end", "inside", "left")).toBe(
    "enter",
  );
  expect(heldInlineCodeBoundaryArrowAction("start", "inside", "left")).toBe(
    "exit",
  );
  expect(heldInlineCodeBoundaryArrowAction("start", "inside", "right")).toBe(
    "enter",
  );
});

test("end+outside+right 必须 advance，不依赖 visual caret 存活", () => {
  // held 两阶段：inside → outside → advance
  expect(
    inlineCodeEndRightArrowAction({
      heldPhase: "inside",
      domAtCodeEnd: true,
      atCodePlainBoundary: false,
    }),
  ).toBe("to-outside");

  // held inside 但 DOM 被旧内核重映射走，仍应 to-outside
  expect(
    inlineCodeEndRightArrowAction({
      heldPhase: "inside",
      domAtCodeEnd: false,
      atCodePlainBoundary: false,
    }),
  ).toBe("to-outside");

  expect(
    inlineCodeEndRightArrowAction({
      heldPhase: "outside",
      domAtCodeEnd: false,
      atCodePlainBoundary: true,
    }),
  ).toBe("advance");

  // held 丢失但仍在 DOM 末端：第一次右键仍应 to-outside
  expect(
    inlineCodeEndRightArrowAction({
      heldPhase: null,
      domAtCodeEnd: true,
      atCodePlainBoundary: false,
    }),
  ).toBe("to-outside");

  // held 丢失且已在 code|plain 边界外侧：直接 advance（修 sticky）
  expect(
    inlineCodeEndRightArrowAction({
      heldPhase: null,
      domAtCodeEnd: false,
      atCodePlainBoundary: true,
    }),
  ).toBe("advance");

  // outside 优先于「DOM 被映回末端」的假象
  expect(
    inlineCodeEndRightArrowAction({
      heldPhase: "outside",
      domAtCodeEnd: true,
      atCodePlainBoundary: true,
    }),
  ).toBe("advance");

  // 与边界无关时不接管
  expect(
    inlineCodeEndRightArrowAction({
      heldPhase: null,
      domAtCodeEnd: false,
      atCodePlainBoundary: false,
    }),
  ).toBeNull();
});

test("点击 code 结束与后续 plain 的文档边界时偏向外侧", () => {
  // 1`2`3 中 code 与 3 之间
  expect(
    preferOutsideInlineCodeEndClick({
      nodeBeforeHasCode: true,
      nodeAfterHasCode: false,
      nodeAfterIsText: true,
    }),
  ).toBe(true);

  // code 内部（后续仍是 code 文本）
  expect(
    preferOutsideInlineCodeEndClick({
      nodeBeforeHasCode: true,
      nodeAfterHasCode: true,
      nodeAfterIsText: true,
    }),
  ).toBe(false);

  // 左边界：前无 code、后有 code —— 不处理，避免破坏点入
  expect(
    preferOutsideInlineCodeEndClick({
      nodeBeforeHasCode: false,
      nodeAfterHasCode: true,
      nodeAfterIsText: true,
    }),
  ).toBe(false);

  // 块末尾无后续 plain
  expect(
    preferOutsideInlineCodeEndClick({
      nodeBeforeHasCode: true,
      nodeAfterHasCode: false,
      nodeAfterIsText: false,
    }),
  ).toBe(false);
});

test("旧内核重映射文档位置后仍可通过真实 DOM 末端退出 code", () => {
  expect(
    resolveHeldInlineCodeBoundary(
      { edge: "end", phase: "inside", pos: 12 },
      "end",
      "inside",
      "end",
      13,
    ),
  ).toEqual({ edge: "end", phase: "inside", pos: 12 });

  expect(
    resolveHeldInlineCodeBoundary(null, "end", "inside", "end", 13),
  ).toEqual({ edge: "end", phase: "inside", pos: 13 });

  expect(
    resolveHeldInlineCodeBoundary(
      { edge: "end", phase: "inside", pos: 12 },
      "end",
      "inside",
      "start",
      13,
    ),
  ).toBeNull();
});

test("退出 code 时落到相邻正文，不越过首字符", () => {
  expect(adjacentInlineCodeTextIndex([1], 3, "after")).toBe(2);
  expect(adjacentInlineCodeTextIndex([1], 3, "before")).toBe(0);
  expect(adjacentInlineCodeTextIndex([0], 1, "after")).toBeNull();
  expect(adjacentInlineCodeTextIndex([0], 1, "before")).toBeNull();
});

test("mouseup 优先用点击坐标 pos，避免用按下前的旧选区", () => {
  expect(resolveMouseupInlineCodePos(12, 40)).toBe(40);
  expect(resolveMouseupInlineCodePos(12, null)).toBe(12);
  expect(resolveMouseupInlineCodePos(12, undefined)).toBe(12);
});

test("松手被映回 code 末端且点击在内容右缘外时钉到外侧", () => {
  // (`server`)：点在芯片后、`)` 前
  expect(
    shouldForceCaretOutsideInlineCodeEnd({
      atCodePlainBoundary: false,
      domAtCodeEnd: true,
      clientX: 180,
      contentRight: 170,
      codeRight: 176,
    }),
  ).toBe(true);

  // 点在末字符「r」上：仍允许进 code
  expect(
    shouldForceCaretOutsideInlineCodeEnd({
      atCodePlainBoundary: false,
      domAtCodeEnd: true,
      clientX: 165,
      contentRight: 170,
      codeRight: 176,
    }),
  ).toBe(false);

  // 文档已在 code|plain 边界：无需再看坐标
  expect(
    shouldForceCaretOutsideInlineCodeEnd({
      atCodePlainBoundary: true,
      domAtCodeEnd: false,
      clientX: null,
      contentRight: null,
      codeRight: null,
    }),
  ).toBe(true);
});

test("一行两颗行内代码时纠正落到更近的右侧芯片", () => {
  const chips = [
    { left: 20, right: 120 }, // diteng-im-server/**
    { left: 150, right: 200 }, // server
  ];
  expect(pickInlineCodeChipIndexForEndClick(chips, 204)).toBe(1);
  expect(pickInlineCodeChipIndexForEndClick(chips, 118)).toBe(0);
  expect(pickInlineCodeChipIndexForEndClick(chips, 10)).toBeNull();
});
