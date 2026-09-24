import { BlockNoteEditor } from "@blocknote/core";
import {
  AllSelection,
  TextSelection,
  type EditorState,
} from "@tiptap/pm/state";
import { expect, test } from "playwright/test";
import {
  adjustSelectedBlockHierarchy,
  shouldUseCodeBlockTabIndent,
} from "../../src/components/editor/extensions/tabBehaviorExtension";

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

function selectBlocks(
  editor: BlockNoteEditor<any, any, any>,
  fromId: string,
  toId: string,
) {
  const ranges = contentRanges(editor);
  editor.transact((tr) =>
    tr.setSelection(
      TextSelection.create(
        tr.doc,
        ranges.get(fromId)!.from,
        ranges.get(toId)!.to,
      ),
    ),
  );
}

test("多块文本选区按 Tab 后整组缩进并保留顺序与子树", () => {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
      { id: "parent", type: "bulletListItem", content: "父项" },
      { id: "bullet", type: "bulletListItem", content: "无序" },
      {
        id: "numbered",
        type: "numberedListItem",
        content: "有序",
        children: [{ id: "nested", type: "paragraph", content: "原有子块" }],
      },
      { id: "quote", type: "quote", content: "引用" },
    ],
  });
  selectBlocks(editor, "bullet", "quote");

  expect(adjustSelectedBlockHierarchy(editor, "nest")).toBe(true);

  expect(editor.document.map((block) => block.id)).toEqual(["title", "parent"]);
  expect(editor.getBlock("parent")!.children.map((block) => block.id)).toEqual([
    "bullet",
    "numbered",
    "quote",
  ]);
  expect(
    editor.getBlock("numbered")!.children.map((block) => block.id),
  ).toEqual(["nested"]);
  expect(editor.getSelection()!.blocks.map((block) => block.id)).toEqual([
    "bullet",
    "numbered",
    "quote",
  ]);
});

test("多块文本选区按 Shift-Tab 后整组提升并保留混合块类型", () => {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
      {
        id: "parent",
        type: "bulletListItem",
        content: "父项",
        children: [
          { id: "check", type: "checkListItem", content: "待办" },
          { id: "toggle", type: "toggleListItem", content: "折叠" },
          { id: "paragraph", type: "paragraph", content: "段落" },
        ],
      },
    ],
  });
  selectBlocks(editor, "check", "paragraph");

  expect(adjustSelectedBlockHierarchy(editor, "unnest")).toBe(true);

  expect(editor.document.map((block) => [block.id, block.type])).toEqual([
    ["title", "heading"],
    ["parent", "bulletListItem"],
    ["check", "checkListItem"],
    ["toggle", "toggleListItem"],
    ["paragraph", "paragraph"],
  ]);
  expect(editor.getBlock("parent")!.children).toEqual([]);
  expect(editor.getSelection()!.blocks.map((block) => block.id)).toEqual([
    "check",
    "toggle",
    "paragraph",
  ]);
});

test("单个代码块保留文本缩进，多块选区包含代码块时改为调整块层级", () => {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "before", type: "paragraph", content: "前项" },
      { id: "code", type: "codeBlock", content: "const value = 1;" },
      { id: "after", type: "paragraph", content: "后项" },
    ],
  });

  editor.setTextCursorPosition("code", "start");
  expect(shouldUseCodeBlockTabIndent(editor)).toBe(true);

  selectBlocks(editor, "code", "after");
  expect(shouldUseCodeBlockTabIndent(editor)).toBe(false);
  expect(adjustSelectedBlockHierarchy(editor, "nest")).toBe(true);
  expect(editor.getBlock("before")!.children.map((block) => block.id)).toEqual([
    "code",
    "after",
  ]);
});

test("全选整个文档按 Tab 时不改变任何块结构", () => {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "one", type: "numberedListItem", content: "第一项" },
      { id: "two", type: "numberedListItem", content: "第二项" },
      { id: "three", type: "numberedListItem", content: "第三项" },
    ],
  });
  editor.transact((tr) => tr.setSelection(new AllSelection(tr.doc)));
  const before = JSON.stringify(editor.document);

  expect(adjustSelectedBlockHierarchy(editor, "nest")).toBe(true);

  expect(JSON.stringify(editor.document)).toBe(before);
  expect(editor.prosemirrorState.selection).toBeInstanceOf(AllSelection);
});

test("分级全选正文按 Tab 时不把正文嵌入页面标题", () => {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
      { id: "one", type: "numberedListItem", content: "第一项" },
      { id: "two", type: "numberedListItem", content: "第二项" },
      { id: "three", type: "numberedListItem", content: "第三项" },
    ],
  });
  selectBlocks(editor, "one", "three");
  const before = JSON.stringify(editor.document);

  expect(adjustSelectedBlockHierarchy(editor, "nest")).toBe(true);

  expect(JSON.stringify(editor.document)).toBe(before);
  expect(editor.getSelection()!.blocks.map((block) => block.id)).toEqual([
    "one",
    "two",
    "three",
  ]);
});
