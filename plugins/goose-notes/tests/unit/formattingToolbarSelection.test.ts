import { BlockNoteEditor } from "@blocknote/core";
import {
  AllSelection,
  NodeSelection,
  TextSelection,
} from "@tiptap/pm/state";
import { expect, test } from "playwright/test";
import { editorSchema } from "../../src/components/editor/core/schema";
import {
  getFormattingSelectionMode,
  getFormattingToolbarCapabilities,
  resolveFormattingToolbarAiBlockId,
  shouldRenderFormattingToolbar,
} from "../../src/components/editor/toolbars/formatting/helpers";

function createEditor(content: Array<Record<string, unknown>>) {
  return BlockNoteEditor.create({
    schema: editorSchema,
    initialContent: content as any,
  });
}

function findNodePosition(editor: ReturnType<typeof createEditor>, type: string) {
  let result: number | null = null;
  editor.prosemirrorState.doc.descendants((node, pos) => {
    if (node.type.name === type) {
      result = pos;
      return false;
    }
    return result === null;
  });
  if (result === null) throw new Error(`Missing ${type} node`);
  return result;
}

function findMarkedTextRange(
  editor: ReturnType<typeof createEditor>,
  markName: string,
) {
  let result: { from: number; to: number } | null = null;
  editor.prosemirrorState.doc.descendants((node, pos) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === markName)) {
      result = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return result === null;
  });
  if (result === null) throw new Error(`Missing ${markName} text`);
  return result;
}

test("整块选中代码块时不触发格式工具栏", () => {
  const editor = createEditor([
    { id: "code", type: "codeBlock", content: "const answer = 42;" },
  ]);
  const codeBlockPos = findNodePosition(editor, "codeBlock");

  editor.transact((tr) => {
    tr.setSelection(NodeSelection.create(tr.doc, codeBlockPos));
  });

  expect(shouldRenderFormattingToolbar(editor)).toBe(false);
});

test("仅有代码块的文档全选时不触发格式工具栏", () => {
  const editor = createEditor([
    { id: "code", type: "codeBlock", content: "const answer = 42;" },
  ]);

  editor.transact((tr) => {
    tr.setSelection(new AllSelection(tr.doc));
  });

  expect(shouldRenderFormattingToolbar(editor)).toBe(false);
});

test("代码块与普通正文混合选中时仍允许格式工具栏", () => {
  const editor = createEditor([
    { id: "code", type: "codeBlock", content: "const answer = 42;" },
    { id: "body", type: "paragraph", content: "普通正文" },
  ]);

  editor.transact((tr) => {
    tr.setSelection(new AllSelection(tr.doc));
  });

  expect(shouldRenderFormattingToolbar(editor)).toBe(true);
});

test("选中行内代码时仍触发格式工具栏（可取消 code）", () => {
  const editor = createEditor([
    {
      id: "body",
      type: "paragraph",
      content: [
        { type: "text", text: "之前 " },
        {
          type: "text",
          text: "/path/to/application-dev.yml",
          styles: { code: true },
        },
        { type: "text", text: " 之后" },
      ],
    },
  ]);
  const codeRange = findMarkedTextRange(editor, "code");

  editor.transact((tr) => {
    tr.setSelection(TextSelection.create(tr.doc, codeRange.from, codeRange.to));
  });

  expect(shouldRenderFormattingToolbar(editor)).toBe(true);
});

test("部分选中行内代码时仍触发格式工具栏（可取消 code）", () => {
  const editor = createEditor([
    {
      id: "body",
      type: "paragraph",
      content: [
        { type: "text", text: "之前 " },
        { type: "text", text: "inline-code", styles: { code: true } },
        { type: "text", text: " 之后" },
      ],
    },
  ]);
  const codeRange = findMarkedTextRange(editor, "code");

  editor.transact((tr) => {
    tr.setSelection(
      TextSelection.create(tr.doc, codeRange.from + 2, codeRange.to - 2),
    );
  });

  expect(shouldRenderFormattingToolbar(editor)).toBe(true);
});

test("行内代码与普通文字混合选中时仍允许格式工具栏", () => {
  const editor = createEditor([
    {
      id: "body",
      type: "paragraph",
      content: [
        { type: "text", text: "之前 " },
        { type: "text", text: "inline-code", styles: { code: true } },
        { type: "text", text: " 之后" },
      ],
    },
  ]);

  editor.transact((tr) => {
    tr.setSelection(new AllSelection(tr.doc));
  });

  expect(shouldRenderFormattingToolbar(editor)).toBe(true);
});

function findTextRange(
  editor: ReturnType<typeof createEditor>,
  text: string,
) {
  let result: { from: number; to: number } | null = null;
  editor.prosemirrorState.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) {
      result = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return result === null;
  });
  if (result === null) throw new Error(`Missing text: ${text}`);
  return result;
}

test("表格单元格内选中文字时允许格式工具栏", () => {
  const editor = createEditor([
    {
      id: "tbl",
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          {
            cells: [
              [{ type: "text", text: "维度" }],
              [{ type: "text", text: "pi-mono" }],
            ],
          },
          {
            cells: [
              [{ type: "text", text: "用途" }],
              [{ type: "text", text: "Agent" }],
            ],
          },
        ],
      },
    },
  ]);

  const range = findTextRange(editor, "pi-mono");
  editor.transact((tr) => {
    tr.setSelection(TextSelection.create(tr.doc, range.from, range.to));
  });

  expect(shouldRenderFormattingToolbar(editor)).toBe(true);
  expect(getFormattingSelectionMode(editor)).toBe("cellText");
  const caps = getFormattingToolbarCapabilities(editor);
  expect(caps.showAlign).toBe(true);
  expect(caps.showLink).toBe(true);
  expect(caps.showMarks).toBe(true);
});

test("表格块无文字选区时不触发格式工具栏", () => {
  const editor = createEditor([
    {
      id: "tbl",
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          {
            cells: [[{ type: "text", text: "A" }], [{ type: "text", text: "B" }]],
          },
        ],
      },
    },
  ]);

  // 空选区
  expect(shouldRenderFormattingToolbar(editor)).toBe(false);
});

test("表格内选中文字时能解析 AI 锚点 block id", () => {
  const editor = createEditor([
    {
      id: "tbl-ai",
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          {
            cells: [
              [{ type: "text", text: "左列" }],
              [{ type: "text", text: "右列文字" }],
            ],
          },
        ],
      },
    },
  ]);

  const range = findTextRange(editor, "右列文字");
  editor.transact((tr) => {
    tr.setSelection(TextSelection.create(tr.doc, range.from, range.to));
  });

  const blockId = resolveFormattingToolbarAiBlockId(editor);
  expect(blockId).toBeTruthy();
});
