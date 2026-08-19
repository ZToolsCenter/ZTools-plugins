import { BlockNoteEditor } from "@blocknote/core";
import { mapTableCell } from "@blocknote/core";
import {
  AllSelection,
  TextSelection,
} from "@tiptap/pm/state";
import { expect, test } from "playwright/test";
import { editorSchema } from "../../src/components/editor/core/schema";
import {
  applySelectionTextAlignment,
  clearSelectionFormatting,
  getFormattingSelectionMode,
  getFormattingToolbarCapabilities,
  getSelectionTextAlignment,
  shouldRenderFormattingToolbar,
} from "../../src/components/editor/toolbars/formatting/helpers";

function createEditor(content: Array<Record<string, unknown>>) {
  return BlockNoteEditor.create({
    schema: editorSchema,
    initialContent: content as any,
  });
}

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

function findTableBlock(editor: ReturnType<typeof createEditor>) {
  const table = editor.document.find((block: any) => block.type === "table");
  if (!table) throw new Error("Missing table block");
  return table as any;
}

function getCellAlignment(
  editor: ReturnType<typeof createEditor>,
  row: number,
  col: number,
) {
  const table = findTableBlock(editor);
  const raw = table.content.rows[row]?.cells?.[col];
  if (raw == null) throw new Error(`Missing cell ${row},${col}`);
  return mapTableCell(raw).props.textAlignment;
}

test("表格单元格内文字选区 → mode cellText，能力全开", () => {
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

  const mode = getFormattingSelectionMode(editor);
  const caps = getFormattingToolbarCapabilities(editor);

  expect(mode).toBe("cellText");
  expect(caps.mode).toBe("cellText");
  expect(caps.showAlign).toBe(true);
  expect(caps.showLink).toBe(true);
  expect(caps.showMarks).toBe(true);
  expect(shouldRenderFormattingToolbar(editor)).toBe(true);
});

test("多段落选区 → multiBlock，隐藏 link", () => {
  const editor = createEditor([
    { id: "p1", type: "paragraph", content: "第一段" },
    { id: "p2", type: "paragraph", content: "第二段" },
  ]);

  editor.transact((tr) => {
    tr.setSelection(new AllSelection(tr.doc));
  });

  const mode = getFormattingSelectionMode(editor);
  const caps = getFormattingToolbarCapabilities(editor);

  expect(mode).toBe("multiBlock");
  expect(caps.mode).toBe("multiBlock");
  expect(caps.showLink).toBe(false);
  expect(caps.showAlign).toBe(true);
  expect(caps.showMarks).toBe(true);
});

test("capabilities 在 multiBlock 时隐藏 link（与 mode 一致）", () => {
  const editor = createEditor([
    { id: "a", type: "paragraph", content: "AAA" },
    { id: "b", type: "paragraph", content: "BBB" },
    { id: "c", type: "paragraph", content: "CCC" },
  ]);

  editor.transact((tr) => {
    tr.setSelection(new AllSelection(tr.doc));
  });

  const caps = getFormattingToolbarCapabilities(editor);
  expect(caps.mode).toBe("multiBlock");
  expect(caps.showLink).toBe(false);
});

test("段落对齐 applySelectionTextAlignment 生效", () => {
  const editor = createEditor([
    { id: "body", type: "paragraph", content: "对齐这段文字" },
  ]);

  const range = findTextRange(editor, "对齐这段文字");
  editor.transact((tr) => {
    tr.setSelection(TextSelection.create(tr.doc, range.from, range.to));
  });

  applySelectionTextAlignment(editor, "center");

  const block = editor.document.find((b: any) => b.id === "body") as any;
  expect(block?.props?.textAlignment).toBe("center");
  expect(getSelectionTextAlignment(editor)).toBe("center");

  const caps = getFormattingToolbarCapabilities(editor);
  expect(caps.mode).toBe("singleBlock");
  expect(caps.textAlignment).toBe("center");
  expect(caps.showLink).toBe(true);
});

test("表格单元格对齐 applySelectionTextAlignment 写入 cell props", () => {
  const editor = createEditor([
    {
      id: "tbl-align",
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          {
            cells: [
              [{ type: "text", text: "左上" }],
              [{ type: "text", text: "右上目标" }],
            ],
          },
          {
            cells: [
              [{ type: "text", text: "左下" }],
              [{ type: "text", text: "右下" }],
            ],
          },
        ],
      },
    },
  ]);

  const range = findTextRange(editor, "右上目标");
  editor.transact((tr) => {
    tr.setSelection(TextSelection.create(tr.doc, range.from, range.to));
  });

  expect(getFormattingSelectionMode(editor)).toBe("cellText");

  // 不应抛错；优先走 cell 路径
  expect(() => applySelectionTextAlignment(editor, "center")).not.toThrow();

  // 验证目标单元格 textAlignment
  expect(getCellAlignment(editor, 0, 1)).toBe("center");
  // 未选中的单元格保持默认 left
  expect(getCellAlignment(editor, 0, 0)).toBe("left");
  expect(getCellAlignment(editor, 1, 0)).toBe("left");
  expect(getCellAlignment(editor, 1, 1)).toBe("left");
});

test("clearSelectionFormatting 重置段落对齐", () => {
  const editor = createEditor([
    {
      id: "body",
      type: "paragraph",
      props: { textAlignment: "right" },
      content: "清理格式",
    },
  ]);

  const range = findTextRange(editor, "清理格式");
  editor.transact((tr) => {
    tr.setSelection(TextSelection.create(tr.doc, range.from, range.to));
  });

  clearSelectionFormatting(editor);

  const block = editor.document.find((b: any) => b.id === "body") as any;
  expect(block?.props?.textAlignment).toBe("left");
});
