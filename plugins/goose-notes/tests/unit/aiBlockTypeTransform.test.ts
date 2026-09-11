import { expect, test } from "playwright/test";
import {
  applyBlockTypeTransformToEditor,
  createPageBodyBlockTypeTransformSnapshot,
  hasWholePageBlockTypeTransformScope,
  planBlockTypeTransform,
  resolveBlockTypeTransformIntent,
  type BlockTypeTransformBlock,
} from "../../src/lib/ai-write";

test("识别明确且单一的原生块转换意图", () => {
  expect(resolveBlockTypeTransformIntent("把这里所有内容改为待办事项")).toEqual(
    { blockType: "checkListItem" },
  );
  expect(resolveBlockTypeTransformIntent("Turn it into a todo list")).toEqual({
    blockType: "checkListItem",
  });
  expect(resolveBlockTypeTransformIntent("把这些变为待办事项")).toEqual({
    blockType: "checkListItem",
  });
  expect(resolveBlockTypeTransformIntent("把这几行改成任务")).toEqual({
    blockType: "checkListItem",
  });
  expect(resolveBlockTypeTransformIntent("处理成可勾选项")).toEqual({
    blockType: "checkListItem",
  });
  expect(resolveBlockTypeTransformIntent("change these to checkboxes")).toEqual(
    { blockType: "checkListItem" },
  );
  expect(
    resolveBlockTypeTransformIntent("不要把这些内容改成待办事项"),
  ).toBeNull();
  expect(resolveBlockTypeTransformIntent("润色并改成待办事项")).toBeNull();
  expect(resolveBlockTypeTransformIntent("给文字前面加一个方框")).toBeNull();
  expect(resolveBlockTypeTransformIntent("把任务分析改为表格")).toBeNull();
  expect(resolveBlockTypeTransformIntent("把待办事项改为普通段落")).toEqual({
    blockType: "paragraph",
  });
  expect(resolveBlockTypeTransformIntent("把这些改为一级标题")).toEqual({
    blockType: "heading",
    headingLevel: 1,
  });
  expect(resolveBlockTypeTransformIntent("把这些转成二级标题")).toEqual({
    blockType: "heading",
    headingLevel: 2,
  });
  expect(resolveBlockTypeTransformIntent("把这些变成三级标题")).toEqual({
    blockType: "heading",
    headingLevel: 3,
  });
  expect(resolveBlockTypeTransformIntent("把这些改成无序列表")).toEqual({
    blockType: "bulletListItem",
  });
  expect(resolveBlockTypeTransformIntent("把这些改成有序列表")).toEqual({
    blockType: "numberedListItem",
  });
  expect(resolveBlockTypeTransformIntent("把这些改成引用块")).toEqual({
    blockType: "quote",
  });
  expect(resolveBlockTypeTransformIntent("把这些改成代码块")).toEqual({
    blockType: "codeBlock",
  });
  expect(resolveBlockTypeTransformIntent("把这些改成标题")).toBeNull();
  expect(
    resolveBlockTypeTransformIntent("把这些改成无序列表或有序列表"),
  ).toBeNull();
  expect(resolveBlockTypeTransformIntent("把无序列表内容改成普通段落")).toEqual(
    { blockType: "paragraph" },
  );
  expect(
    hasWholePageBlockTypeTransformScope("把这里所有的内容改为待办事项"),
  ).toBe(true);
  expect(hasWholePageBlockTypeTransformScope("把整页改为待办事项")).toBe(true);
  expect(hasWholePageBlockTypeTransformScope("把整个页面变为任务")).toBe(true);
  expect(hasWholePageBlockTypeTransformScope("把全页处理成可勾选项")).toBe(
    true,
  );
  expect(hasWholePageBlockTypeTransformScope("把第二段改为待办事项")).toBe(
    false,
  );
});

test("页面正文按非空行生成多个原生 checkListItem，并保留标题", () => {
  const blocks: BlockTypeTransformBlock[] = [
    {
      id: "title",
      type: "heading",
      props: { level: 1 },
      content: "页面标题",
    },
    { id: "one", type: "paragraph", content: "第一项\n第二项" },
    { id: "empty", type: "paragraph", content: "" },
    {
      id: "three",
      type: "bulletListItem",
      props: { textAlignment: "center" },
      content: "第三项",
    },
  ];
  const snapshot = createPageBodyBlockTypeTransformSnapshot("page-1", blocks);
  const plan = planBlockTypeTransform(snapshot, blocks);

  expect(plan.sourceBlockIds).toEqual(["one", "empty", "three"]);
  expect(plan.convertedCount).toBe(3);
  expect(plan.replacementBlocks.map((block) => block.type)).toEqual([
    "checkListItem",
    "checkListItem",
    "checkListItem",
  ]);
  expect(plan.replacementBlocks.map((block) => block.content)).toEqual([
    "第一项",
    "第二项",
    "第三项",
  ]);
  expect(plan.replacementBlocks[2].props).toMatchObject({
    checked: false,
    textAlignment: "center",
  });
});

