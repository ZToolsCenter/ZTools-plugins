import { BlockNoteEditor } from "@blocknote/core";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { expect, test } from "playwright/test";
import {
  deleteSelectedBlocks,
  hasPositiveBlockContentOverlap,
  isOvershootingSingleTextblockSelection,
} from "../../src/components/editor/extensions/crossBlockDeleteExtension";
import { deleteEmptyNestedListItem } from "../../src/components/editor/extensions/emptyBlockBackspaceExtension";

type ContentRange = { from: number; to: number };

function contentRanges(editor: { prosemirrorState: EditorState }) {
  const ranges = new Map<string, ContentRange>();
  editor.prosemirrorState.doc.descendants((node, pos) => {
    if (node.type.name !== "blockContainer" || !node.firstChild?.isTextblock) {
      return true;
    }
    const from = pos + 2;
    ranges.set(String(node.attrs.id), {
      from,
      to: from + node.firstChild.content.size,
    });
    return true;
  });
  return ranges;
}

function createListEditor() {
  return BlockNoteEditor.create({
    initialContent: [
      { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
      {
        id: "first",
        type: "bulletListItem",
        content: "通过 MQTT 协议进行 Chat 对话",
      },
      { id: "second", type: "bulletListItem", content: "任务编排" },
    ],
  });
}

test("选区端点只接触上一块行尾时，不把上一块算作跨块整体删除", () => {
  for (const reversed of [false, true]) {
    const editor = createListEditor();
    const ranges = contentRanges(editor);
    const first = ranges.get("first")!;
    const second = ranges.get("second")!;
    const anchor = reversed ? second.from + 2 : first.to;
    const head = reversed ? first.to : second.from + 2;

    editor.transact((tr) =>
      tr.setSelection(TextSelection.create(tr.doc, anchor, head)),
    );

    // 仅与 second 正文正重叠，但选区从上一块行尾越界而来。
    // 旧实现直接放行默认 deleteSelection，会连结构删掉 second 整块；
    // 现在钳制为只删 second 内被选中的 inline，两块都保留。
    expect(isOvershootingSingleTextblockSelection(editor.prosemirrorState)).toBe(
      true,
    );
    expect(deleteSelectedBlocks(editor)).toBe(true);
    expect(editor.document.map((block) => block.id)).toEqual([
      "title",
      "first",
      "second",
    ]);
    // 「任务编排」前 2 个码元被选中删除
    expect(editor.getBlock("second")!.content).toEqual([
      { type: "text", text: "编排", styles: {} },
    ]);
    expect(editor.getBlock("first")!.content).toEqual([
      {
        type: "text",
        text: "通过 MQTT 协议进行 Chat 对话",
        styles: {},
      },
    ]);
  }
});

test("两块正文都只是部分选中时，只删文字、保留块壳", () => {
  const editor = createListEditor();
  const ranges = contentRanges(editor);
  const first = ranges.get("first")!;
  const second = ranges.get("second")!;

  editor.transact((tr) =>
    tr.setSelection(
      TextSelection.create(tr.doc, second.from + 2, first.to - 1),
    ),
  );

  expect(deleteSelectedBlocks(editor)).toBe(true);
  // 部分跨块：不得整段 removeBlocks
  expect(editor.document.map((block) => block.id)).toEqual([
    "title",
    "first",
    "second",
  ]);
  // first 末尾 1 码元、second 开头 2 码元被删
  const firstText = (editor.getBlock("first")!.content as { text?: string }[])
    .map((c) => c.text ?? "")
    .join("");
  const secondText = (editor.getBlock("second")!.content as { text?: string }[])
    .map((c) => c.text ?? "")
    .join("");
  expect(firstText.endsWith("对话")).toBe(false);
  expect(secondText).toBe("编排");
});

test("两块正文都被完整选中时，非首块整块删除", () => {
  const editor = createListEditor();
  const ranges = contentRanges(editor);
  const first = ranges.get("first")!;
  const second = ranges.get("second")!;

  editor.transact((tr) =>
    tr.setSelection(TextSelection.create(tr.doc, first.from, second.to)),
  );

  expect(deleteSelectedBlocks(editor)).toBe(true);
  expect(editor.document.map((block) => block.id)).toEqual(["title"]);
});

test("嵌套块部分选中时只删文字；完整选中时由祖先块去重删除", () => {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
      {
        id: "parent",
        type: "bulletListItem",
        content: "父项",
        children: [{ id: "child", type: "paragraph", content: "子项" }],
      },
      { id: "after", type: "paragraph", content: "后续" },
    ],
  });
  const ranges = contentRanges(editor);
  const parent = ranges.get("parent")!;
  const child = ranges.get("child")!;

  // 部分选中：保留结构
  editor.transact((tr) =>
    tr.setSelection(
      TextSelection.create(tr.doc, parent.from + 1, child.to - 1),
    ),
  );
  expect(deleteSelectedBlocks(editor)).toBe(true);
  expect(editor.document.map((block) => block.id)).toEqual([
    "title",
    "parent",
    "after",
  ]);
  expect(editor.getBlock("parent")!.children.map((c) => c.id)).toEqual([
    "child",
  ]);

  // 重新构造完整选中 parent+child
  const editor2 = BlockNoteEditor.create({
    initialContent: [
      { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
      {
        id: "parent",
        type: "bulletListItem",
        content: "父项",
        children: [{ id: "child", type: "paragraph", content: "子项" }],
      },
      { id: "after", type: "paragraph", content: "后续" },
    ],
  });
  const ranges2 = contentRanges(editor2);
  const parent2 = ranges2.get("parent")!;
  const child2 = ranges2.get("child")!;
  editor2.transact((tr) =>
    tr.setSelection(TextSelection.create(tr.doc, parent2.from, child2.to)),
  );
  expect(deleteSelectedBlocks(editor2)).toBe(true);
  expect(editor2.document.map((block) => block.id)).toEqual(["title", "after"]);
});

