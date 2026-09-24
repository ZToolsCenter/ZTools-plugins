import { BlockNoteEditor } from "@blocknote/core";
import { expect, test } from "playwright/test";
import { editorSchema } from "../../src/components/editor/core/schema";
import {
  applyMarkdownToInlineTarget,
  restoreBlocks,
  serializeInlineEditTarget,
  snapshotBlocks,
  type InlineMarkdownEditor,
} from "../../src/lib/notebook-ai/inlineMarkdownApply";

function createEditor(content: Array<Record<string, unknown>>) {
  return BlockNoteEditor.create({
    schema: editorSchema,
    initialContent: content as any,
  });
}

function plainText(block: { content?: unknown } | undefined | null): string {
  if (!block) return "";
  const c = block.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c
    .map((item) => {
      if (typeof item === "string") return item;
      return (item as { text?: string })?.text ?? "";
    })
    .join("");
}

test("apply multi-line bullet markdown 将单段替换为 3 个 bulletListItem", () => {
  const editor = createEditor([
    {
      id: "title",
      type: "heading",
      props: { level: 1 },
      content: "标题",
    },
    {
      id: "para",
      type: "paragraph",
      content: "改成多行无序列表",
    },
  ]);

  const result = applyMarkdownToInlineTarget(
    editor as unknown as InlineMarkdownEditor,
    "- a\n- b\n- c",
    { sourceBlockIds: ["para"] },
  );

  expect(result.replacedCount).toBe(1);
  expect(result.blockCount).toBe(3);
  expect(result.newBlockIds.length).toBe(3);

  const body = editor.document.filter((b) => b.id !== "title");
  expect(body).toHaveLength(3);
  expect(body.map((b) => b.type)).toEqual([
    "bulletListItem",
    "bulletListItem",
    "bulletListItem",
  ]);
  expect(body.map((b) => plainText(b as any))).toEqual(["a", "b", "c"]);
  // 原段落应已移除
  expect(editor.getBlock("para")).toBeUndefined();
});

test("apply 跳过已消失的源块，只替换仍在文档中的块", () => {
  const editor = createEditor([
    { id: "keep", type: "paragraph", content: "还在" },
    { id: "alive", type: "paragraph", content: "待改" },
  ]);

  const result = applyMarkdownToInlineTarget(
    editor as unknown as InlineMarkdownEditor,
    "已改写",
    { sourceBlockIds: ["missing-block", "alive"] },
  );

  expect(result.replacedCount).toBe(1);
  expect(plainText(editor.getBlock("keep") as any)).toBe("还在");
  expect(editor.getBlock("alive")).toBeUndefined();
  expect(
    editor.document.some((b) => plainText(b as any) === "已改写"),
  ).toBe(true);
});

test("apply 源块全部消失时抛中文错误", () => {
  const editor = createEditor([
    { id: "keep", type: "paragraph", content: "还在" },
  ]);

  expect(() =>
    applyMarkdownToInlineTarget(
      editor as unknown as InlineMarkdownEditor,
      "新内容",
      { sourceBlockIds: ["gone"] },
    ),
  ).toThrow(/目标块已不在文档中/);
});

test("apply 空 markdown / 无法解析时抛错", () => {
  const editor = createEditor([
    { id: "p1", type: "paragraph", content: "x" },
  ]);

  expect(() =>
    applyMarkdownToInlineTarget(
      editor as unknown as InlineMarkdownEditor,
      "   ",
      { sourceBlockIds: ["p1"] },
    ),
  ).toThrow(/未返回可写入|空/);

  expect(() =>
    applyMarkdownToInlineTarget(
      editor as unknown as InlineMarkdownEditor,
      "- a\n- b",
      { sourceBlockIds: [] },
    ),
  ).toThrow(/目标块/);
});

test("serializeInlineEditTarget 在无选区时序列化光标块", () => {
  const editor = createEditor([
    { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
    { id: "body", type: "paragraph", content: "光标所在段落" },
  ]);

  // 无选区：setTextCursorPosition 到 body
  editor.setTextCursorPosition("body", "start");

  const target = serializeInlineEditTarget(
    editor as unknown as InlineMarkdownEditor,
  );
  expect(target.mode).toBe("cursor");
  expect(target.sourceBlockIds).toEqual(["body"]);
  expect(target.oldMarkdown).toContain("光标所在段落");
});

test("serializeInlineEditTarget 有选区时序列化选中块", () => {
  const editor = createEditor([
    { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
    { id: "a", type: "paragraph", content: "第一段" },
    { id: "b", type: "paragraph", content: "第二段" },
  ]);

  // 选中 a..b：用 setTextCursorPosition + 选区 API
  // BlockNote: setSelection 接受 block id
  editor.setSelection("a", "b");

  const target = serializeInlineEditTarget(
    editor as unknown as InlineMarkdownEditor,
  );
  expect(target.mode).toBe("selection");
  expect(target.sourceBlockIds).toEqual(["a", "b"]);
  expect(target.oldMarkdown).toContain("第一段");
  expect(target.oldMarkdown).toContain("第二段");
});

test("snapshotBlocks + restoreBlocks 可拒绝后恢复原文", () => {
  const editor = createEditor([
    { id: "title", type: "heading", props: { level: 1 }, content: "标题" },
    { id: "para", type: "paragraph", content: "原始内容" },
  ]);

  const snapshot = snapshotBlocks(
    editor as unknown as InlineMarkdownEditor,
    ["para"],
  );
  expect(snapshot.blocks).toHaveLength(1);

  const applied = applyMarkdownToInlineTarget(
    editor as unknown as InlineMarkdownEditor,
    "- x\n- y",
    { sourceBlockIds: ["para"] },
  );
  expect(editor.document.some((b) => b.type === "bulletListItem")).toBe(true);

  restoreBlocks(
    editor as unknown as InlineMarkdownEditor,
    snapshot,
    applied.newBlockIds,
  );

  const body = editor.document.filter((b) => b.id !== "title");
  expect(body).toHaveLength(1);
  expect(body[0]?.type).toBe("paragraph");
  expect(plainText(body[0] as any)).toBe("原始内容");
});
