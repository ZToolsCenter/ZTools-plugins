import { BlockNoteEditor } from "@blocknote/core";
import { TextSelection } from "@tiptap/pm/state";
import { expect, test } from "playwright/test";
import { editorSchema } from "../../src/components/editor/core/schema";
import { getCurrentBlockNodeSelection } from "../../src/components/editor/extensions/copyCurrentBlockExtension";

function createEditor() {
  return BlockNoteEditor.create({
    schema: editorSchema,
    initialContent: [
      {
        id: "heading",
        type: "heading",
        props: { level: 2, backgroundColor: "blue" },
        content: "可复制标题",
      },
      { id: "body", type: "paragraph", content: "正文" },
    ],
  });
}

test("光标选区折叠时 Cmd+C 的复制范围提升为当前完整块", () => {
  const editor = createEditor();
  const selection = getCurrentBlockNodeSelection(editor.prosemirrorState);

  expect(selection?.node.type.name).toBe("blockContainer");
  expect(selection?.node.firstChild?.type.name).toBe("heading");
  expect(selection?.node.firstChild?.attrs.backgroundColor).toBe("blue");
});

test("已有文本选区时保留原生复制范围", () => {
  const editor = createEditor();
  let textPos = -1;
  editor.prosemirrorState.doc.descendants((node, pos) => {
    if (textPos < 0 && node.isText) textPos = pos;
    return textPos < 0;
  });
  editor.transact((tr) => {
    tr.setSelection(TextSelection.create(tr.doc, textPos, textPos + 2));
  });

  expect(getCurrentBlockNodeSelection(editor.prosemirrorState)).toBeNull();
});
