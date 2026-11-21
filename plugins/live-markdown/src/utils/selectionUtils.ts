import { MarkdownBlock } from "../types/typora";

export interface SelectionBlockInfo {
  startBlock: MarkdownBlock;
  endBlock: MarkdownBlock;
  coveredBlocks: MarkdownBlock[];
  isSingleBlock: boolean;
  selectedText: string;
}

/**
 * Inspects current browser selection inside the #write editor container
 * and identifies the start block, end block, and covered blocks.
 */
export function getSelectionBlockInfo(
  selection: Selection | null,
  blocks: MarkdownBlock[]
): SelectionBlockInfo | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const writeEl =
    typeof document !== "undefined" ? document.getElementById("write") : null;
  if (!writeEl) return null;

  const startNode = range.startContainer;
  const endNode = range.endContainer;
  if (!writeEl.contains(startNode) || !writeEl.contains(endNode)) {
    return null;
  }

  const startEl =
    startNode instanceof Element ? startNode : startNode.parentElement;
  const endEl =
    endNode instanceof Element ? endNode : endNode.parentElement;

  const startBlockEl = startEl?.closest(".ty-block-wrapper");
  const endBlockEl = endEl?.closest(".ty-block-wrapper");
  if (!startBlockEl || !endBlockEl) return null;

  const startIdx = blocks.findIndex((b) => b.id === startBlockEl.id);
  const endIdx = blocks.findIndex((b) => b.id === endBlockEl.id);
  if (startIdx === -1 || endIdx === -1) return null;

  const minIdx = Math.min(startIdx, endIdx);
  const maxIdx = Math.max(startIdx, endIdx);
  const coveredBlocks = blocks.slice(minIdx, maxIdx + 1);

  return {
    startBlock: blocks[minIdx],
    endBlock: blocks[maxIdx],
    coveredBlocks,
    isSingleBlock: minIdx === maxIdx,
    selectedText: selection.toString()
  };
}

/**
 * Computes remaining markdown text after deleting or replacing a selection of blocks.
 */
export function computeMarkdownAfterDeletingBlocks(
  blocks: MarkdownBlock[],
  blockIdsToDelete: Set<string>
): string {
  const remaining = blocks.filter((b) => !blockIdsToDelete.has(b.id));
  return remaining.map((b) => b.raw).join("\n\n");
}
