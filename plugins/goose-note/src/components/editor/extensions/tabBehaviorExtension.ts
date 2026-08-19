import { createExtension } from "@blocknote/core";
import { addRowAfter, goToNextCell, isInTable } from "prosemirror-tables";
import type { EditorView } from "prosemirror-view";

const handleTableTab = (view: EditorView, direction: 1 | -1): boolean => {
  if (!isInTable(view.state)) return false;

  if (goToNextCell(direction)(view.state, view.dispatch)) {
    view.focus();
    return true;
  }

  // 末尾单元格：先新增一行，再跳到下一格
  if (direction === 1 && addRowAfter(view.state, view.dispatch)) {
    goToNextCell(1)(view.state, view.dispatch);
    view.focus();
    return true;
  }

  return true;
};

export function shouldUseCodeBlockTabIndent(editor: {
  getSelection?: () => { blocks: { type: string }[] } | undefined;
  getTextCursorPosition: () => { block: { type: string } };
}): boolean {
  try {
    const selectedBlocks = editor.getSelection?.()?.blocks;
    if (selectedBlocks && selectedBlocks.length > 1) return false;
    return editor.getTextCursorPosition().block.type === "codeBlock";
  } catch {
    return false;
  }
}

type HierarchyBlock = {
  id: string;
  type: string;
  props?: { level?: number };
  children?: HierarchyBlock[];
};

type BlockLocation = {
  siblings: readonly HierarchyBlock[];
  index: number;
  parentId: string | null;
};

function findBlockLocation(
  blocks: readonly HierarchyBlock[],
  id: string,
  parentId: string | null = null,
): BlockLocation | null {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.id === id) return { siblings: blocks, index, parentId };
    const nested = findBlockLocation(block.children ?? [], id, block.id);
    if (nested) return nested;
  }
  return null;
}

function hasValidNestTarget(editor: {
  document?: readonly HierarchyBlock[];
  getSelection?: () => { blocks: HierarchyBlock[] } | undefined;
}): boolean {
  const document = editor.document;
  const selectedBlocks = editor.getSelection?.()?.blocks;
  if (!document || !selectedBlocks || selectedBlocks.length === 0) return true;

  const locations = selectedBlocks.map((block) =>
    findBlockLocation(document, block.id),
  );
  if (locations.some((location) => !location)) return false;

  const first = locations[0]!;
  if (first.index === 0) return false;

  // 批量缩进只接受同一父级下连续的兄弟块，避免跨层选区被 liftItem 重排。
  if (
    locations.some(
      (location, offset) =>
        location!.parentId !== first.parentId ||
        location!.siblings !== first.siblings ||
        location!.index !== first.index + offset,
    )
  ) {
    return false;
  }

  const previousSibling = first.siblings[first.index - 1];
  const isPageTitle =
    first.parentId === null &&
    previousSibling.id === document[0]?.id &&
    previousSibling.type === "heading" &&
    previousSibling.props?.level === 1;

  // 分级全选正文会排除 H1；页面标题不是正文块的合法缩进父级。
  return !isPageTitle;
}

/**
 * 直接执行 BlockNote 的层级命令，避免多行选区打开格式工具栏后，BlockNote 默认
 * Tab 为了把焦点交给工具栏而跳过 nest/unnest。命令本身原生支持多块选区，
 * 会保留顺序、子树与选区。
 */
export function adjustSelectedBlockHierarchy(
  editor: {
    document?: readonly HierarchyBlock[];
    getSelection?: () => { blocks: HierarchyBlock[] } | undefined;
    canNestBlock: () => boolean;
    canUnnestBlock: () => boolean;
    nestBlock: () => void;
    unnestBlock: () => void;
  },
  direction: "nest" | "unnest",
): boolean {
  if (direction === "nest") {
    if (hasValidNestTarget(editor) && editor.canNestBlock()) {
      editor.nestBlock();
    }
  } else if (editor.canUnnestBlock()) {
    editor.unnestBlock();
  }

  // 无可调整层级时也消费 Tab，避免浏览器把焦点移出编辑器。
  return true;
}

/**
 * Tab / Shift-Tab：
 * - 表格内：单元格导航
 * - 单个代码块内：放行给代码缩进扩展；跨块选区含代码块时仍调整块层级
 * - 可嵌套 / 可提升时：直接调用 BlockNote nest/unnest；默认快捷键在多行选区
 *   打开格式工具栏时会把 Tab 留给工具栏，无法执行层级调整
 * - 否则消费 Tab，避免焦点跳出编辑器
 */
export const gooseTabBehaviorExtension = createExtension({
  key: "goose-tab-behavior",
  keyboardShortcuts: {
    Tab: ({ editor }) => {
      const view = editor.prosemirrorView;
      if (view && handleTableTab(view, 1)) {
        return true;
      }
      if (shouldUseCodeBlockTabIndent(editor)) {
        return false;
      }
      return adjustSelectedBlockHierarchy(editor, "nest");
    },
    "Shift-Tab": ({ editor }) => {
      const view = editor.prosemirrorView;
      if (view && handleTableTab(view, -1)) {
        return true;
      }
      if (shouldUseCodeBlockTabIndent(editor)) {
        return false;
      }
      return adjustSelectedBlockHierarchy(editor, "unnest");
    },
  },
});
