import { expect, test } from "playwright/test";
import { tryConvertEditToSearchReplace } from "../../src/lib/notebook-ai/batch-plan/editToSearchReplace";

test("局部单段修改拆成一条 search_replace", () => {
  const oldMarkdown = [
    "第一段保持不变。",
    "第二段将被改写。",
    "第三段也保持不变。",
  ].join("\n\n");
  const newMarkdown = [
    "第一段保持不变。",
    "第二段已经改写完成。",
    "第三段也保持不变。",
  ].join("\n\n");

  const ops = tryConvertEditToSearchReplace({
    pageId: "p1",
    oldMarkdown,
    newMarkdown,
    baseOperationId: "edit-1",
  });

  expect(ops).not.toBeNull();
  expect(ops).toHaveLength(1);
  expect(ops![0]).toMatchObject({
    type: "search_replace",
    operationId: "edit-1-sr-1",
    pageId: "p1",
    oldString: "第二段将被改写。",
    newString: "第二段已经改写完成。",
  });
});

test("空页或整页重写返回 null", () => {
  expect(
    tryConvertEditToSearchReplace({
      pageId: "p1",
      oldMarkdown: "   ",
      newMarkdown: "全新内容",
      baseOperationId: "edit-1",
    }),
  ).toBeNull();

  const oldMarkdown = "AAA\n\nBBB\n\nCCC";
  const newMarkdown = "XXX\n\nYYY\n\nZZZ";
  expect(
    tryConvertEditToSearchReplace({
      pageId: "p1",
      oldMarkdown,
      newMarkdown,
      baseOperationId: "edit-1",
    }),
  ).toBeNull();
});

test("纯插入用相邻段落锚定", () => {
  const oldMarkdown = "开头段落足够长。\n\n结尾段落足够长。";
  const newMarkdown =
    "开头段落足够长。\n\n插入的中间段落内容。\n\n结尾段落足够长。";

  const ops = tryConvertEditToSearchReplace({
    pageId: "p1",
    oldMarkdown,
    newMarkdown,
    baseOperationId: "edit-2",
  });

  expect(ops).not.toBeNull();
  expect(ops).toHaveLength(1);
  expect(ops![0]!.oldString).toBe("开头段落足够长。");
  expect(ops![0]!.newString).toBe(
    "开头段落足够长。\n\n插入的中间段落内容。",
  );
});

test("相同正文返回 null", () => {
  const md = "同一段文字\n\n第二段";
  expect(
    tryConvertEditToSearchReplace({
      pageId: "p1",
      oldMarkdown: md,
      newMarkdown: md,
      baseOperationId: "edit-3",
    }),
  ).toBeNull();
});
