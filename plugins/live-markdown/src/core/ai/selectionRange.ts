import { serializeBlockToRaw } from "../markdownParser";
import { MarkdownBlock } from "../../types/typora";

export interface TextRangeOffsets {
  from: number;
  to: number;
}

export function blockRangeToDocumentOffsets(
  blocks: MarkdownBlock[],
  blockId: string,
  from: number,
  to: number
): TextRangeOffsets | null {
  const block = blocks.find((item) => item.id === blockId);
  const start = blockStartOffset(blocks, blockId);
  if (!block || start === null) return null;
  const rawLength = serializeBlockToRaw(block).length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > rawLength || from >= to) {
    return null;
  }
  return { from: start + from, to: start + to };
}

function elementForNode(node: Node): Element | null {
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return node.parentElement;
}

function rawOffsetForPoint(
  editor: HTMLElement,
  blockElement: Element,
  node: Node,
  offset: number,
  blockLength: number
): number | null {
  let carrier = elementForNode(node)?.closest<HTMLElement>("[data-raw-start]") || null;
  while (carrier && !blockElement.contains(carrier)) carrier = carrier.parentElement?.closest<HTMLElement>("[data-raw-start]") || null;
  if (carrier && editor.contains(carrier)) {
    const start = Number(carrier.dataset.rawStart);
    const markerLength = Number(carrier.dataset.markerLen || 0);
    if (!Number.isFinite(start) || !Number.isFinite(markerLength)) return null;
    if (node.nodeType !== Node.TEXT_NODE) return null;
    const textOffset = Math.min((node.textContent || "").length, Math.max(0, offset));
    return Math.min(blockLength, Math.max(0, start + markerLength + textOffset));
  }

  // Some syntax-aware inline nodes do not have a raw marker. Refuse to guess
  // from rendered text because Markdown punctuation is absent from the DOM.
  return null;
}

function blockStartOffset(blocks: MarkdownBlock[], blockId: string): number | null {
  let cursor = 0;
  for (const block of blocks) {
    if (block.id === blockId) return cursor;
    cursor += serializeBlockToRaw(block).length + 2;
  }
  return null;
}

function absoluteOffsetForPoint(
  editor: HTMLElement,
  blocks: MarkdownBlock[],
  node: Node,
  offset: number
): number | null {
  const pointElement = elementForNode(node);
  const wrapper = pointElement?.closest<HTMLElement>(".ty-block-wrapper[id]");
  if (!wrapper || !editor.contains(wrapper)) return null;
  const block = blocks.find((item) => item.id === wrapper.id);
  if (!block) return null;
  const start = blockStartOffset(blocks, block.id);
  const relative = rawOffsetForPoint(editor, wrapper, node, offset, serializeBlockToRaw(block).length);
  return start === null || relative === null ? null : start + relative;
}

/** Maps a native rich-text selection back to original Markdown offsets. */
export function getRawSelectionRange(
  editor: HTMLElement | null,
  blocks: MarkdownBlock[],
  selection: Selection | null
): TextRangeOffsets | null {
  if (!editor || !selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const from = absoluteOffsetForPoint(editor, blocks, range.startContainer, range.startOffset);
  const to = absoluteOffsetForPoint(editor, blocks, range.endContainer, range.endOffset);
  if (from === null || to === null || from >= to) return null;
  return { from, to };
}

export function getRawSelectionPosition(
  editor: HTMLElement | null,
  blocks: MarkdownBlock[],
  selection: Selection | null
): number | null {
  if (!editor || !selection || !selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  return absoluteOffsetForPoint(editor, blocks, range.startContainer, range.startOffset);
}

