import { expect, test } from "playwright/test";
import type { PartialBlock } from "@blocknote/core";
import {
  ensureBodyParagraphAfterTitle,
  needsBodyParagraphAfterTitle,
} from "../../src/components/editor/utils/blocknote-content/ensureBodyParagraph";
import { createEmptyBlockNoteContent } from "../../src/components/editor/utils/blocknote-content/emptyContent";
import { normalizePageContent } from "../../src/components/editor/utils/blocknote-content/legacyMigration";

test("标题一独占时补一个空段落", () => {
  const onlyTitle: PartialBlock[] = [
    {
      type: "heading",
      props: { level: 1 },
      content: "标题",
    },
  ];
  const next = ensureBodyParagraphAfterTitle(onlyTitle);
  expect(next).toHaveLength(2);
  expect(next[0]?.type).toBe("heading");
  expect(next[1]?.type).toBe("paragraph");
});

test("已有正文不重复补", () => {
  const content = createEmptyBlockNoteContent("标题");
  const next = ensureBodyParagraphAfterTitle(content);
  expect(next).toHaveLength(2);
  expect(next).toEqual(content);
});

test("非 H1 独占不补", () => {
  const onlyH2: PartialBlock[] = [
    {
      type: "heading",
      props: { level: 2 },
      content: "小标题",
    },
  ];
  expect(ensureBodyParagraphAfterTitle(onlyH2)).toEqual(onlyH2);
});

test("needsBodyParagraphAfterTitle 只在标题一独占时为 true", () => {
  expect(
    needsBodyParagraphAfterTitle([
      { type: "heading", props: { level: 1 }, content: "t" },
    ]),
  ).toBe(true);
  expect(
    needsBodyParagraphAfterTitle([
      { type: "heading", props: { level: 1 }, content: "t" },
      { type: "paragraph", content: "" },
    ]),
  ).toBe(false);
});

test("normalizePageContent 对标题一独占会补空段落", () => {
  const normalized = normalizePageContent([
    {
      type: "heading",
      props: { level: 1 },
      content: "标题",
    },
  ]);
  expect(normalized).toHaveLength(2);
  expect(normalized[1]?.type).toBe("paragraph");
});
