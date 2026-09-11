import type { BlockNoteEditor } from "@blocknote/core";

/** 该块自身是否为「折叠块」：折叠列表，或可折叠标题(heading + isToggleable)。 */
export function isToggleBlock(block: any): boolean {
  if (!block) return false;
  if (block.type === "toggleListItem") return true;
  if (block.type === "heading" && (block.props as any)?.isToggleable) return true;
  return false;
}

/**
 * 判断 block 是否位于某个折叠块的内部（沿父块链向上，任意祖先是折叠块即为真）。
 *
 * 折叠块的子内容是 BlockNote 的嵌套 children 结构，getParentBlock 会逐层返回父块、
 * 到顶层块时返回 undefined。用它向上遍历整条祖先链，覆盖「任意后代」而非仅直接子级。
 *
 * 用途：在折叠块内部禁止再插入折叠块，避免无限折叠嵌套。
 */
export function isInsideToggle(
  editor: BlockNoteEditor<any, any, any>,
  block: any,
): boolean {
  if (!block) return false;
  let current: any = block;
  // 防御性上限，避免异常结构导致的死循环。
  for (let i = 0; i < 1000; i++) {
    const parent = editor.getParentBlock(current);
    if (!parent) return false;
    if (isToggleBlock(parent)) return true;
    current = parent;
  }
  return false;
}
