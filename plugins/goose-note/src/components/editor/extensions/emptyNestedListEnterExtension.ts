import { createExtension } from "@blocknote/core";

const LIST_ITEM_TYPES = new Set([
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
]);

/**
 * 空的嵌套列表项按 Enter 时只提升一级，并保留列表类型。
 *
 * BlockNote 默认会先把空列表项原地改成 paragraph；它仍留在父块 children 内，
 * 用户看到的是一个没有 marker 的嵌套空块。列表编辑的自然退出路径应是：
 * 有父级时先提升到父级同层，已经在顶层时才退出成普通段落。
 */
export const gooseEmptyNestedListEnterExtension = createExtension({
  key: "goose-empty-nested-list-enter",
  runsBefore: [
    "bullet-list-item-shortcuts",
    "numbered-list-item-shortcuts",
    "check-list-item-shortcuts",
    "toggle-list-item-shortcuts",
  ],
  keyboardShortcuts: {
    Enter: ({ editor }) => {
      const state = editor.prosemirrorState;
      if (!state.selection.empty) return false;

      const { block } = editor.getTextCursorPosition();
      if (!LIST_ITEM_TYPES.has(block.type)) return false;
      if (!Array.isArray(block.content) || block.content.length > 0) return false;
      if (!editor.getParentBlock(block)) return false;
      if (!editor.canUnnestBlock()) return false;

      editor.unnestBlock();
      return true;
    },
  },
});
