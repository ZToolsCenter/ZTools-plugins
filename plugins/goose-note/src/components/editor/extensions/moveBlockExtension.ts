import { createExtension, type BlockNoteEditor } from "@blocknote/core";

type MoveDirection = "up" | "down";

type AnyEditor = BlockNoteEditor<any, any, any>;

type AnyBlock = {
  id: string;
  children: AnyBlock[];
};

type MovePlacement = {
  referenceBlock: { id: string } | string;
  placement: "before" | "after";
};

function getDocumentTitleId(editor: AnyEditor): string | undefined {
  return editor.document[0]?.id;
}

/**
 * 当前需要移动的 blocks：有多选时用选区，否则用光标所在块。
 */
export function getBlocksToMove(editor: AnyEditor): AnyBlock[] {
  return (
    (editor.getSelection()?.blocks as AnyBlock[] | undefined) ?? [
      editor.getTextCursorPosition().block as AnyBlock,
    ]
  );
}

/**
 * 复刻 BlockNote getMoveUpPlacement 的最小逻辑（不处理 columnList 递归）。
 */
function getMoveUpPlacement(
  editor: AnyEditor,
  prevBlock?: AnyBlock,
  parentBlock?: AnyBlock,
): MovePlacement | undefined {
  let referenceBlock: AnyBlock | undefined;
  let placement: "before" | "after" | undefined;

  if (!prevBlock) {
    if (parentBlock) {
      referenceBlock = parentBlock;
      placement = "before";
    }
  } else if (prevBlock.children.length > 0) {
    referenceBlock = prevBlock.children[prevBlock.children.length - 1];
    placement = "after";
  } else {
    referenceBlock = prevBlock;
    placement = "before";
  }

  if (!referenceBlock || !placement) {
    return undefined;
  }

  return { referenceBlock, placement };
}

/**
 * 若上移最终会把 blocks 插到文档标题一之前，返回 true。
 */
export function wouldMoveBeforeDocumentTitle(
  editor: AnyEditor,
  blocks: AnyBlock[],
  direction: MoveDirection,
): boolean {
  if (direction !== "up") return false;

  const titleId = getDocumentTitleId(editor);
  if (!titleId) return false;

  const sourceBlock = blocks[0];
  if (!sourceBlock) return false;

  const placement = getMoveUpPlacement(
    editor,
    editor.getPrevBlock(sourceBlock) as AnyBlock | undefined,
    editor.getParentBlock(sourceBlock) as AnyBlock | undefined,
  );

  if (!placement) return false;

  const referenceId =
    typeof placement.referenceBlock === "string"
      ? placement.referenceBlock
      : placement.referenceBlock.id;

  return placement.placement === "before" && referenceId === titleId;
}

/**
 * Option/Alt+↑/↓ 移动当前选中/光标块。
 * 始终返回 true（吞键），即使 no-op（含标题保护）。
 */
export function moveSelectedBlocksByShortcut(
  editor: AnyEditor,
  direction: MoveDirection,
): boolean {
  try {
    const blocks = getBlocksToMove(editor);
    if (blocks.length === 0) return true;

    const titleId = getDocumentTitleId(editor);
    if (titleId && blocks.some((block) => block.id === titleId)) {
      return true;
    }

    if (wouldMoveBeforeDocumentTitle(editor, blocks, direction)) {
      return true;
    }

    if (direction === "up") {
      editor.moveBlocksUp();
    } else {
      editor.moveBlocksDown();
    }
  } catch {
    // 吞掉异常，保证快捷键始终被消费
  }

  return true;
}

export const gooseMoveBlockExtension = createExtension({
  key: "goose-move-block",
  keyboardShortcuts: {
    "Alt-ArrowUp": ({ editor }) => moveSelectedBlocksByShortcut(editor, "up"),
    "Alt-ArrowDown": ({ editor }) =>
      moveSelectedBlocksByShortcut(editor, "down"),
  },
});
