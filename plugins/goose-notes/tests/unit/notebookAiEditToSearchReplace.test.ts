import { expect, test } from "playwright/test";
import { tryConvertEditToSearchReplace } from "../../src/lib/notebook-ai/batch-plan/editToSearchReplace";

test("局部中间改写转为 search_replace，oldString 含第二周正文", () => {
  const original = [
    "## 第二周",
    "第二周旧正文",
    "## 第三周",
    "第三周正文",
    "## 第四周",
  ].join("\n\n");
  const next = [
    "## 第二周",
    "第二周新正文",
    "## 第三周",
    "第三周正文",
    "## 第四周",
  ].join("\n\n");

  const ops = tryConvertEditToSearchReplace({
    pageId: "page-1",
    oldMarkdown: original,
    newMarkdown: next,
    baseOperationId: "edit-week",
  });
  expect(ops).not.toBeNull();
  expect(ops!.length).toBeGreaterThanOrEqual(1);
  const primary = ops![0]!;
  expect(primary.type).toBe("search_replace");
  expect(primary.oldString).toContain("第二周旧正文");
  expect(primary.newString).toContain("第二周新正文");
  expect(primary.oldString).not.toContain("第三周正文");
});

test("近乎整页重写返回 null", () => {
  const original = [
    "## 一",
    "正文甲",
    "## 二",
    "正文乙",
    "## 三",
    "正文丙",
  ].join("\n\n");
  const next = [
    "## 全新标题一",
    "全新内容 A",
    "## 全新标题二",
    "全新内容 B",
    "## 全新标题三",
    "全新内容 C",
  ].join("\n\n");

  expect(
    tryConvertEditToSearchReplace({
      pageId: "page-1",
      oldMarkdown: original,
      newMarkdown: next,
      baseOperationId: "edit-full",
    }),
  ).toBeNull();
});

test("空原文返回 null", () => {
  expect(
    tryConvertEditToSearchReplace({
      pageId: "page-1",
      oldMarkdown: "",
      newMarkdown: "## 标题\n\n正文",
      baseOperationId: "edit-empty",
    }),
  ).toBeNull();
  expect(
    tryConvertEditToSearchReplace({
      pageId: "page-1",
      oldMarkdown: "   \n\n  ",
      newMarkdown: "正文",
      baseOperationId: "edit-blank",
    }),
  ).toBeNull();
});

test("oldString 在原文中不唯一时返回 null", () => {
  const original = ["段落 X", "重复句", "中间", "重复句", "尾"].join("\n\n");
  // 仅改两处「重复句」中的语义会形成 oldString=重复句 的 hunk，但不唯一
  const next = ["段落 X", "已改", "中间", "已改", "尾"].join("\n\n");
  // 两个独立 hunk 各 oldString=重复句，均不唯一
  expect(
    tryConvertEditToSearchReplace({
      pageId: "page-1",
      oldMarkdown: original,
      newMarkdown: next,
      baseOperationId: "edit-dup",
    }),
  ).toBeNull();
});
