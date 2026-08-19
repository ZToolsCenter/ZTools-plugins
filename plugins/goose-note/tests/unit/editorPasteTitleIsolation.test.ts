import { BlockNoteEditor } from "@blocknote/core";
import { TextSelection } from "@tiptap/pm/state";
import { expect, test } from "playwright/test";
import { editorSchema } from "../../src/components/editor/core/schema";
import { shouldIsolateTitleStructurePaste } from "../../src/components/editor/hooks/useEditorPaste";

type ContentRange = { from: number; to: number };

function contentRanges(editor: {
  prosemirrorState: { doc: { descendants: Function } };
}) {
  const ranges = new Map<string, ContentRange>();
  editor.prosemirrorState.doc.descendants((node: any, pos: number) => {
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

function createEditor(content: Array<Record<string, unknown>>) {
  return BlockNoteEditor.create({
    schema: editorSchema,
    initialContent: content as any,
  });
}

test("小窗 raw 首段多 block 选区不走标题一隔离（应替换选区而非下方追加）", () => {
  const editor = createEditor([
    { id: "a", type: "paragraph", content: "AAA" },
    { id: "b", type: "paragraph", content: "BBB" },
    { id: "c", type: "paragraph", content: "CCC" },
  ]);
  const ranges = contentRanges(editor);
  const a = ranges.get("a")!;
  const b = ranges.get("b")!;

  editor.transact((tr) => {
    tr.setSelection(TextSelection.create(tr.doc, a.from, b.to));
  });

  // 旧逻辑：cursor 在首块 → 误判为标题隔离 → insertBlocks 追加
  expect(shouldIsolateTitleStructurePaste(editor)).toBe(false);
});

test("小窗 raw 光标在首段折叠时也不走标题一隔离（首块不是 H1）", () => {
  const editor = createEditor([
    { id: "a", type: "paragraph", content: "AAA" },
    { id: "b", type: "paragraph", content: "BBB" },
  ]);
  const ranges = contentRanges(editor);
  const a = ranges.get("a")!;

  editor.transact((tr) => {
    tr.setSelection(TextSelection.create(tr.doc, a.from));
  });

  expect(shouldIsolateTitleStructurePaste(editor)).toBe(false);
});

test("笔记本标题一内折叠光标走标题一隔离", () => {
  const editor = createEditor([
    {
      id: "title",
      type: "heading",
      props: { level: 1 },
      content: "标题",
    },
    { id: "body", type: "paragraph", content: "正文" },
  ]);
  const ranges = contentRanges(editor);
  const title = ranges.get("title")!;

  editor.transact((tr) => {
    tr.setSelection(TextSelection.create(tr.doc, title.from));
  });

  expect(shouldIsolateTitleStructurePaste(editor)).toBe(true);
});

test("笔记本跨标题与正文的多 block 选区不走标题一隔离", () => {
  const editor = createEditor([
    {
      id: "title",
      type: "heading",
      props: { level: 1 },
      content: "标题",
    },
    { id: "body", type: "paragraph", content: "正文" },
  ]);
  const ranges = contentRanges(editor);
  const title = ranges.get("title")!;
  const body = ranges.get("body")!;

  editor.transact((tr) => {
    tr.setSelection(TextSelection.create(tr.doc, title.from, body.to));
  });

  expect(shouldIsolateTitleStructurePaste(editor)).toBe(false);
});
