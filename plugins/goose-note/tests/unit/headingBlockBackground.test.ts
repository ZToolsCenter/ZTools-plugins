import { BlockNoteEditor } from "@blocknote/core";
import { expect, test } from "playwright/test";
import { editorSchema } from "../../src/components/editor/core/schema";
import {
  MIXED_HEADING_BACKGROUND,
  applyHeadingBlockBackground,
  getHeadingBackgroundSelectionState,
} from "../../src/components/editor/toolbars/formatting/headingBlockBackground";

function createEditor(content: Array<Record<string, unknown>>) {
  return BlockNoteEditor.create({
    schema: editorSchema,
    initialContent: content as any,
  });
}

test("标题背景色使用块级属性并清理旧的行内背景", () => {
  const editor = createEditor([
    {
      id: "heading",
      type: "heading",
      props: { level: 2 },
      content: [
        {
          type: "text",
          text: "整行标题",
          styles: { backgroundColor: "yellow" },
        },
      ],
    },
  ]);

  expect(applyHeadingBlockBackground(editor, "blue")).toBe(true);

  const heading = editor.getBlock("heading") as any;
  expect(heading.props.backgroundColor).toBe("blue");
  expect(heading.content[0].styles.backgroundColor).toBeUndefined();
});

test("普通正文不进入标题块背景逻辑", () => {
  const editor = createEditor([
    { id: "body", type: "paragraph", content: "正文" },
  ]);

  expect(applyHeadingBlockBackground(editor, "blue")).toBe(false);
  expect((editor.getBlock("body") as any).props.backgroundColor).toBe(
    "default",
  );
});

test("多个标题背景不一致时返回混合态", () => {
  const editor = createEditor([
    {
      id: "one",
      type: "heading",
      props: { level: 1, backgroundColor: "blue" },
      content: "一",
    },
    {
      id: "two",
      type: "heading",
      props: { level: 2, backgroundColor: "yellow" },
      content: "二",
    },
  ]);

  expect(
    getHeadingBackgroundSelectionState([
      editor.getBlock("one")!,
      editor.getBlock("two")!,
    ]),
  ).toEqual({
    isHeadingSelection: true,
    backgroundColor: MIXED_HEADING_BACKGROUND,
  });
});
