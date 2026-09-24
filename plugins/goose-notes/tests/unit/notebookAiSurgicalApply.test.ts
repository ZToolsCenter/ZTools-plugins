import { expect, test } from "playwright/test";
import {
  applySearchReplacePreservingBlocks,
  mergeFullEditPreservingUnchangedBlocks,
} from "../../src/lib/notebook-ai/batch-plan/surgicalApply";
import { jsonContentToMarkdown } from "../../src/lib/export/markdown/serialize";

function textBlock(id: string, text: string) {
  return {
    id,
    type: "paragraph" as const,
    content: [{ type: "text" as const, text }],
  };
}

function headingBlock(id: string, level: number, text: string) {
  return {
    id,
    type: "heading" as const,
    props: { level },
    content: [{ type: "text" as const, text }],
  };
}

function asBlocks(content: unknown): Array<Record<string, any>> {
  if (Array.isArray(content)) return content as Array<Record<string, any>>;
  if (
    content &&
    typeof content === "object" &&
    Array.isArray((content as { content?: unknown }).content)
  ) {
    return (content as { content: Array<Record<string, any>> }).content;
  }
  return [];
}

function plainText(block: Record<string, any> | undefined): string {
  if (!block) return "";
  const c = block.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c
    .map((item) => {
      if (typeof item === "string") return item;
      return item?.text ?? "";
    })
    .join("");
}

test("search_replace 保留未改动块的 id", () => {
  const content = [
    textBlock("id-first", "one"),
    textBlock("id-middle", "two"),
    textBlock("id-third", "three"),
  ];

  const result = applySearchReplacePreservingBlocks(content, "two", "TWO");

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const blocks = asBlocks(result.content);
  expect(blocks).toHaveLength(3);
  expect(blocks[0]?.id).toBe("id-first");
  expect(blocks[2]?.id).toBe("id-third");
  expect(plainText(blocks[0])).toBe("one");
  expect(plainText(blocks[2])).toBe("three");
  expect(plainText(blocks[1])).toBe("TWO");
  expect(result.replacedCount).toBe(1);
});

test("search_replace 仅替换指定 heading 段落，第三周标题 id/文本保留", () => {
  const content = [
    headingBlock("h-week2", 2, "第二周"),
    textBlock("p-week2", "第二周正文"),
    headingBlock("h-week3", 2, "第三周"),
    textBlock("p-week3", "第三周正文"),
  ];

  const result = applySearchReplacePreservingBlocks(
    content,
    "第二周正文",
    "第二周已更新",
  );

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const blocks = asBlocks(result.content);
  const week3Heading = blocks.find(
    (b) => b.id === "h-week3" || plainText(b) === "第三周",
  );
  expect(week3Heading).toBeTruthy();
  expect(week3Heading?.id).toBe("h-week3");
  expect(week3Heading?.type).toBe("heading");
  expect(plainText(week3Heading)).toBe("第三周");

  expect(jsonContentToMarkdown(result.content as any)).toContain("第二周已更新");
  expect(jsonContentToMarkdown(result.content as any)).toContain("第三周");
  expect(jsonContentToMarkdown(result.content as any)).not.toContain(
    "第二周正文",
  );
});

test("search_replace replaceAll 替换全部相同段落", () => {
  const content = [textBlock("a", "foo"), textBlock("b", "foo")];

  const result = applySearchReplacePreservingBlocks(content, "foo", "bar", {
    replaceAll: true,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const blocks = asBlocks(result.content);
  expect(blocks).toHaveLength(2);
  expect(plainText(blocks[0])).toBe("bar");
  expect(plainText(blocks[1])).toBe("bar");
  expect(result.replacedCount).toBe(2);
});

test("search_replace 未找到匹配时返回 ok:false", () => {
  const content = [
    textBlock("a", "alpha"),
    textBlock("b", "beta"),
  ];

  const result = applySearchReplacePreservingBlocks(
    content,
    "不存在的片段",
    "replacement",
  );

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toMatch(/未找到|匹配/);
});

test("mergeFullEditPreservingUnchangedBlocks 保留公共前缀/后缀块 id", () => {
  const before = [
    textBlock("p1", "line one"),
    textBlock("p2", "line two"),
    textBlock("p3", "line middle"),
    textBlock("p4", "line four"),
    textBlock("p5", "line five"),
  ];
  const newMarkdown = [
    "line one",
    "line two",
    "line middle changed",
    "line four",
    "line five",
  ].join("\n\n");

  const result = mergeFullEditPreservingUnchangedBlocks(before, newMarkdown, {
    ensureFirstTitle: false,
  });

  const blocks = asBlocks(result.content);
  expect(result.preservedBlockCount).toBeGreaterThanOrEqual(2);
  expect(blocks[0]?.id).toBe("p1");
  expect(blocks[1]?.id).toBe("p2");
  expect(blocks[blocks.length - 2]?.id).toBe("p4");
  expect(blocks[blocks.length - 1]?.id).toBe("p5");
  expect(plainText(blocks[2])).toContain("middle changed");
});

test("mergeFullEdit 中间重写保留后续周标题/正文 id（非仅后缀）", () => {
  const before = [
    headingBlock("h2", 2, "第二周"),
    textBlock("p2", "旧正文"),
    headingBlock("h3", 2, "第三周"),
    textBlock("p3", "第三周正文"),
    headingBlock("h4", 2, "第四周"),
  ];
  const newMarkdown = [
    "## 第二周",
    "新正文",
    "## 第三周",
    "第三周正文",
    "## 第四周",
  ].join("\n\n");

  const result = mergeFullEditPreservingUnchangedBlocks(before, newMarkdown, {
    ensureFirstTitle: false,
  });

  const blocks = asBlocks(result.content);
  const week3Heading = blocks.find(
    (b) => b.id === "h3" || plainText(b) === "第三周",
  );
  expect(week3Heading).toBeTruthy();
  expect(week3Heading?.id).toBe("h3");
  expect(week3Heading?.type).toBe("heading");
  expect(plainText(week3Heading)).toBe("第三周");

  const week3Body = blocks.find(
    (b) => b.id === "p3" || plainText(b) === "第三周正文",
  );
  expect(week3Body).toBeTruthy();
  expect(week3Body?.id).toBe("p3");

  const week4Heading = blocks.find(
    (b) => b.id === "h4" || plainText(b) === "第四周",
  );
  expect(week4Heading).toBeTruthy();
  expect(week4Heading?.id).toBe("h4");
  expect(week4Heading?.type).toBe("heading");

  const md = jsonContentToMarkdown(result.content as any);
  expect(md).toContain("新正文");
  expect(md).not.toContain("旧正文");
  expect(md).toContain("第三周");
  expect(md).toContain("第四周");
});
