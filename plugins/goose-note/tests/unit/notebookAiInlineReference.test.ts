import { expect, test } from "playwright/test";
import { readFileSync } from "node:fs";
import { navigateNotebookAiReference } from "../../src/lib/notebook-ai/navigateReference";

const messageSource = readFileSync(
  "src/pages/workspace/components/notebook-ai/ChatMessages.tsx",
  "utf8",
);

test("聊天记录不再渲染块级引用卡，行内 @ 可点并 navigate", () => {
  expect(messageSource).not.toContain("ContextCards");
  expect(messageSource).not.toContain("contextCards");
  expect(messageSource).toContain("data-ai-mention-chip");
  expect(messageSource).toContain("navigateNotebookAiReference");
  expect(messageSource).toContain("onOpenPage");
  expect(messageSource).toContain("segment.reference.pageId");
});

test("navigateNotebookAiReference：有效 pageId 会调用 openPage", () => {
  const opened: string[] = [];
  expect(navigateNotebookAiReference("page-1", (id) => opened.push(id))).toBe(
    true,
  );
  expect(opened).toEqual(["page-1"]);
});

test("navigateNotebookAiReference：空 id 不导航", () => {
  const opened: string[] = [];
  const openPage = (id: string) => opened.push(id);
  expect(navigateNotebookAiReference("", openPage)).toBe(false);
  expect(navigateNotebookAiReference("   ", openPage)).toBe(false);
  expect(navigateNotebookAiReference(undefined, openPage)).toBe(false);
  expect(opened).toEqual([]);
});

test("行内 mention chip 与文字垂直居中且左右留缝", () => {
  const mentionIdx = messageSource.indexOf("data-ai-mention-chip");
  expect(mentionIdx).toBeGreaterThan(-1);
  const window = messageSource.slice(mentionIdx, mentionIdx + 500);
  expect(window).toContain("inline-flex");
  expect(window).toContain("items-center");
  expect(window).toContain("align-middle");
  expect(window).toContain("mx-1");
});
