import { createExtension } from "@blocknote/core";

// 命中需要"Enter 软换行"的容器型 block：callout、quote
const SOFTWRAP_BLOCK_TYPES = new Set(["callout", "quote"]);

const findContainingBlockType = (
  $from: any,
): { contentTypeName: string; isAtEnd: boolean; isEmpty: boolean } | null => {
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.type.name === "blockContainer") {
      const contentNode = d + 1 <= $from.depth ? $from.node(d + 1) : null;
      if (!contentNode) return null;
      const contentTypeName = contentNode.type.name;
      const isAtEnd = $from.parentOffset === contentNode.content.size;
      const isEmpty = contentNode.content.size === 0;
      return { contentTypeName, isAtEnd, isEmpty };
    }
  }
  return null;
};

/**
 * 在 callout / quote 内：
 * - Enter → 插入 hardBreak（软换行，留在容器内）
 * - 容器为空 + Enter → 走默认行为（拆出新 paragraph，便于退出）
 * - Shift+Enter → 退出容器到新 paragraph（与 codeBlock 的 Shift+Enter 对称）
 */
export const gooseCalloutKeyboardExtension = createExtension({
  key: "goose-callout-keyboard",
  keyboardShortcuts: {
    Enter: ({ editor }) => {
      const pmState = editor.prosemirrorState;
      const info = findContainingBlockType(pmState.selection.$from);
      if (!info) return false;
      if (!SOFTWRAP_BLOCK_TYPES.has(info.contentTypeName)) return false;
      if (info.isEmpty) return false; // 空容器按 Enter 允许退出

      const hardBreakType = pmState.schema.nodes.hardBreak;
      if (!hardBreakType) return false;

      const tr = pmState.tr.replaceSelectionWith(hardBreakType.create()).scrollIntoView();
      editor.prosemirrorView.dispatch(tr);
      return true;
    },
    "Shift-Enter": ({ editor }) => {
      const pmState = editor.prosemirrorState;
      const info = findContainingBlockType(pmState.selection.$from);
      if (!info) return false;
      if (!SOFTWRAP_BLOCK_TYPES.has(info.contentTypeName)) return false;

      const block = editor.getTextCursorPosition().block;
      const [inserted] = editor.insertBlocks(
        [{ type: "paragraph", content: "" }],
        block,
        "after",
      );
      if (inserted) editor.setTextCursorPosition(inserted);
      return true;
    },
  },
});
