import { useCallback, useRef, type MutableRefObject } from "react";
import {
  getCaretVisualColumnX,
  PendingVisualCursorIntent,
  resolvePendingVisualCursorIntent,
  VisualEdge
} from "../core/textareaVisualNavigation";

/** Moves between preview blocks after the destination textarea is actually mounted. */
export function usePendingVisualCursorIntent(
  preferredCursorPosRef: MutableRefObject<number | null>,
  onFocusBlock: (blockId: string | null) => void
) {
  const pendingRef = useRef<PendingVisualCursorIntent | null>(null);

  const applyToTextarea = useCallback((textarea: HTMLTextAreaElement, blockId: string) => {
    const intent = pendingRef.current;
    if (!intent || intent.targetBlockId !== blockId) return false;
    const targetOffset = resolvePendingVisualCursorIntent(textarea, blockId, intent);
    if (targetOffset === null) return false;

    pendingRef.current = null;
    preferredCursorPosRef.current = null;
    try {
      textarea.setSelectionRange(targetOffset, targetOffset);
    } catch {}
    return true;
  }, [preferredCursorPosRef]);

  const focusAtVisualEdge = useCallback((
    targetBlockId: string,
    edge: VisualEdge,
    sourceTextarea: HTMLTextAreaElement,
    sourceOffset: number
  ) => {
    const intent: PendingVisualCursorIntent = {
      targetBlockId,
      edge,
      desiredX: getCaretVisualColumnX(sourceTextarea, sourceOffset) ?? 0
    };
    pendingRef.current = intent;
    preferredCursorPosRef.current = null;
    onFocusBlock(targetBlockId);

    // A block that was already mounted may not receive a new ref callback.
    // The identity check prevents this fallback from overwriting a ref-applied caret.
    window.requestAnimationFrame(() => {
      if (pendingRef.current !== intent) return;
      const textarea = document
        .getElementById(targetBlockId)
        ?.querySelector<HTMLTextAreaElement>("textarea.ty-live-textarea");
      if (!textarea) return;
      if (document.activeElement !== textarea) {
        textarea.focus({ preventScroll: true });
      }
      applyToTextarea(textarea, targetBlockId);
    });
  }, [applyToTextarea, onFocusBlock, preferredCursorPosRef]);

  return { applyToTextarea, focusAtVisualEdge };
}
