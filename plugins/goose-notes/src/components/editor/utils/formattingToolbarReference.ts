import type { BlockNoteEditor } from "@blocknote/core";

import {
  getFormattingSelectionMode,
  getSelectedBlocksSafe,
  type FormattingSelectionMode,
} from "@/components/editor/toolbars/formatting/helpers";

export type ToolbarEdgeSide = "top" | "bottom" | "left" | "right";

export type ToolbarReferenceRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

/**
 * Union of selected block DOM boxes. Multi-block text selections often report a
 * PM rect glued to the first block's text; block boxes reflect the full span.
 */
function getSelectedBlocksUnionRect(
  editor: BlockNoteEditor<any, any, any>,
): DOMRect | undefined {
  const root = editor.domElement;
  if (!root) return undefined;

  const blocks = getSelectedBlocksSafe(editor);
  let minTop = Infinity;
  let minLeft = Infinity;
  let maxBottom = -Infinity;
  let maxRight = -Infinity;
  let found = false;

  for (const block of blocks) {
    const id = (block as { id?: string } | null)?.id;
    if (!id) continue;
    const el = root.querySelector(`[data-id="${id}"]`);
    if (!(el instanceof Element)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    found = true;
    minTop = Math.min(minTop, r.top);
    minLeft = Math.min(minLeft, r.left);
    maxBottom = Math.max(maxBottom, r.bottom);
    maxRight = Math.max(maxRight, r.right);
  }

  if (!found) return undefined;
  return new DOMRect(minLeft, minTop, maxRight - minLeft, maxBottom - minTop);
}

/**
 * Floating-toolbar anchor rect for the current formatting selection mode.
 * multiBlock → full selected-blocks bbox (centered above/below the span);
 * other modes → ProseMirror selection bounding box.
 */
export function getFormattingToolbarReferenceRect(
  editor: BlockNoteEditor<any, any, any>,
  mode?: FormattingSelectionMode,
): DOMRect | undefined {
  const resolvedMode = mode ?? getFormattingSelectionMode(editor);
  if (resolvedMode === "none") return undefined;

  if (resolvedMode === "multiBlock") {
    return (
      getSelectedBlocksUnionRect(editor) ?? editor.getSelectionBoundingBox()
    );
  }

  return editor.getSelectionBoundingBox();
}

/**
 * Collapse a tall multi-block reference to a 1px edge so avoid-overlap
 * middleware can place the toolbar above/below without treating the whole
 * selection height as forbidden space.
 */
export function getMultiBlockToolbarEdgeRect(
  reference: ToolbarReferenceRect,
  preferredSide: ToolbarEdgeSide,
  edgeH = 1,
): ToolbarReferenceRect {
  if (preferredSide === "top") {
    return {
      ...reference,
      bottom: reference.top + edgeH,
      height: edgeH,
    };
  }
  if (preferredSide === "bottom") {
    return {
      ...reference,
      top: reference.bottom - edgeH,
      height: edgeH,
    };
  }
  return reference;
}
