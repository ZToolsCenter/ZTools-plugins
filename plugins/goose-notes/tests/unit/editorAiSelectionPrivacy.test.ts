import { BlockNoteEditor } from "@blocknote/core";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { expect, test } from "playwright/test";
import {
  createPrivateSelectionDocumentStateBuilder,
  gooseSelectionScopedStreamToolsProvider,
} from "../../src/components/editor/ai/selectionPrivacy";

function contentRanges(editor: { prosemirrorState: EditorState }) {
  const ranges = new Map<string, { from: number; to: number }>();
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

function createSelectionEditor() {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "before", type: "paragraph", content: "PRIVATE BEFORE" },
      {
        id: "first",
        type: "paragraph",
        content: "PRIVATELEFTSELECT-ONE tail",
      },
      {
        id: "second",
        type: "paragraph",
        content: "head SELECT-TWOPRIVATERIGHT",
      },
      { id: "after", type: "paragraph", content: "PRIVATE AFTER" },
    ],
  });
  const ranges = contentRanges(editor);
  const first = ranges.get("first")!;
  const second = ranges.get("second")!;
  const from = first.from + "PRIVATELEFT".length;
  const to = second.to - "PRIVATERIGHT".length;

  editor.transact((tr) => {
    tr.setSelection(TextSelection.create(tr.doc, from, to));
  });

  return { editor, from, to };
}

test("选区 documentState 只包含跨段精确选中文字", async () => {
  const { editor } = createSelectionEditor();
  const exactSelectedBlocks = editor.getSelectionCutBlocks(false).blocks;
  const expandedSelectedBlocks = editor.getSelectionCutBlocks(true).blocks;
  const selectedJSON = JSON.stringify(exactSelectedBlocks);

  expect(selectedJSON).toContain("SELECT-ONE tail");
  expect(selectedJSON).toContain("head SELECT-TWO");
  expect(selectedJSON).not.toContain("PRIVATELEFT");
  expect(selectedJSON).not.toContain("PRIVATERIGHT");
  // 证明端点确实位于单词中间，xl-ai 默认 expandToWords 会扩大选区。
  expect(JSON.stringify(expandedSelectedBlocks)).toContain("PRIVATELEFT");
  expect(JSON.stringify(expandedSelectedBlocks)).toContain("PRIVATERIGHT");

  const privateBuilder = createPrivateSelectionDocumentStateBuilder(
    async (request) => ({
      selection: true as const,
      selectedBlocks: (request.selectedBlocks ?? []).map((block) => ({
        id: block.id,
        block,
      })),
      blocks: editor.document.map((block) => ({ block })),
      isEmptyDocument: false,
    }),
  );
  const documentState = await privateBuilder({
    editor,
    // 模拟 xl-ai 传入已经扩词的 selectedBlocks；项目 builder 必须重新精确裁剪。
    selectedBlocks: expandedSelectedBlocks,
    streamTools: [],
    onStart: () => undefined,
  });
  const serialized = JSON.stringify(documentState);

  expect(documentState.selection).toBe(true);
  if (!documentState.selection) throw new Error("expected selection state");
  expect(documentState.blocks).toEqual([]);
  expect(serialized).toContain("SELECT-ONE tail");
  expect(serialized).toContain("head SELECT-TWO");
  expect(serialized).not.toContain("PRIVATE BEFORE");
  expect(serialized).not.toContain("PRIVATE AFTER");
  expect(serialized).not.toContain("PRIVATELEFT");
  expect(serialized).not.toContain("PRIVATERIGHT");
});

test("无选区 documentState 保持完整文档上下文", async () => {
  const fullDocumentState = {
    selection: false as const,
    blocks: [{ id: "before$", block: "PRIVATE BEFORE", cursor: true }],
    isEmptyDocument: false,
  };
  const privateBuilder = createPrivateSelectionDocumentStateBuilder(
    async () => fullDocumentState,
  );
  const editor = BlockNoteEditor.create({
    initialContent: [{ id: "before", type: "paragraph", content: "before" }],
  });

  await expect(
    privateBuilder({
      editor,
      streamTools: [],
      onStart: () => undefined,
    }),
  ).resolves.toEqual(fullDocumentState);
});

test("选区工具允许 update+add 选中块，拒绝区外 id；无选区保持完整工具集", () => {
  const { editor, from, to } = createSelectionEditor();
  const selectionTools = gooseSelectionScopedStreamToolsProvider.getStreamTools(
    editor,
    { from, to },
  );

  expect(selectionTools.map((tool) => tool.name)).toEqual(["update", "add"]);

  const update = selectionTools.find((tool) => tool.name === "update")!;
  expect(
    update.validate({
      type: "update",
      id: "first$",
      block: "<p>replacement</p>",
    }).ok,
  ).toBe(true);
  expect(
    update.validate({
      type: "update",
      id: "before$",
      block: "<p>leak</p>",
    }).ok,
  ).toBe(false);

  const add = selectionTools.find((tool) => tool.name === "add")!;
  expect(
    add.validate({
      type: "add",
      referenceId: "second$",
      position: "after",
      blocks: ["<p>extra item</p>"],
    }).ok,
  ).toBe(true);
  expect(
    add.validate({
      type: "add",
      referenceId: "before$",
      position: "after",
      blocks: ["<p>leak</p>"],
    }).ok,
  ).toBe(false);

  const documentTools = gooseSelectionScopedStreamToolsProvider.getStreamTools(
    editor,
    undefined,
  );
  expect(documentTools.map((tool) => tool.name)).toEqual([
    "update",
    "add",
    "delete",
  ]);
});
