import { BlockNoteEditor } from "@blocknote/core";
import { expect, test } from "@playwright/test";
import { editorSchema } from "../../src/components/editor/core/schema";
import {
  edgeGraphemeLength,
  inlineCodeEdgeArrowAction,
  inlineCodeEdgeAt,
} from "../../src/components/editor/extensions/inlineCodeCaretExtension";

function createEditor() {
  return BlockNoteEditor.create({
    schema: editorSchema,
    initialContent: [
      {
        id: "body",
        type: "paragraph",
        content: [
          { type: "text", text: "AB" },
          { type: "text", text: "XY", styles: { code: true } },
          { type: "text", text: "CD" },
        ],
      },
    ] as never,
  });
}

test("字素长度按可见字符切分，emoji 不会被拆成半个", () => {
  expect(edgeGraphemeLength("abc", "start")).toBe(1);
  expect(edgeGraphemeLength("abc", "end")).toBe(1);
  expect(edgeGraphemeLength("", "start")).toBe(0);
  expect(edgeGraphemeLength("🎉a", "start")).toBe(2);
  expect(edgeGraphemeLength("a🎉", "end")).toBe(2);
});

test("方向键在边界上的四种组合：朝内先进盒、朝外先出盒", () => {
  expect(inlineCodeEdgeArrowAction("start", false, "right")).toBe("enter");
  expect(inlineCodeEdgeArrowAction("start", true, "right")).toBe("step-inward");
  expect(inlineCodeEdgeArrowAction("start", true, "left")).toBe("leave");
  expect(inlineCodeEdgeArrowAction("start", false, "left")).toBe(null);

  expect(inlineCodeEdgeArrowAction("end", false, "left")).toBe("enter");
  expect(inlineCodeEdgeArrowAction("end", true, "left")).toBe("step-inward");
  expect(inlineCodeEdgeArrowAction("end", true, "right")).toBe("leave");
  expect(inlineCodeEdgeArrowAction("end", false, "right")).toBe(null);
});

test("只有代码段两端算边界，段内与纯文本都不算", () => {
  const editor = createEditor();
  const state = editor.prosemirrorState;
  const codeType = state.schema.marks.code;

  let codeFrom = -1;
  state.doc.descendants((node, pos) => {
    if (node.isText && codeType.isInSet(node.marks)) codeFrom = pos;
    return codeFrom < 0;
  });
  expect(codeFrom).toBeGreaterThan(0);

  const edgeAt = (pos: number) =>
    inlineCodeEdgeAt(state.doc.resolve(pos), codeType);

  expect(edgeAt(codeFrom)).toBe("start");
  expect(edgeAt(codeFrom + 1)).toBe(null);
  expect(edgeAt(codeFrom + 2)).toBe("end");
  expect(edgeAt(codeFrom - 1)).toBe(null);
  expect(edgeAt(codeFrom + 3)).toBe(null);
});

test("代码 mark 保持 inclusive，右边界缺省即盒内、左边界缺省即盒外", () => {
  const editor = createEditor();
  const state = editor.prosemirrorState;
  const codeType = state.schema.marks.code;

  let codeFrom = -1;
  state.doc.descendants((node, pos) => {
    if (node.isText && codeType.isInSet(node.marks)) codeFrom = pos;
    return codeFrom < 0;
  });

  expect(codeType.isInSet(state.doc.resolve(codeFrom + 2).marks())).toBeTruthy();
  expect(codeType.isInSet(state.doc.resolve(codeFrom).marks())).toBeFalsy();
});
