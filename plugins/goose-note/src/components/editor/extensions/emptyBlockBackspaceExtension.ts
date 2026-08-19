import { createExtension } from "@blocknote/core";
import { tryUndoMarkdownBlockTrigger } from "@/components/editor/inputrules/markdownInputRules";
import {
  findParentBlock,
  isToggleBlock,
  type ToggleBlock,
} from "./collapsedToggleEnterExtension";

/**
 * 「删除空控件 → 原地降级为普通空段落，光标留在当前行」。全局统一手感。
 *
 * 问题：光标在一个**空的非段落控件**（空标题 / 空折叠标题 / 空引用 / 空 callout / 空代码块…）
 * 开头按 Backspace 时，ProseMirror 默认 keymap 的 joinBackward 会把它**向前合并进上一块**，
 * 光标随之跳到上一块末尾（见用户截图：删空标题，光标跑到上面「123」标题后面）。
 * 这既不符合预期（光标应留在当前行），合并进折叠块时还会破坏上一块 children。
 *
 * 修复：当「光标空选区 + 在块内容开头 + 当前块内容为空 + 当前块无 children + 当前块是
 * 可降级的非段落控件」时，改为 updateBlock(block, { type: "paragraph" })——把这个空控件
 * **原地还原成普通空段落**，块本身不移除、光标自然留在本行，绝不向前合并、不跳行。
 *
 * 严格的放行边界（任一不满足即 return false 交还默认）：
 * - 非空选区 → 默认（跨块选区删除由 crossBlockDeleteExtension 处理）。
 * - 光标不在块开头（parentOffset !== 0）→ 默认（块内普通删除保持原样）。
 * - 当前块内容非空 → 默认（非空块的块内删除保持默认手感）。
 * - 当前块已是 paragraph → 默认（已是纯文本段落，无可降级；再删走 PM 默认回上一行）。
 *   例外：空段落是折叠块（toggleListItem / isToggleable heading）的 child 时接管——
 *   只删本行、光标回上一行（首行回标题）末尾；默认 lift 会把空行提出折叠块且
 *   后续兄弟整体跟着出去挂到它下面，折叠块被掏空。
 * - 顶层列表项（bullet/numbered/check）→ 默认，交给 BlockNote 原生
 *   降级逻辑（它们原生 Backspace 本就会变 paragraph / 调整缩进），避免与原生冲突。
 * - 空的嵌套列表叶子项 → 只删除当前项，后续 siblings 继续留在原 parent.children；
 *   BlockNote 默认 lift 会把后续兄弟一起提升到顶层，破坏列表层级。
 * - toggleListItem 且有 children → 整树删除（见下方整树删除逻辑）。
 * - toggleListItem 无 children → 默认（原生降级为 paragraph）。
 * - isToggleable heading 且有 children → 整树删除（见下方整树删除逻辑）。
 * - 当前块带 children（非上述折叠块场景）→ 默认，paragraph 不支持 children，绝不在此破坏子树。
 * - 当前块无 inline 内容模型（image/file/divider 等 void 块，content 非数组）→ 默认。
 *
 * 整树删除逻辑：
 * - toggleListItem 空标题 + 有 children → removeBlocks([block]) 整树删除，光标置于上一块末尾。
 * - isToggleable heading 空标题 + 有 children → 同上。
 * - 若无上一块则光标落到下一块（或不删，视边界情况）。
 * - 首块红线：block.id === editor.document[0].id 时绝不删除。
 *
 * 实现依据（BlockNote 0.51 dist 源码已核实）：BlockNote 自身无块合并 API，向前合并完全来自
 * PM 默认 joinBackward；updateBlock 仅切换块 type、保留为空内容，光标停留当前块。
 *
 * 例外（pending input-rule undo）：tiptap 的 Backspace 命令链第一优先是 undoInputRule——
 * 输入规则（`》 `/`- `/`1. ` 等）刚触发转换、紧接着按退格时，它会把触发文本**原样还原**，
 * 且因 BlockNote 用的 @handlewithcare fork 已先行插入文本、tiptap 又补插一次，结果是
 * 「》  」多出一个空格（用户实测）。Notion 手感应是：退格 = 降级为普通段落，触发字符不还原。
 * 故检测到任一 isInputRules 插件存在待撤销状态时，列表项不再放行给原生，统一原地降级。
 */

/** 交给 BlockNote 原生降级逻辑的列表项类型（无 children 时），本扩展不接管。 */
const LIST_ITEM_TYPES = new Set([
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
]);

type NestedBlock = {
  id: string;
  type: string;
  content?: unknown;
  children?: NestedBlock[];
};

/** 块是否「有 inline 内容模型且当前为空」。void 块（image/file/divider）content 非数组 → false。 */
function isInlineBlockEmpty(block: { content?: unknown }): boolean {
  return Array.isArray(block.content) && block.content.length === 0;
}

/**
 * 删除空的嵌套列表叶子项，但不让后续兄弟随 ProseMirror lift 一起逃出父块。
 * 顶层项、有内容的项、带子树的项全部放行给后续原生行为。
 */
export function deleteEmptyNestedListItem(
  editor: any,
  block: NestedBlock,
): boolean {
  if (!LIST_ITEM_TYPES.has(block.type)) return false;
  if (!isInlineBlockEmpty(block)) return false;
  if (block.children && block.children.length > 0) return false;

  const parent = findParentBlock(editor.document as ToggleBlock[], block.id) as
    | NestedBlock
    | null
    | undefined;
  if (!parent || !Array.isArray(parent.children)) return false;

  const index = parent.children.findIndex((child) => child.id === block.id);
  if (index < 0) return false;
  const target = index > 0 ? parent.children[index - 1] : parent;

  editor.transact(() => {
    editor.removeBlocks([block]);
    editor.setTextCursorPosition(target, "end");
  });
  return true;
}