test("空文本块只有被选区严格跨过时才算选中", () => {
  expect(
    hasPositiveBlockContentOverlap(
      { from: 10, to: 12 },
      { from: 10, to: 10, isTextblock: true },
    ),
  ).toBe(false);
  expect(
    hasPositiveBlockContentOverlap(
      { from: 9, to: 11 },
      { from: 10, to: 10, isTextblock: true },
    ),
  ).toBe(true);
});

function insertHardBreakLine(
  editor: BlockNoteEditor,
  blockId: string,
  secondLine: string,
) {
  const ranges = contentRanges(editor);
  const block = ranges.get(blockId)!;
  const schema = editor.prosemirrorState.schema;
  editor.transact((tr) => {
    tr.insert(block.to, schema.nodes.hardBreak!.create());
  });
  const afterBreak = contentRanges(editor).get(blockId)!;
  editor.transact((tr) => {
    tr.insert(afterBreak.to, schema.text(secondLine));
  });
}

test("hardBreak 多行块选区越出内容边界时，删除只清空正文、保留空块", () => {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
      { id: "b1", type: "paragraph", content: "行A" },
      { id: "b2", type: "paragraph", content: "块2" },
    ],
  });
  insertHardBreakLine(editor, "b1", "行B");

  const b1 = contentRanges(editor).get("b1")!;
  const b2 = contentRanges(editor).get("b2")!;
  // 模拟划选多行时 DOM 端点落到下一块开头、却未覆盖下一块正文
  editor.transact((tr) =>
    tr.setSelection(TextSelection.create(tr.doc, b1.from, b2.from)),
  );

  expect(isOvershootingSingleTextblockSelection(editor.prosemirrorState)).toBe(
    true,
  );
  expect(deleteSelectedBlocks(editor)).toBe(true);
  expect(editor.document.map((block) => block.id)).toEqual([
    "title",
    "b1",
    "b2",
  ]);
  expect(editor.getBlock("b1")!.content).toEqual([]);
  expect(editor.getBlock("b2")!.content).toEqual([
    { type: "text", text: "块2", styles: {} },
  ]);
});

test("hardBreak 多行块完整选中并捎带下一块部分正文时，两块都保留", () => {
  // 用户截图场景：选中块1（含 shift+enter 行）时 DOM 常把块2 也划进选区
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
      { id: "b1", type: "paragraph", content: "块1" },
      { id: "b2", type: "paragraph", content: "块2" },
    ],
  });
  insertHardBreakLine(editor, "b1", "块1的 shift+回车换行");

  const b1 = contentRanges(editor).get("b1")!;
  const b2 = contentRanges(editor).get("b2")!;
  // 块1 全文 + 块2 首字（部分）
  editor.transact((tr) =>
    tr.setSelection(TextSelection.create(tr.doc, b1.from, b2.from + 1)),
  );

  expect(deleteSelectedBlocks(editor)).toBe(true);
  expect(editor.document.map((block) => block.id)).toEqual([
    "title",
    "b1",
    "b2",
  ]);
  expect(editor.getBlock("b1")!.content).toEqual([]);
  const b2Text = (editor.getBlock("b2")!.content as { text?: string }[])
    .map((c) => c.text ?? "")
    .join("");
  expect(b2Text).toBe("2");
});

