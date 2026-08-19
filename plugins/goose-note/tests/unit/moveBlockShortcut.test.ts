import { BlockNoteEditor } from "@blocknote/core";
import { expect, test } from "playwright/test";
import { editorSchema } from "../../src/components/editor/core/schema";
import {
  getBlocksToMove,
  moveSelectedBlocksByShortcut,
  wouldMoveBeforeDocumentTitle,
} from "../../src/components/editor/extensions/moveBlockExtension";

function createEditor() {
  return BlockNoteEditor.create({
    schema: editorSchema,
    initialContent: [
      {
        id: "title",
        type: "heading",
        props: { level: 1 },
        content: "文档标题",
      },
      {
        id: "body-1",
        type: "paragraph",
        content: "第一段",
      },
      {
        id: "body-2",
        type: "paragraph",
        content: "第二段",
      },
    ],
  });
}

function topLevelIds(editor: BlockNoteEditor<any, any, any>) {
  return editor.document.map((block) => block.id);
}

function setCursorOnBlock(
  editor: BlockNoteEditor<any, any, any>,
  blockId: string,
) {
  editor.setTextCursorPosition(blockId, "start");
}

test("普通块可下移", () => {
  const editor = createEditor();
  setCursorOnBlock(editor, "body-1");
  expect(getBlocksToMove(editor).map((b) => b.id)).toEqual(["body-1"]);

  const ok = moveSelectedBlocksByShortcut(editor, "down");
  expect(ok).toBe(true);
  expect(topLevelIds(editor)).toEqual(["title", "body-2", "body-1"]);
});

test("普通块可上移", () => {
  const editor = createEditor();
  setCursorOnBlock(editor, "body-2");

  const ok = moveSelectedBlocksByShortcut(editor, "up");
  expect(ok).toBe(true);
  expect(topLevelIds(editor)).toEqual(["title", "body-2", "body-1"]);
});

test("顶边界 no-op：正文首块不能越过标题", () => {
  const editor = createEditor();
  setCursorOnBlock(editor, "body-1");

  const blocks = getBlocksToMove(editor);
  expect(wouldMoveBeforeDocumentTitle(editor, blocks, "up")).toBe(true);

  const before = topLevelIds(editor);
  const ok = moveSelectedBlocksByShortcut(editor, "up");
  expect(ok).toBe(true);
  expect(topLevelIds(editor)).toEqual(before);
});

test("文档标题一不可移动", () => {
  const editor = createEditor();
  setCursorOnBlock(editor, "title");

  const before = topLevelIds(editor);
  expect(moveSelectedBlocksByShortcut(editor, "down")).toBe(true);
  expect(topLevelIds(editor)).toEqual(before);
  expect(moveSelectedBlocksByShortcut(editor, "up")).toBe(true);
  expect(topLevelIds(editor)).toEqual(before);
});

test("底边界 no-op", () => {
  const editor = createEditor();
  setCursorOnBlock(editor, "body-2");

  const before = topLevelIds(editor);
  const ok = moveSelectedBlocksByShortcut(editor, "down");
  expect(ok).toBe(true);
  expect(topLevelIds(editor)).toEqual(before);
});