export const gooseEmptyBlockBackspaceExtension = createExtension({
  key: "goose-empty-block-backspace",
  keyboardShortcuts: {
    Backspace: ({ editor }) => {
      // 优先：markdown 输入规则刚转换出的空块（含 `【】`/`[]`/`1。` 等）立刻退格时，
      // 还原触发前缀。必须先于列表项原生降级，否则触发字符会丢失。
      const view = editor.prosemirrorView;
      if (view && tryUndoMarkdownBlockTrigger(view)) return true;

      const state = editor.prosemirrorState;
      // 仅处理光标（空选区）；非空选区交给 crossBlockDelete / 默认。
      if (!state.selection.empty) return false;
      // 必须落在块内容最开头，否则是块内普通删除，放行默认。
      if (state.selection.$from.parentOffset !== 0) return false;

      const block = editor.getTextCursorPosition().block;

      // 首块红线：永不删除首块（通常是 H1 标题）。
      if (block.id === editor.document[0]?.id) return false;

      if (deleteEmptyNestedListItem(editor, block)) return true;

      // 折叠块 children 内的空段落 → 只删除这一行，光标回上一行末尾
      // （第一行则回折叠块标题末尾）。默认 joinBackward/lift 会把空行提出
      // 折叠块，且后续兄弟整体被挂到提出的空段落下面——折叠块被掏空、
      // 后面的内容看起来「变成普通文本」（用户实测）。
      if (
        block.type === "paragraph" &&
        isInlineBlockEmpty(block) &&
        (!block.children || block.children.length === 0)
      ) {
        const parent = findParentBlock(
          editor.document as ToggleBlock[],
          block.id,
        );
        if (parent && isToggleBlock(parent)) {
          const siblings = parent.children as { id: string }[];
          const idx = siblings.findIndex((s) => s.id === block.id);
          const target = idx > 0 ? siblings[idx - 1] : parent;
          editor.transact(() => {
            editor.removeBlocks([block]);
            editor.setTextCursorPosition(target, "end");
          });
          return true;
        }
      }

      // 已是普通段落 → 放行默认（再删走 PM 默认：回上一行）。
      if (block.type === "paragraph") return false;

      // 输入规则刚触发、还存着待撤销状态（见顶部注释「例外」）：此时放行会被
      // tiptap undoInputRule 抢走、把触发字符还原回来（还多一个空格）。
      // 统一接管为原地降级，不还原触发文本。
      const pendingInputRuleUndo = state.plugins.some(
        (p) =>
          (p.spec as { isInputRules?: boolean }).isInputRules &&
          p.getState(state),
      );

      if (!pendingInputRuleUndo) {
        // 顶层或非空的普通列表项 → 交给 BlockNote 原生降级，避免冲突。
        if (LIST_ITEM_TYPES.has(block.type)) return false;
        // 内容非空 → 默认（非空块块内删除保持默认手感）。
        if (!isInlineBlockEmpty(block)) return false;

        // 空的 toggleListItem 有 children → 整树删除。
        if (
          block.type === "toggleListItem" &&
          block.children &&
          block.children.length > 0
        ) {
          return deleteBlockTree(editor, block);
        }

        // 空的 toggleListItem 无 children → 放行原生（降级为 paragraph）。
        if (block.type === "toggleListItem") return false;

        // 空的 isToggleable heading 有 children → 整树删除。
        if (
          block.type === "heading" &&
          (block.props as { isToggleable?: boolean })?.isToggleable &&
          block.children &&
          block.children.length > 0
        ) {
          return deleteBlockTree(editor, block);
        }
      } else {
        // pending 场景下块内容可能非空（如在已有文字行首打 `# ` 转标题后立刻退格），
        // updateBlock 只改 type、保留 content，正是期望的「降级保文字」。
        // 但 void 块（content 非数组）无法降级为 paragraph，仍放行。
        if (!Array.isArray(block.content)) return false;
        // 折叠标题（`》 ` 打在已有 heading 上只是改 props）→ 反向去掉折叠态即可，
        // 不动 heading 级别与文字，也兼容带 children 的情况。
        if (
          block.type === "heading" &&
          (block.props as { isToggleable?: boolean })?.isToggleable
        ) {
          editor.updateBlock(block, { props: { isToggleable: false } });
          return true;
        }
      }
      // 带 children（非上述整树删除场景）→ 默认，paragraph 不支持 children，不在此破坏子树。
      if (block.children && block.children.length > 0) return false;

      // 空的非段落控件：原地降级为普通空段落，光标留当前行，不向前合并、不跳行。
      editor.updateBlock(block, { type: "paragraph", props: {} });
      editor.setTextCursorPosition(block, "start");
      return true;
    },
  },
});

/**
 * 整树删除折叠块（含所有 children），光标移至上一块末尾。
 * 若无上一块则移至下一块开头；若两者都无则不删。
 */
function deleteBlockTree(editor: any, block: any): boolean {
  const pos = editor.getTextCursorPosition();
  const prevBlock = pos.prevBlock;
  const nextBlock = pos.nextBlock;

  // 无上一块也无下一块时不删（极端情况：文档只剩这一块）。
  if (!prevBlock && !nextBlock) return false;

  editor.removeBlocks([block]);

  if (prevBlock) {
    try {
      editor.setTextCursorPosition(prevBlock, "end");
    } catch {
      // prevBlock 可能是折叠块的父块，setTextCursorPosition 可能失败，忽略。
    }
  } else if (nextBlock) {
    try {
      editor.setTextCursorPosition(nextBlock, "start");
    } catch {
      // 忽略边界异常。
    }
  }

  return true;
}