test("拆分硬换行时保留行内样式、链接与已有待办状态", () => {
  const blocks: BlockTypeTransformBlock[] = [
    {
      id: "styled",
      type: "paragraph",
      content: [
        { type: "text", text: "粗体", styles: { bold: true } },
        { type: "text", text: "\n斜体", styles: { italic: true } },
        {
          type: "link",
          href: "https://example.com",
          content: [{ type: "text", text: "链接一\n链接二", styles: {} }],
        },
      ],
    },
    {
      id: "checked",
      type: "checkListItem",
      props: { checked: true },
      content: "已完成",
    },
  ];
  const snapshot = createPageBodyBlockTypeTransformSnapshot("page-1", blocks, {
    protectFirstTitle: false,
  });
  const plan = planBlockTypeTransform(snapshot, blocks);

  expect(plan.convertedCount).toBe(4);
  expect(plan.replacementBlocks[0].content).toEqual([
    { type: "text", text: "粗体", styles: { bold: true } },
  ]);
  expect(plan.replacementBlocks[1].content).toEqual([
    { type: "text", text: "斜体", styles: { italic: true } },
    {
      type: "link",
      href: "https://example.com",
      content: [{ type: "text", text: "链接一", styles: {} }],
    },
  ]);
  expect(plan.replacementBlocks[2].content).toEqual([
    {
      type: "link",
      href: "https://example.com",
      content: [{ type: "text", text: "链接二", styles: {} }],
    },
  ]);
  expect(plan.replacementBlocks[3].props).toMatchObject({ checked: true });
});

test("三种列表按硬换行拆块，普通块类型按源块一对一", () => {
  const blocks: BlockTypeTransformBlock[] = [
    {
      id: "one",
      type: "paragraph",
      props: {
        textAlignment: "center",
        textColor: "red",
        backgroundColor: "blue",
      },
      content: "第一行\n第二行",
    },
  ];
  const snapshot = createPageBodyBlockTypeTransformSnapshot("page-1", blocks, {
    protectFirstTitle: false,
  });

  for (const blockType of [
    "bulletListItem",
    "numberedListItem",
    "checkListItem",
  ] as const) {
    const plan = planBlockTypeTransform(snapshot, blocks, { blockType });
    expect(plan.convertedCount).toBe(2);
    expect(plan.replacementBlocks.map((block) => block.type)).toEqual([
      blockType,
      blockType,
    ]);
  }

  const headingPlan = planBlockTypeTransform(snapshot, blocks, {
    blockType: "heading",
    headingLevel: 2,
  });
  expect(headingPlan.convertedCount).toBe(1);
  expect(headingPlan.replacementBlocks[0]).toMatchObject({
    type: "heading",
    props: {
      level: 2,
      textAlignment: "center",
      textColor: "red",
      backgroundColor: "blue",
    },
    content: "第一行\n第二行",
  });
});

test("代码块展平为纯文本且不自行指定语言", () => {
  const blocks: BlockTypeTransformBlock[] = [
    {
      id: "styled",
      type: "paragraph",
      content: [
        { type: "text", text: "const ", styles: { bold: true } },
        {
          type: "link",
          href: "https://example.com",
          content: [{ type: "text", text: "value", styles: {} }],
        },
      ],
    },
  ];
  const snapshot = createPageBodyBlockTypeTransformSnapshot("page-1", blocks, {
    protectFirstTitle: false,
  });
  const plan = planBlockTypeTransform(snapshot, blocks, {
    blockType: "codeBlock",
  });

  expect(plan.replacementBlocks[0]).toEqual({
    type: "codeBlock",
    props: {},
    content: "const value",
  });
  expect(plan.replacementBlocks[0].props).not.toHaveProperty("language");
});

test("标题目标必须带合法级别，并保护内部页面首个 H1", () => {
  const blocks: BlockTypeTransformBlock[] = [
    { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
    { id: "body", type: "paragraph", content: "正文" },
  ];
  const snapshot = createPageBodyBlockTypeTransformSnapshot("page-1", blocks);

  expect(() =>
    planBlockTypeTransform(snapshot, blocks, { blockType: "heading" }),
  ).toThrow(/必须明确指定/);
  expect(snapshot.blocks.map((block) => block.id)).toEqual(["body"]);
});

test("选区不完整或目标内容变化时拒绝转换", () => {
  const blocks: BlockTypeTransformBlock[] = [
    { id: "one", type: "paragraph", content: "第一项" },
    { id: "two", type: "paragraph", content: "第二项" },
  ];
  const snapshot = createPageBodyBlockTypeTransformSnapshot("page-1", blocks, {
    protectFirstTitle: false,
  });

  expect(() =>
    planBlockTypeTransform({ ...snapshot, wholeBlocks: false }, blocks),
  ).toThrow(/完整的内容块/);
  expect(() =>
    planBlockTypeTransform(snapshot, [
      blocks[0],
      { ...blocks[1], content: "已被修改" },
    ]),
  ).toThrow(/内容已变化/);
});

test("编辑器入口在一个事务中替换全部源块", () => {
  const document: BlockTypeTransformBlock[] = [
    { id: "one", type: "paragraph", content: "第一项" },
    { id: "two", type: "paragraph", content: "第二项" },
  ];
  const snapshot = createPageBodyBlockTypeTransformSnapshot(
    "page-1",
    document,
    { protectFirstTitle: false },
  );
  let transactionCount = 0;
  let removedIds: string[] = [];
  let replacements: unknown[] = [];
  const editor = {
    document,
    transact(callback: () => void) {
      transactionCount += 1;
      callback();
    },
    replaceBlocks(ids: string[], blocks: unknown[]) {
      removedIds = ids;
      replacements = blocks;
    },
  };

  const result = applyBlockTypeTransformToEditor(editor, snapshot);

  expect(result).toEqual({
    ok: true,
    convertedCount: 2,
    target: { blockType: "checkListItem" },
  });
  expect(transactionCount).toBe(1);
  expect(removedIds).toEqual(["one", "two"]);
  expect(
    replacements.map((block) => (block as { type?: string }).type),
  ).toEqual(["checkListItem", "checkListItem"]);
});
