import { expect, test } from "playwright/test";
import {
  findPseudoStructureMarkers,
  normalizeGeneratedStructureMarkdown,
  resolveGeneratedBlockStructureExpectation,
  validateGeneratedBlockStructure,
  type BlockTypeTransformBlock,
} from "../../src/lib/ai-write";

test("只识别动作后紧邻的明确主结构目标", () => {
  expect(resolveGeneratedBlockStructureExpectation("生成一个无序列表")).toEqual(
    { blockType: "bulletListItem" },
  );
  expect(resolveGeneratedBlockStructureExpectation("创建一份有序列表")).toEqual(
    { blockType: "numberedListItem" },
  );
  expect(resolveGeneratedBlockStructureExpectation("列出三个待办事项")).toEqual(
    { blockType: "checkListItem" },
  );
  expect(resolveGeneratedBlockStructureExpectation("写成二级标题")).toEqual({
    blockType: "heading",
    headingLevel: 2,
  });
  expect(resolveGeneratedBlockStructureExpectation("整理为引用块")).toEqual({
    blockType: "quote",
  });
  expect(resolveGeneratedBlockStructureExpectation("生成一个标题")).toBeNull();
  expect(
    resolveGeneratedBlockStructureExpectation("生成一篇包含无序列表的文章"),
  ).toBeNull();
  expect(
    resolveGeneratedBlockStructureExpectation("写一篇文章，其中包含有序列表"),
  ).toBeNull();
  expect(
    resolveGeneratedBlockStructureExpectation("不要生成待办事项"),
  ).toBeNull();
});

test("规范化代码围栏外的无歧义伪列表标记", () => {
  const markdown = [
    "• 苹果",
    "· 香蕉",
    "1) 第一项",
    "2、第二项",
    "□ 未完成",
    "☐ 也未完成",
    "⬜ 仍未完成",
    "☑ 已完成",
    "✅ 也完成",
    "```text",
    "• 围栏内不修改",
    "1) 围栏内不修改",
    "```",
  ].join("\n");

  expect(normalizeGeneratedStructureMarkdown(markdown)).toBe(
    [
      "- 苹果",
      "- 香蕉",
      "1. 第一项",
      "2. 第二项",
      "- [ ] 未完成",
      "- [ ] 也未完成",
      "- [ ] 仍未完成",
      "- [x] 已完成",
      "- [x] 也完成",
      "```text",
      "• 围栏内不修改",
      "1) 围栏内不修改",
      "```",
    ].join("\n"),
  );
});

test("发现 paragraph 中残留的伪结构标记", () => {
  const blocks: BlockTypeTransformBlock[] = [
    { id: "real", type: "bulletListItem", content: "真实列表" },
    { id: "fake", type: "paragraph", content: "• 假列表\n普通文字" },
    { id: "fake-task", type: "paragraph", content: "□ 假待办" },
  ];

  expect(findPseudoStructureMarkers(blocks)).toEqual([
    { blockId: "fake", line: "• 假列表", lineNumber: 1 },
    { blockId: "fake-task", line: "□ 假待办", lineNumber: 1 },
  ]);
});

test("生成校验要求变更结果包含真实目标块", () => {
  const before: BlockTypeTransformBlock[] = [
    { id: "source", type: "paragraph", content: "原内容" },
  ];
  const valid: BlockTypeTransformBlock[] = [
    { id: "source", type: "paragraph", content: "原内容" },
    { id: "one", type: "numberedListItem", content: "第一项" },
    { id: "two", type: "numberedListItem", content: "第二项" },
  ];
  expect(
    validateGeneratedBlockStructure({
      beforeBlocks: before,
      afterBlocks: valid,
      expectation: { blockType: "numberedListItem" },
    }),
  ).toEqual({ ok: true, changedBlockCount: 2, matchingBlockCount: 2 });

  const fake = validateGeneratedBlockStructure({
    beforeBlocks: before,
    afterBlocks: [
      ...before,
      { id: "fake", type: "paragraph", content: "1) 第一项" },
    ],
    expectation: { blockType: "numberedListItem" },
  });
  expect(fake.ok).toBe(false);
  if (!fake.ok) expect(fake.reason).toContain("普通段落");

  const missing = validateGeneratedBlockStructure({
    beforeBlocks: before,
    afterBlocks: [{ id: "source", type: "paragraph", content: "只是改了文字" }],
    expectation: { blockType: "quote" },
  });
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.reason).toContain("真实的引用块");
});

test("标题校验包含级别，且拒绝混入其它新结构", () => {
  const before: BlockTypeTransformBlock[] = [
    { id: "source", type: "paragraph", content: "原内容" },
  ];
  const wrongLevel = validateGeneratedBlockStructure({
    beforeBlocks: before,
    afterBlocks: [
      { id: "heading", type: "heading", props: { level: 3 }, content: "标题" },
    ],
    expectation: { blockType: "heading", headingLevel: 2 },
  });
  expect(wrongLevel.ok).toBe(false);

  const mixed = validateGeneratedBlockStructure({
    beforeBlocks: before,
    afterBlocks: [
      { id: "one", type: "bulletListItem", content: "第一项" },
      { id: "two", type: "numberedListItem", content: "第二项" },
    ],
    expectation: { blockType: "bulletListItem" },
  });
  expect(mixed.ok).toBe(false);
  if (!mixed.ok) expect(mixed.reason).toContain("不一致");
});