test("hardBreak 多行块与下一块均被完整选中时，仍只清文字不拆块", () => {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
      { id: "b1", type: "paragraph", content: "块1" },
      { id: "b2", type: "paragraph", content: "块2" },
    ],
  });
  insertHardBreakLine(editor, "b1", "块1的 shift+回车换行");

  const b1 = contentRanges(editor).get("b1")!;
  const b2 = contentRanges(editor).get("b2")!;
  editor.transact((tr) =>
    tr.setSelection(TextSelection.create(tr.doc, b1.from, b2.to)),
  );

  expect(deleteSelectedBlocks(editor)).toBe(true);
  expect(editor.document.map((block) => block.id)).toEqual([
    "title",
    "b1",
    "b2",
  ]);
  expect(editor.getBlock("b1")!.content).toEqual([]);
  expect(editor.getBlock("b2")!.content).toEqual([]);
});

test("hardBreak 多行块选区落在内容闭边界之后时，删除仍保留块容器", () => {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
      { id: "b1", type: "paragraph", content: "行A" },
      { id: "b2", type: "paragraph", content: "块2" },
    ],
  });
  insertHardBreakLine(editor, "b1", "行B");

  const b1 = contentRanges(editor).get("b1")!;
  // contentTo+1 常落在段落/容器闭标签上，默认 deleteSelection 会拆掉整块
  editor.transact((tr) =>
    tr.setSelection(TextSelection.create(tr.doc, b1.from, b1.to + 1)),
  );

  expect(deleteSelectedBlocks(editor)).toBe(true);
  expect(editor.document.map((block) => block.id)).toEqual([
    "title",
    "b1",
    "b2",
  ]);
  expect(editor.getBlock("b1")!.content).toEqual([]);
});

test("单块正文内精确选区不接管，交给默认删除", () => {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
      { id: "b1", type: "paragraph", content: "行A" },
      { id: "b2", type: "paragraph", content: "块2" },
    ],
  });
  insertHardBreakLine(editor, "b1", "行B");

  const b1 = contentRanges(editor).get("b1")!;
  editor.transact((tr) =>
    tr.setSelection(TextSelection.create(tr.doc, b1.from, b1.to)),
  );

  expect(isOvershootingSingleTextblockSelection(editor.prosemirrorState)).toBe(
    false,
  );
  expect(deleteSelectedBlocks(editor)).toBe(false);
  expect(editor.document.map((block) => block.id)).toEqual([
    "title",
    "b1",
    "b2",
  ]);
});

test("删除空的嵌套列表项时，后续兄弟仍留在原父项下", () => {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
      {
        id: "parent",
        type: "bulletListItem",
        content: "功能应实现",
        children: [
          { id: "file", type: "bulletListItem", content: "文件支持" },
          { id: "empty", type: "bulletListItem", content: "" },
          { id: "context", type: "bulletListItem", content: "上下文配置" },
          { id: "memory", type: "bulletListItem", content: "记忆" },
        ],
      },
    ],
  });

  const empty = editor.getBlock("empty")!;
  expect(deleteEmptyNestedListItem(editor, empty)).toBe(true);

  const parent = editor.getBlock("parent")!;
  expect(parent.children.map((child) => child.id)).toEqual([
    "file",
    "context",
    "memory",
  ]);
  expect(editor.document.map((block) => block.id)).toEqual(["title", "parent"]);
  expect(editor.getTextCursorPosition().block.id).toBe("file");
});

test("顶层空列表项继续交给原生退格逻辑", () => {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
      { id: "empty", type: "bulletListItem", content: "" },
    ],
  });

  expect(deleteEmptyNestedListItem(editor, editor.getBlock("empty")!)).toBe(
    false,
  );
  expect(editor.document.map((block) => block.id)).toEqual(["title", "empty"]);
});
