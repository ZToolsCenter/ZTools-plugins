import { createExtension } from "@blocknote/core";
import { NodeSelection, TextSelection } from "prosemirror-state";

/**
 * 媒体 / 结构化块（content: "none"）选中时按 Enter，在下方插入空段落。
 *
 * BlockNote 自带 NodeSelectionKeyboard 已覆盖「NodeSelection + Enter」，
 * 但自定义 video 控件、图片预览等 DOM 有时拿不到标准 NodeSelection，
 * 或光标落在 void 块附近时 Enter 无响应。这里补一层：
 * - 已是 NodeSelection 且节点为 void 块 → 下方插空行
 * - 当前 text cursor 所在块为 void 类型 → 下方插空行
 */
const VOID_BLOCK_TYPES = new Set([
  "image",
  "imageResize",
  "video",
  "audio",
  "file",
  "divider",
]);

function isVoidBlockType(type: string | undefined | null): boolean {
  return Boolean(type && VOID_BLOCK_TYPES.has(type));
}

export const gooseMediaBlockEnterExtension = createExtension({
  key: "goose-media-block-enter",
  keyboardShortcuts: {
    Enter: ({ editor }) => {
      const state = editor.prosemirrorState;
      const { selection } = state;

      // NodeSelection：选中整个 void 节点
      if (selection instanceof NodeSelection) {
        const node = selection.node;
        const typeName = node.type.name;
        // blockContent 节点名通常就是块类型（video / image / …）
        if (!isVoidBlockType(typeName) && typeName !== "blockContainer") {
          // 若选中的是 blockContainer，看其子内容类型
          const childType = node.firstChild?.type.name;
          if (!isVoidBlockType(childType)) return false;
        }

        try {
          const block = editor.getTextCursorPosition().block;
          if (!isVoidBlockType(block.type)) {
            // 尝试用 document 中与 selection 对应的块
            return insertParagraphAfterSelection(editor, selection);
          }
          const [inserted] = editor.insertBlocks(
            [{ type: "paragraph", content: "" }],
            block,
            "after",
          );
          if (inserted) editor.setTextCursorPosition(inserted, "start");
          return true;
        } catch {
          return insertParagraphAfterSelection(editor, selection);
        }
      }

      // 文本光标落在 void 块上（部分路径 getTextCursorPosition 仍能返回该块）
      try {
        const block = editor.getTextCursorPosition().block;
        if (!isVoidBlockType(block.type)) return false;
        const [inserted] = editor.insertBlocks(
          [{ type: "paragraph", content: "" }],
          block,
          "after",
        );
        if (inserted) editor.setTextCursorPosition(inserted, "start");
        return true;
      } catch {
        return false;
      }
    },
  },
});

function insertParagraphAfterSelection(
  editor: {
    prosemirrorView: {
      state: { schema: { nodes: Record<string, any> }; tr: any; doc: any };
      dispatch: (tr: any) => void;
    };
  },
  selection: NodeSelection,
): boolean {
  const view = editor.prosemirrorView;
  const paragraph = view.state.schema.nodes.paragraph;
  const blockContainer = view.state.schema.nodes.blockContainer;
  if (!paragraph || !blockContainer) return false;

  const insertPos = selection.$to.after();
  const newBlock = blockContainer.createAndFill(null, [paragraph.create()]);
  if (!newBlock) return false;

  const tr = view.state.tr.insert(insertPos, newBlock);
  const cursorPos = insertPos + 2;
  try {
    tr.setSelection(TextSelection.create(tr.doc, cursorPos));
  } catch {
    // ignore selection failure
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}
